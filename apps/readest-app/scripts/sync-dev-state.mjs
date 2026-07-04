import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DB_FILES, REPLICA_KINDS } from './sync-dev-env.mjs';
import { captureAnnotationsDb, captureDictionaryDb, captureQuotesDb } from './sync-dev-sqlite.mjs';

const DB_KINDS = ['dictionary', 'annotations', 'quotes'];
const DB_FILE_MAP = { dictionary: 'dictionary.db', annotations: 'annotations.db', quotes: 'citas.db' };
const DB_REPLICA_FALLBACK_MAP = {
  dictionary: ['dictionary-entry', 'dictionary-occurrence'],
  annotations: ['annotation'],
  quotes: ['quote'],
};

const SEMANTIC_DELETE_TARGETS = {
  dictionary: { replicaKind: 'dictionary-occurrence', noteRef: 'dictionaryEntryId', textFields: ['selected_text', 'selectedText', 'text'] },
  quote: { replicaKind: 'quote', noteRef: 'citeId', textFields: ['text'] },
  annotation: { replicaKind: 'annotation', noteRef: 'annotationId', textFields: ['note', 'text'] },
};

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

function readJsonFile(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function bookRowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.books)) return payload.books;
  return [];
}

function bookFactsFromRows(rows) {
  return rows.map((book) => ({
    hash: book?.hash ?? book?.bookHash,
    title: book?.title,
    author: book?.author,
    updatedAt: book?.updatedAt,
    deletedAt: book?.deletedAt,
  }));
}

function bookConfigEvidence({ path, payload, bookHash, httpStatus }) {
  const booknotes = Array.isArray(payload?.booknotes) ? payload.booknotes : [];
  return {
    path,
    status: Array.isArray(payload?.booknotes) ? 'pass' : 'warn',
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    bookHash,
    booknoteCount: booknotes.length,
    booknotes,
  };
}

function missingBookConfigEvidence({ path, bookHash, reason, httpStatus }) {
  return {
    path,
    status: 'warn',
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    bookHash,
    booknoteCount: 0,
    booknotes: [],
    reason,
  };
}

function captureDesktopBookConfig(booksDir, bookHash) {
  if (!bookHash) return undefined;
  const path = join(booksDir, bookHash, 'config.json');
  const payload = readJsonFile(path);
  if (!payload) return missingBookConfigEvidence({ path, bookHash, reason: 'BookConfig config.json unavailable or invalid' });
  return bookConfigEvidence({ path, payload, bookHash });
}

async function captureAndroidBookConfig({ serverUrl, bookHash, fetchJson }) {
  if (!bookHash) return undefined;
  const path = `/books/${bookHash}/config`;
  const result = await fetchJson(`${serverUrl}${path}`);
  if (!result.ok) return missingBookConfigEvidence({ path, bookHash, httpStatus: result.status, reason: result.error ?? 'BookConfig unavailable' });
  return bookConfigEvidence({ path, payload: result.data, bookHash, httpStatus: result.status });
}

function timestampMillis(value) {
  const millis = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(millis) ? millis : null;
}

function latestTimestamp(values) {
  return values.filter(Boolean).sort((a, b) => (timestampMillis(b) ?? -Infinity) - (timestampMillis(a) ?? -Infinity))[0];
}

function importEvidenceFromBookRows(rows, hash) {
  if (!hash) return undefined;
  const matching = rows.filter((book) => book?.hash === hash || book?.bookHash === hash);
  if (matching.length === 0) {
    return {
      hash,
      status: 'missing-evidence',
      evidence: 'book-index.hash',
      reason: 'target book hash not present in Android /books/index',
    };
  }

  const tombstones = matching.filter((book) => book?.deletedAt);
  const live = matching.filter((book) => !book?.deletedAt);
  if (live.length === 0) {
    return {
      hash,
      status: 'missing-evidence',
      evidence: 'book-index.live-entry',
      reason: 'target book hash has no live Android /books/index entry',
    };
  }

  const liveUpdatedAt = latestTimestamp(live.map((book) => book.updatedAt ?? book.importedAt));
  const tombstoneUpdatedAt = latestTimestamp(tombstones.map((book) => book.updatedAt ?? book.deletedAt));
  const liveMillis = timestampMillis(liveUpdatedAt);
  const tombstoneMillis = timestampMillis(tombstoneUpdatedAt);
  return {
    hash,
    status: tombstones.length === 0 || (liveMillis !== null && tombstoneMillis !== null && liveMillis > tombstoneMillis) ? 'pass' : 'fail',
    liveCount: live.length,
    tombstoneCount: tombstones.length,
    liveUpdatedAt,
    tombstoneUpdatedAt,
    liveWins: tombstones.length === 0 || (liveMillis !== null && tombstoneMillis !== null && liveMillis > tombstoneMillis),
  };
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

function replicaField(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && row?.[name] !== '') return row[name];
    const envelope = row?.fields_jsonb?.[name];
    if (envelope?.v !== undefined && envelope.v !== null && envelope.v !== '') return envelope.v;
  }
  return undefined;
}

function replicaId(row) {
  const direct = replicaField(row, ['id']);
  if (direct) return String(direct);
  const full = row?.replica_id ?? row?.replicaId;
  if (typeof full === 'string' && full.includes(':')) return full.slice(full.indexOf(':') + 1);
  return full ? String(full) : undefined;
}

function replicaDeleted(row) {
  return Boolean(row?.deleted_at || row?.deletedAt || row?.deleted_at_ts || row?.deleted);
}

function normalizeSemanticDeleteKind(kind) {
  if (kind === 'dict') return 'dictionary';
  if (kind === 'cita' || kind === 'cite') return 'quote';
  if (kind === 'note') return 'annotation';
  return kind;
}

async function semanticDeleteEvidence({ serverUrl, bookHash, semanticDeleteTarget, fetchJson }) {
  if (!bookHash || !semanticDeleteTarget) return undefined;
  const kind = normalizeSemanticDeleteKind(semanticDeleteTarget.kind ?? semanticDeleteTarget.type);
  const config = SEMANTIC_DELETE_TARGETS[kind];
  if (!config) return { status: 'missing-evidence', kind, bookHash, reason: `unsupported semantic delete kind: ${kind}` };

  const [bookConfigResult, rowsResult] = await Promise.all([
    fetchJson(`${serverUrl}/books/${bookHash}/config`),
    fetchJson(`${serverUrl}/replicas/${config.replicaKind}`),
  ]);
  if (!bookConfigResult.ok) return { status: 'missing-evidence', kind, bookHash, evidence: 'book-config', reason: bookConfigResult.error ?? 'book config unavailable' };
  if (!rowsResult.ok) return { status: 'missing-evidence', kind, bookHash, evidence: config.replicaKind, reason: rowsResult.error ?? 'semantic replicas unavailable' };

  const notes = Array.isArray(bookConfigResult.data?.booknotes) ? bookConfigResult.data.booknotes : [];
  const rows = replicaRowsFromPayload(rowsResult.data);
  const matchingRows = rows.filter((row) => {
    const directSemanticRowMatch = semanticDeleteTarget.semanticRowId && replicaId(row) === semanticDeleteTarget.semanticRowId;
    if (!directSemanticRowMatch && replicaField(row, ['book_hash', 'bookHash']) !== bookHash) return false;
    if (directSemanticRowMatch) return true;
    if (semanticDeleteTarget.id && replicaId(row) !== semanticDeleteTarget.id) return false;
    if (semanticDeleteTarget.cfi && replicaField(row, ['cfi']) !== semanticDeleteTarget.cfi) return false;
    if (semanticDeleteTarget.text && !config.textFields.some((field) => replicaField(row, [field]) === semanticDeleteTarget.text)) return false;
    return true;
  });
  if (matchingRows.length !== 1) {
    return { status: 'missing-evidence', kind, bookHash, reason: `expected exactly one semantic row, found ${matchingRows.length}` };
  }
  const row = matchingRows[0];
  const semanticRowId = replicaId(row);
  const matchingNotes = notes.filter((note) => {
    if (semanticDeleteTarget.noteId && note.id !== semanticDeleteTarget.noteId) return false;
    if (semanticDeleteTarget.noteId && note.id === semanticDeleteTarget.noteId) return true;
    if (note?.[config.noteRef] && note[config.noteRef] !== semanticRowId) return false;
    if (!note?.[config.noteRef] && semanticDeleteTarget.id && note.id !== semanticDeleteTarget.id) return false;
    if (semanticDeleteTarget.cfi && note.cfi !== semanticDeleteTarget.cfi) return false;
    if (semanticDeleteTarget.text && note.text !== semanticDeleteTarget.text) return false;
    return note?.[config.noteRef] === semanticRowId || note.id === semanticDeleteTarget.noteId || note.id === semanticDeleteTarget.id;
  });
  if (matchingNotes.length !== 1) {
    return { status: 'missing-evidence', kind, bookHash, semanticRowId, reason: `expected exactly one BookNote association, found ${matchingNotes.length}` };
  }
  const note = matchingNotes[0];
  const associationDeleted = Boolean(note.deletedAt);
  const semanticDeleted = replicaDeleted(row);
  if (associationDeleted && !semanticDeleted) {
    return {
      status: 'fail',
      kind,
      bookHash,
      semanticRowId,
      booknoteId: note.id,
      associationDeleted,
      semanticDeleted,
      reason: `BookNote association is deleted but ${kind} semantic row remains live`,
    };
  }
  return { status: associationDeleted && semanticDeleted ? 'pass' : 'missing-evidence', kind, bookHash, semanticRowId, booknoteId: note.id, associationDeleted, semanticDeleted };
}

function replicaRowCountFromPayload(payload, rows) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Number.isFinite(payload.rowCount)) return payload.rowCount;
  return rows.length;
}

function deletedCountFromReplica(replica) {
  if (!replica?.reachable) return undefined;
  return Number.isFinite(replica.tombstoneCount) ? replica.tombstoneCount : 0;
}

function androidSqliteUnavailable(capture) {
  return /sqlite3|inaccessible|not found/i.test(capture?.error ?? '');
}

function sqliteFallbackFromReplicas(kind, capture, replicas) {
  if (capture?.available || !androidSqliteUnavailable(capture)) return capture;
  const replicaKinds = DB_REPLICA_FALLBACK_MAP[kind] ?? [];
  const fallbackReplicas = replicaKinds.map((replicaKind) => replicas[replicaKind]);
  if (fallbackReplicas.length === 0 || fallbackReplicas.some((replica) => !replica?.reachable)) return capture;

  return {
    available: true,
    status: 'pass',
    source: 'http-replica-fallback',
    fallbackFor: 'android-sqlite3',
    originalError: capture.error,
    tables: replicaKinds.map((replicaKind, index) => {
      const replica = fallbackReplicas[index];
      return {
        name: replicaKind,
        rowCount: replica.rowCount,
        hlcMin: replica.hlcMin,
        hlcMax: replica.hlcMax,
        deletedCount: deletedCountFromReplica(replica),
      };
    }),
  };
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
  let hlcMin, hlcMax;
  let tombstoneCount = 0;
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

export async function captureDesktopState({ dataRoot, bookHash }) {
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
    facts: bookFactsFromRows(bookRowsFromPayload(readJsonFile(libraryPath))),
  };
  const bookConfig = captureDesktopBookConfig(booksDir, bookHash);
  const settings = { path: settingsPath, exists: existsSync(settingsPath) };
  const db = {
    files: dbFiles,
    presentCount: dbFiles.filter((file) => file.exists).length,
    expectedCount: DB_FILES.length,
  };
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
    status: aggregateStatus([...sqliteStatuses, db.presentCount > 0 ? 'pass' : 'warn', library.status, settings.exists ? 'pass' : 'warn', bookConfig?.status].filter(Boolean)),
    root: readestDir,
    db,
    library,
    settings,
    books: { path: booksDir, dirCount: directoryCount(booksDir) },
    ...(bookConfig ? { bookConfig } : {}),
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

export async function captureAndroidState({ packageName, serverUrl, runAdb = defaultRunAdb, fetchJson = defaultFetchJson, bookHash, semanticDeleteTarget }) {
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
  const bookIndexResult = await fetchJson(`${serverUrl}/books/index`);
  const bookConfig = await captureAndroidBookConfig({ serverUrl, bookHash, fetchJson });
  const semanticDelete = await semanticDeleteEvidence({ serverUrl, bookHash, semanticDeleteTarget, fetchJson });
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
  const bookIndexRows = bookIndexResult.ok ? bookRowsFromPayload(bookIndexResult.data) : [];
  const bookIndex = bookIndexResult.ok
    ? {
        status: 'pass',
        httpStatus: bookIndexResult.status,
        rowCount: bookIndexRows.length,
        facts: bookFactsFromRows(bookIndexRows),
        ...(bookHash ? { importEvidence: importEvidenceFromBookRows(bookIndexRows, bookHash) } : {}),
      }
    : {
        status: 'warn',
        httpStatus: bookIndexResult.status,
        rowCount: 0,
        facts: [],
        ...(bookHash ? {
          importEvidence: {
            hash: bookHash,
            status: 'missing-evidence',
            evidence: 'book-index',
            reason: bookIndexResult.error ?? 'book index unavailable',
          },
        } : {}),
        error: bookIndexResult.error ?? 'book index unavailable',
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
  const errors = [books, manifestResult, bookIndexResult]
    .filter((result) => !result.ok)
    .map((result) => ({ message: result.error ?? result.message ?? 'state capture warning' }));

  // ── Replica API inspection ────────────────────────────
  const replicas = {};
  for (const kind of REPLICA_KINDS) {
    replicas[kind] = await queryReplicaKind(serverUrl, kind, fetchJson);
  }

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
    sqlite[kind] = sqliteFallbackFromReplicas(kind, capture, replicas);
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
      bookIndex.status,
      bookConfig?.status,
    ].filter(Boolean)),
    root,
    db,
    library,
    settings,
    books: { path: booksDir, dirCount: books.ok ? books.stdout.split('\n').filter(Boolean).length : 0 },
    manifest,
    bookIndex,
    ...(bookConfig ? { bookConfig } : {}),
    ...(semanticDelete ? { semanticDeleteEvidence: semanticDelete } : {}),
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
