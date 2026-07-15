/**
 * Controlled data injection into SQLite DBs for dev sync harness.
 *
 * Gate: BIBLIOTECA_DEV_SYNC_HARNESS=1 (enforced via devHarnessEnabled param).
 * Builds INSERT/REPLACE statements dynamically from row key union.
 * Reversible via dev:sync:reset --target desktop-db.
 *
 * Android support: pass `runAdb` + `packageName` for run-as sqlite3.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncDevEnvironment } from './sync-dev-env.mjs';

// ── DDL helpers ──────────────────────────────────────────────────────────────

/**
 * DDL map mirroring Tauri's `visible_repo.rs` CREATE TABLE IF NOT EXISTS statements.
 * Source: src-tauri/src/visible_repo.rs — annotations (lines 715-719), quotes (lines 781-785),
 * dictionary_occurrences (lines 847-852), dictionary_entries (lines 985-989).
 *
 * Each DDL includes `replica_timestamps TEXT` as a fixture-only extension (not in Tauri schema)
 * to support the dev harness replica_timestamps assertions.
 */
const TABLE_DDL = {
  annotations:
    'CREATE TABLE IF NOT EXISTS annotations (\n' +
    '  id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT,\n' +
    '  cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT \'\',\n' +
    '  style TEXT DEFAULT \'highlight\', color TEXT DEFAULT \'yellow\',\n' +
    '  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,\n' +
    '  replica_timestamps TEXT\n' +
    ');',
  quotes:
    'CREATE TABLE IF NOT EXISTS quotes (\n' +
    '  id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT,\n' +
    '  cfi TEXT, section_href TEXT, page INTEGER, text TEXT,\n' +
    '  context_before TEXT, context_after TEXT, content_hash TEXT,\n' +
    '  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,\n' +
    '  replica_timestamps TEXT\n' +
    ');',
  dictionary_occurrences:
    'CREATE TABLE IF NOT EXISTS dictionary_occurrences (\n' +
    '  id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT,\n' +
    '  book_title TEXT, book_author TEXT, cfi TEXT, section_href TEXT,\n' +
    '  page INTEGER, selected_text TEXT, context_before TEXT,\n' +
    '  context_after TEXT, highlight_note_id TEXT,\n' +
    '  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,\n' +
    '  replica_timestamps TEXT\n' +
    ');',
  dictionary_entries:
    'CREATE TABLE IF NOT EXISTS dictionary_entries (\n' +
    '  id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT,\n' +
    '  definition TEXT, enrichment_status TEXT DEFAULT \'pending\',\n' +
    '  image_path TEXT, curiosity TEXT,\n' +
    '  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,\n' +
    '  replica_timestamps TEXT\n' +
    ');',
};

/**
 * Ensure the target table exists in the SQLite database.
 * Idempotent — safe to call on every injection.
 *
 * @param {string} dbPath
 * @param {string} table
 * @param {Function} execFileSync
 */
function ensureTable(dbPath, table, execFileSync) {
  const ddl = TABLE_DDL[table];
  if (ddl) {
    execFileSync('sqlite3', [dbPath, ddl], { encoding: 'utf8', stdio: 'pipe' });
  }
}

/**
 * Inject rows into a SQLite table.
 *
 * @param {object} opts
 * @param {'desktop'|'android'} opts.target
 * @param {string} opts.dbPath - filesystem path (desktop) or internal path (android)
 * @param {string} opts.table
 * @param {Record<string,unknown>[]} opts.rows
 * @param {Function} opts.execFileSync
 * @param {boolean} opts.devHarnessEnabled
 * @param {'insert'|'replace'} [opts.operation='insert']
 * @param {string} [opts.packageName]
 * @param {Function} [opts.runAdb]
 * @returns {{ok: boolean, inserted: number, target: string, table: string, error?: string}}
 */
export function injectRows({
  target,
  dbPath,
  table,
  rows,
  execFileSync,
  devHarnessEnabled,
  operation = 'insert',
  packageName,
  runAdb,
}) {
  if (!devHarnessEnabled) {
    return {
      ok: false,
      inserted: 0,
      target,
      table,
      error: 'BIBLIOTECA_DEV_SYNC_HARNESS must be enabled for data injection',
    };
  }

  if (!rows || rows.length === 0) {
    return { ok: false, inserted: 0, target, table, error: 'no rows to insert' };
  }

  // Build column list from key union of all rows
  const columnSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) columnSet.add(key);
  }
  const columns = [...columnSet];
  const placeholders = columns.map(() => '?').join(', ');

  const verb = operation === 'replace' ? 'INSERT OR REPLACE INTO' : 'INSERT INTO';
  const sql = `${verb} "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

  // Build escaped values for each row
  const valueLists = rows.map((row) =>
    columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return String(val);
      // Escape single quotes for SQLite
      return `'${String(val).replace(/'/g, "''")}'`;
    }),
  );

  const statements = valueLists.map((vals) => {
    // Replace ? placeholders with actual values
    let stmt = sql;
    for (const val of vals) {
      stmt = stmt.replace('?', val);
    }
    return stmt;
  });

  const fullSql = statements.join(';\n') + ';';

  try {
    // Ensure target table exists before inserting (idempotent — matches Tauri visible_repo.rs DDL)
    ensureTable(dbPath, table, execFileSync);

    if (target === 'android' && runAdb && packageName) {
      // Android: pipe SQL via adb shell run-as sqlite3
      const echoCmd = `echo "${fullSql.replace(/"/g, '\\"')}" | sqlite3 "${dbPath}"`;
      const result = runAdb(['shell', 'run-as', packageName, 'sh', '-c', echoCmd]);
      if (!result.ok) {
        return { ok: false, inserted: 0, target, table, error: result.message ?? 'adb injection failed' };
      }
    } else {
      // Desktop: execFileSync with sqlite3 CLI
      execFileSync('sqlite3', [dbPath, fullSql], { encoding: 'utf8', stdio: 'pipe' });
    }
    return { ok: true, inserted: rows.length, target, table };
  } catch (error) {
    return {
      ok: false,
      inserted: 0,
      target,
      table,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Tombstone a book entry in the desktop Readest library index.
 *
 * Instead of removing the row, sets `deletedAt`, `updatedAt`, and clears
 * `downloadedAt` to null so the tombstone can be propagated via sync.
 *
 * @param {string} bookHash
 * @param {{dataRoot?: string}} [options]
 * @returns {{ok: true, bookHash: string, action: 'tombstoned'|'not-found'}}
 */
export function deleteBook(bookHash, options = {}) {
  const dataRoot = options.dataRoot ?? createSyncDevEnvironment().desktop.dataRoot;
  const libraryPath = join(dataRoot, 'Readest', 'Books', 'library.json');
  const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
  if (!Array.isArray(library)) {
    throw new Error(`Invalid library.json: expected array at ${libraryPath}`);
  }

  let found = false;
  const now = Date.now();
  const updated = library.map((book) => {
    if (book?.hash !== bookHash && book?.bookHash !== bookHash) return book;
    found = true;
    return { ...book, deletedAt: now, updatedAt: now, downloadedAt: null };
  });

  if (!found) {
    return { ok: true, bookHash, action: 'not-found' };
  }

  writeFileSync(libraryPath, JSON.stringify(updated, null, 2), 'utf8');
  return { ok: true, bookHash, action: 'tombstoned' };
}

/**
 * Update editable fields for one desktop Readest library entry.
 *
 * @param {string} bookHash
 * @param {Record<string, unknown>} updates
 * @param {{dataRoot?: string, now?: (() => Date|string|number)|Date|string|number}} [options]
 * @returns {{ok: true, bookHash: string, action: 'updated'|'not-found'}}
 */
export function updateBook(bookHash, updates, options = {}) {
  const dataRoot = options.dataRoot ?? createSyncDevEnvironment().desktop.dataRoot;
  const libraryPath = join(dataRoot, 'Readest', 'Books', 'library.json');
  const library = JSON.parse(readFileSync(libraryPath, 'utf8'));
  if (!Array.isArray(library)) {
    throw new Error(`Invalid library.json: expected array at ${libraryPath}`);
  }

  let found = false;
  const nowValue = typeof options.now === 'function' ? options.now() : options.now;
  const updatedAt = nowValue instanceof Date
    ? nowValue.toISOString()
    : typeof nowValue === 'number'
      ? new Date(nowValue).toISOString()
      : typeof nowValue === 'string'
        ? nowValue
        : undefined;
  const updatedLibrary = library.map((book) => {
    if (book?.hash !== bookHash && book?.bookHash !== bookHash) return book;
    found = true;
    const next = updatedAt === undefined ? { ...book } : { ...book, updatedAt };
    for (const [field, value] of Object.entries(updates)) {
      if (field === 'metadata' && value && typeof value === 'object' && !Array.isArray(value)) {
        next.metadata = { ...(next.metadata ?? {}), ...value };
      } else {
        next[field] = value;
      }
    }
    return next;
  });

  if (!found) return { ok: true, bookHash, action: 'not-found' };

  writeFileSync(libraryPath, JSON.stringify(updatedLibrary, null, 2), 'utf8');
  return { ok: true, bookHash, action: 'updated' };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const idx = args.indexOf(name);
    return idx === -1 ? undefined : args[idx + 1];
  };

  const target = getFlag('--target') || 'desktop';
  const table = getFlag('--table');
  const dataArg = getFlag('--data');
  const operation = getFlag('--operation') || 'insert';
  const dbPath = getFlag('--db-path');
  const devHarnessEnabled = process.env.BIBLIOTECA_DEV_SYNC_HARNESS === '1';

  if (!table || !dataArg || !dbPath) {
    console.log(JSON.stringify({
      ok: false,
      status: 'fail',
      command: 'dev:sync:inject',
      errors: [{ message: '--target, --table, --data, and --db-path are required' }],
    }));
    process.exit(1);
  }

  let rows;
  try {
    rows = JSON.parse(dataArg);
    if (!Array.isArray(rows)) rows = [rows];
  } catch {
    console.log(JSON.stringify({
      ok: false,
      status: 'fail',
      command: 'dev:sync:inject',
      errors: [{ message: '--data must be valid JSON (object or array of objects)' }],
    }));
    process.exit(1);
  }

  const { execFileSync } = await import('node:child_process');

  const result = injectRows({
    target,
    dbPath,
    table,
    rows,
    execFileSync,
    devHarnessEnabled,
    operation,
  });

  console.log(JSON.stringify({
    status: result.ok ? 'pass' : 'fail',
    command: 'dev:sync:inject',
    errors: result.error ? [{ message: result.error }] : [],
    ...result,
  }));
  if (!result.ok) process.exit(1);
}

// Only run CLI if executed directly (not imported)
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\.\//, ''));
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
