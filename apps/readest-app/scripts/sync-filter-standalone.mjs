/**
 * sync-filter-standalone — ESM standalone wrapper for replicaFilter.ts.
 *
 * Exposes the shared replica dedup functions so that sync-execute.mjs (ESM)
 * can import them without needing a TS transpiler.
 *
 * Mirrors the implementation in src/services/sync/replicaFilter.ts exactly.
 * Both files must be kept in sync — changes to the algorithm go to
 * replicaFilter.ts first, then mirrored here.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// -----------------------------------------------------------------------
// Pure functions — work in Node AND browser
// -----------------------------------------------------------------------

/**
 * Normalize a term for semantic identity comparison.
 * Steps: NFC normalization → lowercase → soft-hyphen (U+00AD) strip.
 * Matches Rust normalize_dictionary_term() exactly.
 */
export function normalizeTerm(s) {
  if (s === null || s === undefined) return '';
  return String(s).normalize('NFC').toLowerCase().replace(/\u00ad/g, '');
}

/**
 * Compute a semantic key for dictionary-entry dedup.
 * Key format: `${normalizedTerm}|${normalizedLanguage}`
 * Returns null for rows without a valid term or without fields_jsonb.
 */
export function computeSemanticKey(row) {
  if (!row?.fields_jsonb) return null;
  const term = row.fields_jsonb?.term?.v;
  const language = row.fields_jsonb?.language?.v;
  if (!term || typeof term !== 'string' || term.trim() === '') return null;
  return `${normalizeTerm(term)}|${normalizeTerm(language ?? '')}`;
}

// -----------------------------------------------------------------------
// SQLite helpers — private
// -----------------------------------------------------------------------

function readSqliteJson(dbPath, sql) {
  const { execFileSync } = require('node:child_process');
  const output = execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8' });
  return JSON.parse(output || '[]');
}

function execSqlite(dbPath, sql) {
  const { execFileSync } = require('node:child_process');
  execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
}

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tableExists(dbPath, tableName) {
  const rows = readSqliteJson(dbPath, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`);
  return rows.length > 0;
}

// -----------------------------------------------------------------------
// SQLite-dependent functions
// -----------------------------------------------------------------------

/**
 * Check if a replica with the same replica_id exists with equal-or-higher HLC.
 */
export function newerOrEqualReplicaExists(dbPath, replicaId, updatedAtTs) {
  const rows = readSqliteJson(dbPath, `SELECT updated_at_ts FROM _replicas WHERE replica_id = ${sqlValue(replicaId)} LIMIT 1`);
  return typeof rows[0]?.updated_at_ts === 'string' && rows[0].updated_at_ts >= updatedAtTs;
}

/**
 * Check if a dictionary-entry replica with the same semantic_key exists
 * with equal-or-higher HLC.
 */
export function newerOrEqualSemanticReplicaExists(dbPath, semanticKey, updatedAtTs) {
  if (!semanticKey) return false;
  const rows = readSqliteJson(dbPath, `SELECT updated_at_ts FROM _replicas WHERE semantic_key = ${sqlValue(semanticKey)} AND kind = 'dictionary-entry' LIMIT 1`);
  return typeof rows[0]?.updated_at_ts === 'string' && rows[0].updated_at_ts >= updatedAtTs;
}

/**
 * Filter out replicas that are already present in the local _replicas table
 * with equal-or-higher HLC.
 *
 * Two-pass filter:
 *   Pass 1: Exact replica_id match (all kinds)
 *   Pass 2: Semantic key match (dictionary-entry only) — matches by
 *           normalized term|language even if replica_id differs.
 */
export function filterUnchangedReplicas(dbPath, replicas, kind) {
  if (!tableExists(dbPath, '_replicas')) return replicas;
  return replicas.filter(r => {
    // Pass 1: exact replica_id match (all kinds)
    if (newerOrEqualReplicaExists(dbPath, r.replica_id, r.updated_at_ts)) return false;
    // Pass 2 (dict-entry only): semantic match against normalized term|language
    if (kind === 'dictionary-entry') {
      const sk = computeSemanticKey(r);
      if (sk && newerOrEqualSemanticReplicaExists(dbPath, sk, r.updated_at_ts)) return false;
    }
    return true;
  });
}

/**
 * Write (upsert) a ReplicaRow into _replicas, computing and storing
 * the semantic_key column for dictionary-entry rows.
 */
export function writeReplicaMetadata(dbPath, row) {
  const semanticKey = row.kind === 'dictionary-entry' && row?.fields_jsonb
    ? computeSemanticKey(row)
    : null;
  execSqlite(dbPath, `
    INSERT OR REPLACE INTO _replicas (replica_id, kind, user_id, fields_jsonb, manifest_jsonb, deleted_at_ts, reincarnation, updated_at_ts, schema_version, semantic_key)
    VALUES (
      ${sqlValue(row.replica_id)}, ${sqlValue(row.kind)}, ${sqlValue(row.user_id)},
      ${sqlValue(JSON.stringify(row.fields_jsonb ?? {}))}, ${sqlValue(row.manifest_jsonb ? JSON.stringify(row.manifest_jsonb) : null)},
      ${sqlValue(row.deleted_at_ts ?? null)}, ${sqlValue(row.reincarnation ?? null)},
      ${sqlValue(row.updated_at_ts)}, ${sqlValue(row.schema_version ?? 1)},
      ${sqlValue(semanticKey)}
    );
  `);
}

// -----------------------------------------------------------------------
// DDL — App table schemas per kind
// -----------------------------------------------------------------------

const APP_TABLE_DDL = {
  'dictionary-entry': `
    CREATE TABLE IF NOT EXISTS dictionary_entries (
      id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, definition TEXT,
      image_path TEXT, curiosity TEXT, enrichment_status TEXT, replica_timestamps TEXT,
      created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
    );`,
  'dictionary-occurrence': `
    CREATE TABLE IF NOT EXISTS dictionary_occurrences (
      id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, book_title TEXT, book_author TEXT,
      cfi TEXT, section_href TEXT, page INTEGER, selected_text TEXT, context_before TEXT,
      context_after TEXT, highlight_note_id TEXT, replica_timestamps TEXT,
      created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
    );`,
  quote: `
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, cfi TEXT,
      section_href TEXT, page INTEGER, text TEXT, context_before TEXT, context_after TEXT,
      content_hash TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
    );`,
  annotation: `
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, cfi TEXT,
      section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '', style TEXT DEFAULT 'highlight',
      color TEXT DEFAULT 'yellow', created_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
      replica_timestamps TEXT
    );`,
};

/**
 * Ensure _replicas metadata table and the application table for kind exist.
 * Runs DDL idempotently (CREATE IF NOT EXISTS).
 * Also migrates an existing _replicas table to add semantic_key column
 * if it was created before the migration.
 */
export function ensureReplicaTables(dbPath, kind) {
  const appDdl = APP_TABLE_DDL[kind] ?? '';
  execSqlite(dbPath, `
    CREATE TABLE IF NOT EXISTS _replicas (
      replica_id TEXT PRIMARY KEY, kind TEXT, user_id TEXT, fields_jsonb TEXT,
      manifest_jsonb TEXT, deleted_at_ts TEXT, reincarnation TEXT, updated_at_ts TEXT,
      schema_version INTEGER, semantic_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_replicas_kind_updated_at ON _replicas(kind, updated_at_ts);
    ${appDdl}
  `);
  maybeAddSemanticKeyColumn(dbPath);
}

/**
 * Migration: add semantic_key column to existing _replicas tables that lack it.
 * No-op if column already exists or _replicas table doesn't exist.
 */
function maybeAddSemanticKeyColumn(dbPath) {
  try {
    const cols = readSqliteJson(dbPath, 'PRAGMA table_info(_replicas)');
    if (!cols.some(c => c.name === 'semantic_key')) {
      execSqlite(dbPath, 'ALTER TABLE _replicas ADD COLUMN semantic_key TEXT');
    }
  } catch {
    // _replicas table doesn't exist yet — nothing to migrate
  }
}
