import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DB_FILES, REPLICA_KINDS } from './sync-dev-env.mjs';
import { captureAnnotationsDb, captureDictionaryDb, captureQuotesDb } from './sync-dev-sqlite.mjs';

const DB_KINDS = ['dictionary', 'annotations', 'quotes'];
const DB_FILE_MAP = { dictionary: 'dictionary.db', annotations: 'annotations.db', quotes: 'citas.db' };

function summarizeJsonText(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return { kind: 'array', count: value.length };
    if (value && typeof value === 'object') return { kind: 'object', keys: Object.keys(value).sort() };
    return { kind: typeof value };
  } catch (error) {
    return { kind: 'invalid-json', error: error instanceof Error ? error.message : String(error) };
  }
}

function summarizeJsonFile(path) {
  if (!existsSync(path)) return { kind: 'missing' };
  return summarizeJsonText(readFileSync(path, 'utf8'));
}

function directoryCount(path) {
  if (!existsSync(path)) return 0;
  return readdirSync(path).filter((name) => {
    try {
      return statSync(join(path, name)).isDirectory();
    } catch {
      return false;
    }
  }).length;
}

function aggregateStatus(parts) {
  if (parts.some((status) => status === 'fail')) return 'fail';
  if (parts.some((status) => status === 'warn')) return 'warn';
  return 'pass';
}

function replicaRowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function replicaRowCountFromPayload(payload, rows) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Number.isFinite(payload.rowCount)) return payload.rowCount;
  return rows.length;
}

/**
 * Query a single replica kind from the Android /replicas/:kind API.
 * Returns structured metadata: row count, HLC range, tombstone count.
 * Unreachable API → warn, never fail.
 */
async function queryReplicaKind(url, kind, fetchJson) {
  const endpoint = `${url}/replicas/${kind}`;
  const result = await fetchJson(endpoint);
  if (!result.ok) {
    return { kind, reachable: false, error: result.error ?? `HTTP ${result.status}`, httpStatus: result.status };
  }
  const rows = replicaRowsFromPayload(result.data);
  const rowCount = replicaRowCountFromPayload(result.data, rows);
  let hlcMin, hlcMax, tombstoneCount;
  if (rows.length > 0) {
    const hlcs = rows.map((r) => r.hlc).filter(Boolean).sort();
    if (hlcs.length > 0) {
      hlcMin = hlcs[0];
      hlcMax = hlcs[hlcs.length - 1];
    }
    tombstoneCount = rows.filter((r) => r.deleted_at_ts || r.deleted).length;
  }
  return { kind, reachable: true, rowCount, hlcMin, hlcMax, tombstoneCount, httpStatus: result.status };
}

export async function captureDesktopState({ dataRoot }) {
  const readestDir = join(dataRoot, 'Readest');
  const booksDir = join(readestDir, 'Books');
  const dbFiles = DB_FILES.map((name) => ({ name, path: join(readestDir, name), exists: existsSync(join(readestDir, name)) }));
  const libraryPath = join(booksDir, 'library.json');
  const libraryBackupPath = join(booksDir, 'library.json.bak');
  const settingsPath = join(readestDir, 'settings.json');
  const libraryExists = existsSync(libraryPath);
  const library = {
    path: libraryPath,
    exists: libraryExists,
    backupExists: existsSync(libraryBackupPath),
    status: libraryExists ? 'pass' : 'warn',
    summary: summarizeJsonFile(libraryPath),
  };
  const settings = { path: settingsPath, exists: existsSync(settingsPath) };
  const db = {
    files: dbFiles,
    presentCount: dbFiles.filter((file) => file.exists).length,
    expectedCount: DB_FILES.length,
  };
  const status = aggregateStatus([db.presentCount > 0 ? 'pass' : 'warn', library.status, settings.exists ? 'pass' : 'warn']);

  // ── SQLite row-level capture ──────────────────────────
  const sqlite = {};
  for (const kind of DB_KINDS) {
    const filename = DB_FILE_MAP[kind];
    const dbPath = join(readestDir, filename);
    let capture;
    if (kind === 'dictionary') {
      capture = captureDictionaryDb({ dbPath, execFileSync });
    } else if (kind === 'annotations') {
      capture = captureAnnotationsDb({ dbPath, execFileSync });
    } else if (kind === 'quotes') {
      capture = captureQuotesDb({ dbPath, execFileSync });
    }
    if (!capture.available) {
      capture.status = 'warn';
    }
    sqlite[kind] = capture;
  }
  const sqliteStatuses = Object.values(sqlite).map((c) => (c.available ? 'pass' : 'warn'));

  return {
    target: 'desktop',
    status: aggregateStatus([...sqliteStatuses, db.presentCount > 0 ? 'pass' : 'warn', library.status, settings.exists ? 'pass' : 'warn']),
    root: readestDir,
    db,
    library,
    settings,
    books: { path: booksDir, dirCount: directoryCount(booksDir) },
    sqlite,
    errors: [],
  };
}

function defaultRunAdb(args) {
  try {
    return { ok: true, stdout: execFileSync('adb', args, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { ok: false, stdout: '', message: error instanceof Error ? error.message : String(error) };
  }
}

async function defaultFetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return { ok: false, status: response.status, error: `${url} returned ${response.status}` };
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return { ok: false, status: 0, error: `${url} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function runAs(packageName, command, runAdb) {
  const commandArgs = Array.isArray(command) ? command : ['sh', '-c', command];
  return runAdb(['shell', 'run-as', packageName, ...commandArgs]);
}

function androidReadJson(packageName, path, runAdb) {
  const exists = runAs(packageName, ['test', '-e', path], runAdb).ok;
  if (!exists) return { exists: false, summary: { kind: 'missing' } };
  const content = runAs(packageName, ['cat', path], runAdb);
  if (!content.ok) return { exists: true, summary: { kind: 'unreadable', error: content.message ?? 'adb read failed' } };
  return { exists: true, summary: summarizeJsonText(content.stdout) };
}

export async function captureAndroidState({ packageName, serverUrl, runAdb = defaultRunAdb, fetchJson = defaultFetchJson }) {
  const root = `/data/data/${packageName}/Readest`;
  const booksDir = `${root}/Books`;
  const dbFiles = DB_FILES.map((name) => {
    const path = `${root}/${name}`;
    return { name, path, exists: runAs(packageName, ['test', '-e', path], runAdb).ok };
  });
  const libraryPath = `${booksDir}/library.json`;
  const libraryBackupPath = `${booksDir}/library.json.bak`;
  const libraryRead = androidReadJson(packageName, libraryPath, runAdb);
  const backupExists = runAs(packageName, ['test', '-e', libraryBackupPath], runAdb).ok;
  const settingsPath = `${root}/settings.json`;
  const settingsRead = androidReadJson(packageName, settingsPath, runAdb);
  const books = runAs(packageName, `find ${booksDir} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n'`, runAdb);
  const manifestResult = await fetchJson(`${serverUrl}/books/manifest`);
  const manifest = manifestResult.ok
    ? {
        status: 'pass',
        httpStatus: manifestResult.status,
        data: manifestResult.data,
        summary: summarizeManifest(manifestResult.data),
      }
    : {
        status: 'warn',
        httpStatus: manifestResult.status,
        error: manifestResult.error ?? 'manifest unavailable',
        summary: { kind: 'missing' },
      };
  const db = { files: dbFiles, presentCount: dbFiles.filter((file) => file.exists).length, expectedCount: DB_FILES.length };
  const library = {
    path: libraryPath,
    exists: libraryRead.exists,
    backupExists,
    status: libraryRead.exists ? 'pass' : 'warn',
    summary: libraryRead.summary,
  };
  const settings = { path: settingsPath, exists: settingsRead.exists, summary: settingsRead.summary };
  const errors = [books, manifestResult]
    .filter((result) => !result.ok)
    .map((result) => ({ message: result.error ?? result.message ?? 'state capture warning' }));

  // ── SQLite row-level capture (Android via run-as) ──────
  const sqlite = {};
  for (const kind of DB_KINDS) {
    const filename = DB_FILE_MAP[kind];
    const dbPath = `${root}/${filename}`;
    const exists = runAs(packageName, ['test', '-e', dbPath], runAdb).ok;
    if (!exists) {
      sqlite[kind] = { available: false, tables: [], error: 'db file not found on device' };
      continue;
    }
    // Android: create an execFileSync wrapper that runs sqlite3 via run-as.
    // sqliteQuery calls execFileSync('sqlite3', [dbPath, '-json', sql], options).
    // The wrapper receives (command, args, _options) and translates to adb.
    function androidSqlite(_cmd, args) {
      const dbP = args[0];
      const sql = args[args.length - 1]; // last arg is the SQL query
      const cmd = `sqlite3 "${dbP}" -json "${String(sql).replace(/"/g, '\\"')}"`;
      const res = runAs(packageName, ['sh', '-c', cmd], runAdb);
      if (!res.ok) throw new Error(res.message ?? 'sqlite3 on device failed');
      return res.stdout;
    }
    let capture;
    if (kind === 'dictionary') {
      capture = captureDictionaryDb({ dbPath, execFileSync: androidSqlite });
    } else if (kind === 'annotations') {
      capture = captureAnnotationsDb({ dbPath, execFileSync: androidSqlite });
    } else if (kind === 'quotes') {
      capture = captureQuotesDb({ dbPath, execFileSync: androidSqlite });
    }
    if (!capture.available) {
      capture.status = 'warn';
    }
    sqlite[kind] = capture;
  }

  // ── Replica API inspection ────────────────────────────
  const replicas = {};
  for (const kind of REPLICA_KINDS) {
    replicas[kind] = await queryReplicaKind(serverUrl, kind, fetchJson);
  }

  const sqliteStatuses = Object.values(sqlite).map((c) => (c.available ? 'pass' : 'warn'));
  const replicaStatuses = Object.values(replicas).map((r) => (r.reachable ? 'pass' : 'warn'));

  return {
    target: 'android',
    status: aggregateStatus([
      ...sqliteStatuses,
      ...replicaStatuses,
      db.presentCount > 0 ? 'pass' : 'warn',
      library.status,
      settings.exists ? 'pass' : 'warn',
      books.ok ? 'pass' : 'warn',
      manifest.status,
    ]),
    root,
    db,
    library,
    settings,
    books: { path: booksDir, dirCount: books.ok ? books.stdout.split('\n').filter(Boolean).length : 0 },
    manifest,
    sqlite,
    replicas,
    errors,
  };
}

function summarizeManifest(value) {
  if (Array.isArray(value)) return { kind: 'array', count: value.length };
  if (value && typeof value === 'object') return { kind: 'object', keys: Object.keys(value).sort() };
  return { kind: typeof value };
}

export function aggregateSyncStateStatus(desktop, android) {
  return aggregateStatus([desktop.status, android.status]);
}
