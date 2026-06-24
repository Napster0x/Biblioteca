// Direct sync execution - no browser, no polling, no trigger counter
import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

const DICTIONARY_ENTRY_ENDPOINT = '/replicas/dictionary-entry';
const DICTIONARY_OCCURRENCE_ENDPOINT = '/replicas/dictionary-occurrence';
const QUOTE_ENDPOINT = '/replicas/quote';
const ANNOTATION_ENDPOINT = '/replicas/annotation';

const ENTRY_FIELDS = {
  term: 'term',
  displayTerm: 'display_term',
  language: 'language',
  definition: 'definition',
  imagePath: 'image_path',
  curiosity: 'curiosity',
  enrichmentStatus: 'enrichment_status',
};

const OCCURRENCE_FIELDS = {
  entryId: 'entry_id',
  bookHash: 'book_hash',
  bookTitle: 'book_title',
  bookAuthor: 'book_author',
  cfi: 'cfi',
  sectionHref: 'section_href',
  page: 'page',
  selectedText: 'selected_text',
  contextBefore: 'context_before',
  contextAfter: 'context_after',
  highlightNoteId: 'highlight_note_id',
};

const QUOTE_FIELDS = {
  bookHash: 'book_hash',
  bookTitle: 'book_title',
  bookAuthor: 'book_author',
  cfi: 'cfi',
  sectionHref: 'section_href',
  page: 'page',
  text: 'text',
  contextBefore: 'context_before',
  contextAfter: 'context_after',
  contentHash: 'content_hash',
};

const ANNOTATION_FIELDS = {
  bookHash: 'book_hash',
  bookTitle: 'book_title',
  bookAuthor: 'book_author',
  cfi: 'cfi',
  sectionHref: 'section_href',
  page: 'page',
  text: 'text',
  note: 'note',
  style: 'style',
  color: 'color',
};

function emptyReplicaEvidence() {
  return {
    'dictionary-entry': { attempted: 0, applied: 0, pulled: 0, appliedToDesktop: 0, endpoint: DICTIONARY_ENTRY_ENDPOINT, failures: [] },
    'dictionary-occurrence': { attempted: 0, applied: 0, pulled: 0, appliedToDesktop: 0, endpoint: DICTIONARY_OCCURRENCE_ENDPOINT, failures: [] },
    quote: { attempted: 0, applied: 0, pulled: 0, appliedToDesktop: 0, endpoint: QUOTE_ENDPOINT, failures: [] },
    annotation: { attempted: 0, applied: 0, pulled: 0, appliedToDesktop: 0, endpoint: ANNOTATION_ENDPOINT, failures: [] },
  };
}

const REPLICA_PULL_ORDER = [
  ['dictionary-entry', DICTIONARY_ENTRY_ENDPOINT],
  ['dictionary-occurrence', DICTIONARY_OCCURRENCE_ENDPOINT],
  ['quote', QUOTE_ENDPOINT],
  ['annotation', ANNOTATION_ENDPOINT],
];

function replicaRowsFromPayload(payload, kind) {
  const rows = Array.isArray(payload) ? payload : payload?.rows;
  if (!Array.isArray(rows)) throw new Error(`${kind} replica GET returned no rows array`);
  return rows;
}

async function getReplicas(baseUrl, kind, endpoint, replicas) {
  let resp;
  try {
    resp = await fetch(`${baseUrl}${endpoint}`);
  } catch (err) {
    replicas[kind].failures.push(`${kind} replica GET failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  const responseText = await resp.text();
  if (!resp.ok) {
    replicas[kind].failures.push(`${kind} replica GET failed with ${resp.status}${responseText ? `: ${responseText}` : ''}`);
    return [];
  }
  try {
    const rows = replicaRowsFromPayload(responseText.trim() ? JSON.parse(responseText) : [], kind);
    replicas[kind].pulled = rows.length;
    return rows;
  } catch (err) {
    replicas[kind].failures.push(`${kind} replica GET returned invalid payload: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function readSqliteJson(dbPath, sql) {
  const { execFileSync } = require('node:child_process');
  const output = execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8' });
  return JSON.parse(output || '[]');
}

function tableExists(dbPath, tableName) {
  const rows = readSqliteJson(dbPath, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`);
  return rows.length > 0;
}

function readDictionaryRows(dictionaryDbPath) {
  const { existsSync } = require('node:fs');
  if (!existsSync(dictionaryDbPath)) return { entries: [], occurrences: [] };
  return {
    entries: tableExists(dictionaryDbPath, 'dictionary_entries')
      ? readSqliteJson(dictionaryDbPath, 'SELECT * FROM dictionary_entries')
      : [],
    occurrences: tableExists(dictionaryDbPath, 'dictionary_occurrences')
      ? readSqliteJson(dictionaryDbPath, 'SELECT * FROM dictionary_occurrences')
      : [],
  };
}

function readQuoteRows(citasDbPath) {
  const { existsSync } = require('node:fs');
  if (!existsSync(citasDbPath)) return [];
  return tableExists(citasDbPath, 'quotes')
    ? readSqliteJson(citasDbPath, 'SELECT * FROM quotes')
    : [];
}

function readAnnotationRows(annotationsDbPath) {
  const { existsSync } = require('node:fs');
  if (!existsSync(annotationsDbPath)) return [];
  return tableExists(annotationsDbPath, 'annotations')
    ? readSqliteJson(annotationsDbPath, 'SELECT * FROM annotations')
    : [];
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

export function normalizeTerm(s) {
  if (s === null || s === undefined) return '';
  return String(s).normalize('NFC').toLowerCase().replace(/\u00ad/g, '');
}

export function computeSemanticKey(row) {
  if (!row?.fields_jsonb) return null;
  const term = row.fields_jsonb?.term?.v;
  const language = row.fields_jsonb?.language?.v;
  if (!term || typeof term !== 'string' || term.trim() === '') return null;
  return `${normalizeTerm(term)}|${normalizeTerm(language ?? '')}`;
}

function fieldValue(row, field) {
  const envelope = row?.fields_jsonb?.[field];
  return envelope && typeof envelope === 'object' && 'v' in envelope ? envelope.v : null;
}

function replicaVisibleId(row, kind) {
  const replicaId = String(row?.replica_id ?? '');
  const prefix = `${kind}:`;
  return replicaId.startsWith(prefix) ? replicaId.slice(prefix.length) : replicaId;
}

function hlcMillis(hlc) {
  const firstSegment = String(hlc ?? '').split('-')[0] ?? '';
  const parsed = Number.parseInt(firstSegment, 16);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function ensureDesktopReplicaTables(dbPath, kind) {
  const visibleDdl = {
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
  }[kind];
  execSqlite(dbPath, `
    CREATE TABLE IF NOT EXISTS _replicas (
      replica_id TEXT PRIMARY KEY, kind TEXT, user_id TEXT, fields_jsonb TEXT,
      manifest_jsonb TEXT, deleted_at_ts TEXT, reincarnation TEXT, updated_at_ts TEXT,
      schema_version INTEGER, semantic_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_replicas_kind_updated_at ON _replicas(kind, updated_at_ts);
    ${visibleDdl}
  `);
  // Migration: add semantic_key to existing _replicas tables that lack it
  maybeAddSemanticKeyColumn(dbPath);
}

function maybeAddSemanticKeyColumn(dbPath) {
  try {
    const cols = readSqliteJson(dbPath, `PRAGMA table_info(_replicas)`);
    if (!cols.some(c => c.name === 'semantic_key')) {
      execSqlite(dbPath, `ALTER TABLE _replicas ADD COLUMN semantic_key TEXT`);
    }
  } catch {
    // _replicas table doesn't exist yet — nothing to migrate
  }
}

function newerOrEqualReplicaExists(dbPath, replicaId, updatedAtTs) {
  const rows = readSqliteJson(dbPath, `SELECT updated_at_ts FROM _replicas WHERE replica_id = ${sqlValue(replicaId)} LIMIT 1`);
  return typeof rows[0]?.updated_at_ts === 'string' && rows[0].updated_at_ts >= updatedAtTs;
}

export function newerOrEqualSemanticReplicaExists(dbPath, semanticKey, updatedAtTs) {
  if (!semanticKey) return false;
  const rows = readSqliteJson(dbPath, `SELECT updated_at_ts FROM _replicas WHERE semantic_key = ${sqlValue(semanticKey)} AND kind = 'dictionary-entry' LIMIT 1`);
  return typeof rows[0]?.updated_at_ts === 'string' && rows[0].updated_at_ts >= updatedAtTs;
}

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

function replicaTimestampJson(row) {
  const entries = Object.entries(row.fields_jsonb ?? {}).map(([key, envelope]) => [key, envelope?.t ?? row.updated_at_ts]);
  return JSON.stringify(Object.fromEntries(entries));
}

function upsertVisibleRow(dbPath, kind, row) {
  const id = replicaVisibleId(row, kind);
  const updatedAt = hlcMillis(row.updated_at_ts);
  const deletedAt = row.deleted_at_ts ? hlcMillis(row.deleted_at_ts) : null;
  const timestamps = kind === 'quote' ? null : replicaTimestampJson(row);
  if (kind === 'dictionary-entry') {
    execSqlite(dbPath, `
      INSERT OR REPLACE INTO dictionary_entries
      (id, term, display_term, language, definition, image_path, curiosity, enrichment_status, replica_timestamps, created_at, updated_at, deleted_at)
      VALUES (${sqlValue(id)}, ${sqlValue(fieldValue(row, 'term'))}, ${sqlValue(fieldValue(row, 'displayTerm'))},
        ${sqlValue(fieldValue(row, 'language'))}, ${sqlValue(fieldValue(row, 'definition'))}, ${sqlValue(fieldValue(row, 'imagePath'))},
        ${sqlValue(fieldValue(row, 'curiosity'))}, ${sqlValue(fieldValue(row, 'enrichmentStatus'))}, ${sqlValue(timestamps)},
        ${sqlValue(updatedAt)}, ${sqlValue(updatedAt)}, ${sqlValue(deletedAt)});
    `);
    return true;
  }
  if (kind === 'dictionary-occurrence') {
    const entryId = fieldValue(row, 'entryId');
    const entries = readSqliteJson(dbPath, `SELECT id FROM dictionary_entries WHERE id = ${sqlValue(entryId)} LIMIT 1`);
    if (entries.length === 0) return false;
    execSqlite(dbPath, `
      INSERT OR REPLACE INTO dictionary_occurrences
      (id, entry_id, book_hash, book_title, book_author, cfi, section_href, page, selected_text, context_before, context_after, highlight_note_id, replica_timestamps, created_at, updated_at, deleted_at)
      VALUES (${sqlValue(id)}, ${sqlValue(entryId)}, ${sqlValue(fieldValue(row, 'bookHash'))}, ${sqlValue(fieldValue(row, 'bookTitle'))},
        ${sqlValue(fieldValue(row, 'bookAuthor'))}, ${sqlValue(fieldValue(row, 'cfi'))}, ${sqlValue(fieldValue(row, 'sectionHref'))},
        ${sqlValue(fieldValue(row, 'page'))}, ${sqlValue(fieldValue(row, 'selectedText'))}, ${sqlValue(fieldValue(row, 'contextBefore'))},
        ${sqlValue(fieldValue(row, 'contextAfter'))}, ${sqlValue(fieldValue(row, 'highlightNoteId'))}, ${sqlValue(timestamps)},
        ${sqlValue(updatedAt)}, ${sqlValue(updatedAt)}, ${sqlValue(deletedAt)});
    `);
    return true;
  }
  if (kind === 'quote') {
    execSqlite(dbPath, `
      INSERT OR REPLACE INTO quotes
      (id, book_hash, book_title, book_author, cfi, section_href, page, text, context_before, context_after, content_hash, created_at, updated_at, deleted_at)
      VALUES (${sqlValue(id)}, ${sqlValue(fieldValue(row, 'bookHash'))}, ${sqlValue(fieldValue(row, 'bookTitle'))}, ${sqlValue(fieldValue(row, 'bookAuthor'))},
        ${sqlValue(fieldValue(row, 'cfi'))}, ${sqlValue(fieldValue(row, 'sectionHref'))}, ${sqlValue(fieldValue(row, 'page'))},
        ${sqlValue(fieldValue(row, 'text'))}, ${sqlValue(fieldValue(row, 'contextBefore'))}, ${sqlValue(fieldValue(row, 'contextAfter'))},
        ${sqlValue(fieldValue(row, 'contentHash'))}, ${sqlValue(updatedAt)}, ${sqlValue(updatedAt)}, ${sqlValue(deletedAt)});
    `);
    return true;
  }
  execSqlite(dbPath, `
    INSERT OR REPLACE INTO annotations
    (id, book_hash, book_title, book_author, cfi, section_href, page, text, note, style, color, created_at, updated_at, deleted_at, replica_timestamps)
    VALUES (${sqlValue(id)}, ${sqlValue(fieldValue(row, 'bookHash'))}, ${sqlValue(fieldValue(row, 'bookTitle'))}, ${sqlValue(fieldValue(row, 'bookAuthor'))},
      ${sqlValue(fieldValue(row, 'cfi'))}, ${sqlValue(fieldValue(row, 'sectionHref'))}, ${sqlValue(fieldValue(row, 'page'))},
      ${sqlValue(fieldValue(row, 'text'))}, ${sqlValue(fieldValue(row, 'note'))}, ${sqlValue(fieldValue(row, 'style'))},
      ${sqlValue(fieldValue(row, 'color'))}, ${sqlValue(updatedAt)}, ${sqlValue(updatedAt)}, ${sqlValue(deletedAt)}, ${sqlValue(timestamps)});
  `);
  return true;
}

function upsertReplicaRow(dbPath, kind, row) {
  ensureDesktopReplicaTables(dbPath, kind);
  if (!row?.replica_id || !row?.updated_at_ts || newerOrEqualReplicaExists(dbPath, row.replica_id, row.updated_at_ts)) return false;
  if (!upsertVisibleRow(dbPath, kind, row)) return false;
  writeReplicaMetadata(dbPath, row);
  return true;
}

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

function desktopReplicaDbPath(dataRoot, kind) {
  const { join } = require('node:path');
  const readestDir = join(dataRoot, 'Readest');
  if (kind === 'quote') return join(readestDir, 'citas.db');
  if (kind === 'annotation') return join(readestDir, 'annotations.db');
  return join(readestDir, 'dictionary.db');
}

function applyReplicaRowsToDesktop(kind, rows, dbPath) {
  let applied = 0;
  for (const row of rows) {
    if (upsertReplicaRow(dbPath, kind, row)) applied++;
  }
  return applied;
}

function toHlc(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const millis = Number.isFinite(numeric) ? numeric : Date.parse(String(value || Date.now()));
  return `${Math.max(0, millis).toString(16).padStart(13, '0')}-00000001-visible`;
}

function replicaTimestamps(row) {
  if (!row.replica_timestamps) return {};
  try {
    const parsed = JSON.parse(row.replica_timestamps);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rowToReplica(row, kind, fieldMap, fallbackUpdatedAt) {
  const timestamps = replicaTimestamps(row);
  const fallbackTimestamp = toHlc(fallbackUpdatedAt ?? row.updated_at ?? row.created_at);
  const fields = {};
  for (const [replicaField, column] of Object.entries(fieldMap)) {
    fields[replicaField] = {
      v: row[column] ?? null,
      t: timestamps[replicaField] ?? fallbackTimestamp,
      s: 'visible',
    };
  }
  return {
    user_id: 'visible',
    kind,
    replica_id: `${kind}:${row.id}`,
    fields_jsonb: fields,
    manifest_jsonb: null,
    deleted_at_ts: row.deleted_at ? (timestamps.__deleted ?? toHlc(row.deleted_at)) : null,
    reincarnation: null,
    updated_at_ts: fallbackTimestamp,
    schema_version: 1,
  };
}

function dictionaryRowsToReplicas(rows) {
  return {
    entries: rows.entries.map((row) => rowToReplica(row, 'dictionary-entry', ENTRY_FIELDS, row.updated_at ?? row.created_at)),
    occurrences: rows.occurrences.map((row) => rowToReplica(row, 'dictionary-occurrence', OCCURRENCE_FIELDS, row.created_at ?? row.updated_at)),
  };
}

function appliedCount(data, attempted) {
  if (data && typeof data === 'object') {
    for (const key of ['applied', 'count', 'pushed']) {
      if (typeof data[key] === 'number') return data[key];
    }
  }
  return attempted;
}

async function putReplicas(baseUrl, kind, endpoint, rows, replicas) {
  replicas[kind].attempted = rows.length;
  if (rows.length === 0) return;
  let resp;
  try {
    resp = await fetch(`${baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    const message = `${kind} replica PUT failed: ${err instanceof Error ? err.message : String(err)}`;
    replicas[kind].failures.push(message);
    throw new Error(message);
  }
  const responseText = await resp.text();
  let data;
  try {
    data = responseText.trim() ? JSON.parse(responseText) : {};
  } catch (err) {
    const message = `${kind} replica PUT returned invalid JSON: ${err instanceof Error ? err.message : String(err)}${responseText ? `; body: ${responseText}` : ''}`;
    replicas[kind].failures.push(message);
    throw new Error(message);
  }
  if (!resp.ok) {
    const message = `${kind} replica PUT failed with ${resp.status}${responseText ? `: ${responseText}` : ''}`;
    replicas[kind].failures.push(message);
    throw new Error(message);
  }
  replicas[kind].applied = appliedCount(data, rows.length);
}

async function main() {
  requireDevHarness(process.env, 'sync-execute');
  const env = createSyncDevEnvironment();

  // Use Node's fetch (18+) to call Android server
  const baseUrl = env.android.serverUrl;

  // Build a minimal USB transport using fetch
  const transport = {
    kind: 'usb',
    async pullBookManifest() {
      const resp = await fetch(`${baseUrl}/books/manifest`);
      if (!resp.ok) throw new Error(`manifest: ${resp.status}`);
      return resp.json();
    },
    async pullBookAsset(hash, name) {
      const resp = await fetch(`${baseUrl}/books/${hash}/${name}`);
      if (!resp.ok) return null;
      return resp.arrayBuffer();
    },
    async pushBookLibrary(books) {
      const resp = await fetch(`${baseUrl}/books/index`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(books),
      });
      return resp.json();
    },
    async pushBookAsset(hash, name, bytes) {
      const resp = await fetch(`${baseUrl}/books/${hash}/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': name.endsWith('.png') ? 'image/png' : 'application/octet-stream' },
        body: bytes,
      });
      return resp.json();
    },
    async pushBookConfig(hash, json) {
      // Config is handled within pushBookAsset for config.json
    },
    async pullBookConfig(hash) {
      const resp = await fetch(`${baseUrl}/books/${hash}/config`);
      if (!resp.ok) return null;
      return resp.text();
    },
  };

  let sent = 0;
  let received = 0;
  const replicas = emptyReplicaEvidence();
  const evidence = { path: 'syncResult.replicas' };

  try {
    const { join } = await import('node:path');
    const dataRoot = env.desktop.dataRoot;
    const dictionaryRows = dictionaryRowsToReplicas(readDictionaryRows(join(dataRoot, 'Readest', 'dictionary.db')));

    const dictDbPath = desktopReplicaDbPath(dataRoot, 'dictionary-entry');
    ensureDesktopReplicaTables(dictDbPath, 'dictionary-entry');
    const filteredEntries = filterUnchangedReplicas(dictDbPath, dictionaryRows.entries, 'dictionary-entry');
    await putReplicas(baseUrl, 'dictionary-entry', DICTIONARY_ENTRY_ENDPOINT, filteredEntries, replicas);
    if (filteredEntries.length > 0) {
      for (const row of filteredEntries) writeReplicaMetadata(dictDbPath, row);
    }

    const filteredOccurrences = filterUnchangedReplicas(dictDbPath, dictionaryRows.occurrences);
    await putReplicas(baseUrl, 'dictionary-occurrence', DICTIONARY_OCCURRENCE_ENDPOINT, filteredOccurrences, replicas);
    if (filteredOccurrences.length > 0) {
      ensureDesktopReplicaTables(dictDbPath, 'dictionary-occurrence');
      for (const row of filteredOccurrences) writeReplicaMetadata(dictDbPath, row);
    }

    const quoteRows = readQuoteRows(join(dataRoot, 'Readest', 'citas.db')).map(
      (row) => rowToReplica(row, 'quote', QUOTE_FIELDS, row.updated_at ?? row.created_at),
    );
    const quoteDbPath = desktopReplicaDbPath(dataRoot, 'quote');
    const filteredQuotes = filterUnchangedReplicas(quoteDbPath, quoteRows);
    await putReplicas(baseUrl, 'quote', QUOTE_ENDPOINT, filteredQuotes, replicas);
    if (filteredQuotes.length > 0) {
      ensureDesktopReplicaTables(quoteDbPath, 'quote');
      for (const row of filteredQuotes) writeReplicaMetadata(quoteDbPath, row);
    }

    const annotationRows = readAnnotationRows(join(dataRoot, 'Readest', 'annotations.db')).map(
      (row) => rowToReplica(row, 'annotation', ANNOTATION_FIELDS, row.updated_at ?? row.created_at),
    );
    const annotationDbPath = desktopReplicaDbPath(dataRoot, 'annotation');
    const filteredAnnotations = filterUnchangedReplicas(annotationDbPath, annotationRows);
    await putReplicas(baseUrl, 'annotation', ANNOTATION_ENDPOINT, filteredAnnotations, replicas);
    if (filteredAnnotations.length > 0) {
      ensureDesktopReplicaTables(annotationDbPath, 'annotation');
      for (const row of filteredAnnotations) writeReplicaMetadata(annotationDbPath, row);
    }

    for (const [kind, endpoint] of REPLICA_PULL_ORDER) {
      const rows = await getReplicas(baseUrl, kind, endpoint, replicas);
      const dbPath = desktopReplicaDbPath(env.desktop.dataRoot, kind);
      const filtered = filterUnchangedReplicas(dbPath, rows);
      replicas[kind].pulled = filtered.length;
      replicas[kind].appliedToDesktop = applyReplicaRowsToDesktop(kind, filtered, dbPath);
    }

  // Read local library
  const { readFileSync, existsSync } = await import('node:fs');
  const libraryPath = join(env.desktop.dataRoot, 'Readest', 'Books', 'library.json');
  const localLibrary = existsSync(libraryPath) ? JSON.parse(readFileSync(libraryPath, 'utf8')) : [];
  console.log(`Local books: ${localLibrary.length}`);

  // Pull remote manifest
  const remoteManifest = await transport.pullBookManifest();
  const remoteBooks = new Map(remoteManifest.books.map(e => [e.hash, e.book]));
  console.log(`Remote books: ${remoteBooks.size}`);

  // Push new books
  for (const book of localLibrary) {
    if (book.deletedAt) continue;
    if (remoteBooks.has(book.hash)) continue;
    await transport.pushBookLibrary([book]);
    sent++;
    console.log(`Sent: ${book.hash} (${book.title})`);
  }

  // Pull new books
  for (const [hash, book] of remoteBooks) {
    if (book.deletedAt) continue;
    if (localLibrary.some(b => b.hash === hash)) continue;
    received++;
    console.log(`Received: ${hash} (${book.title})`);
  }

    console.log(JSON.stringify({ ok: true, sent, received, replicas, evidence }));
  } catch (err) {
    console.log(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      sent,
      received,
      replicas,
      evidence,
    }));
    process.exitCode = 1;
  }
}

// Guard: only run main() when executed directly, not when imported for tests
if (process.argv[1] === __filename) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
