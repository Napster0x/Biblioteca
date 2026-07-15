// Direct sync execution - no browser, no polling, no trigger counter
import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  filterUnchangedReplicas,
  writeReplicaMetadata,
  newerOrEqualReplicaExists,
  ensureReplicaTables,
  normalizeTerm,
} from './sync-filter-standalone.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

const DICTIONARY_ENTRY_ENDPOINT = '/replicas/dictionary-entry';
const DICTIONARY_OCCURRENCE_ENDPOINT = '/replicas/dictionary-occurrence';
const QUOTE_ENDPOINT = '/replicas/quote';
const ANNOTATION_ENDPOINT = '/replicas/annotation';
const PENDING_ANDROID_BOOK_TOMBSTONES_PATH =
  process.env.BIBLIOTECA_PENDING_ANDROID_BOOK_TOMBSTONES_PATH
    ?? '/tmp/biblioteca-dev-sync/pending-android-book-tombstones.json';

export const ENTRY_FIELDS = {
  term: 'term',
  displayTerm: 'display_term',
  language: 'language',
  definition: 'definition',
  imagePath: 'image_path',
  curiosity: 'curiosity',
  enrichmentStatus: 'enrichment_status',
};

export const OCCURRENCE_FIELDS = {
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

export const QUOTE_FIELDS = {
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

export const ANNOTATION_FIELDS = {
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

export function hlcGt(a, b) {
  const segA = String(a ?? '').split('-');
  const segB = String(b ?? '').split('-');

  const msA = Number.parseInt(segA[0], 16);
  const msB = Number.parseInt(segB[0], 16);
  if (!Number.isFinite(msA) && !Number.isFinite(msB)) {
    // Both unparseable (e.g. harness "T100") — fall back to string comparison
    return String(a) > String(b);
  }
  if (!Number.isFinite(msA)) return false;
  if (!Number.isFinite(msB)) return true;
  if (msA !== msB) return msA > msB;

  const counterA = Number.parseInt(segA[1], 16);
  const counterB = Number.parseInt(segB[1], 16);
  if (!Number.isFinite(counterA) && !Number.isFinite(counterB)) {
    return String(segA[2] ?? '') > String(segB[2] ?? '');
  }
  if (!Number.isFinite(counterA)) return false;
  if (!Number.isFinite(counterB)) return true;
  if (counterA !== counterB) return counterA > counterB;

  // Tiebreaker: deviceId string comparison
  return String(segA[2] ?? '') > String(segB[2] ?? '');
}

function replicaTimestampJson(row) {
  const entries = Object.entries(row.fields_jsonb ?? {}).map(([key, envelope]) => [key, envelope?.t ?? row.updated_at_ts]);
  return JSON.stringify(Object.fromEntries(entries));
}

function upsertVisibleRow(dbPath, kind, row) {
  const id = replicaVisibleId(row, kind);
  const updatedAt = hlcMillis(row.updated_at_ts);
  const deletedAt = row.deleted_at_ts ? hlcMillis(row.deleted_at_ts) : null;
  const timestamps = replicaTimestampJson(row);
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
      (id, book_hash, book_title, book_author, cfi, section_href, page, text, context_before, context_after, content_hash, replica_timestamps, created_at, updated_at, deleted_at)
      VALUES (${sqlValue(id)}, ${sqlValue(fieldValue(row, 'bookHash'))}, ${sqlValue(fieldValue(row, 'bookTitle'))}, ${sqlValue(fieldValue(row, 'bookAuthor'))},
        ${sqlValue(fieldValue(row, 'cfi'))}, ${sqlValue(fieldValue(row, 'sectionHref'))}, ${sqlValue(fieldValue(row, 'page'))},
        ${sqlValue(fieldValue(row, 'text'))}, ${sqlValue(fieldValue(row, 'contextBefore'))}, ${sqlValue(fieldValue(row, 'contextAfter'))},
        ${sqlValue(fieldValue(row, 'contentHash'))}, ${sqlValue(timestamps)}, ${sqlValue(updatedAt)}, ${sqlValue(updatedAt)}, ${sqlValue(deletedAt)});
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

export function upsertReplicaRow(dbPath, kind, row) {
  ensureReplicaTables(dbPath, kind);
  if (!row?.replica_id || !row?.updated_at_ts || newerOrEqualReplicaExists(dbPath, row.replica_id, row.updated_at_ts)) return false;
  if (!upsertVisibleRow(dbPath, kind, row)) return false;
  writeReplicaMetadata(dbPath, row);
  return true;
}

// ── Desktop merge bypass: resolve semantic identity ────────────────────────

/**
 * Find the canonical replica_id for an incoming row by semantic content.
 *
 * Mirrors Rust `resolve_semantic_id()` in `visible_repo.rs`.
 *
 * - dictionary-entry: matches by normalized(term) + language, NOT deleted, different id
 * - quote: matches by bookHash + contentHash, NOT deleted, different id
 * - annotation: matches by bookHash + cfi + text, NOT deleted, different id
 * - dictionary-occurrence: always returns null (each occurrence is a distinct event)
 *
 * @returns {string|null} canonical replica_id (e.g., "dictionary-entry:abc123") or null
 */
export function resolveSemanticId(row, kind, dbPath) {
  const itemId = replicaVisibleId(row, kind);
  const fields = row.fields_jsonb ?? {};

  if (kind === 'dictionary-entry') {
    const termRaw = fieldValue(row, 'term');
    const normalized = normalizeTerm(termRaw ?? '');
    if (!normalized) return null;
    const lang = fieldValue(row, 'language') ?? '';
    const rows = readSqliteJson(dbPath,
      `SELECT id FROM dictionary_entries WHERE LOWER(term) = ${sqlValue(normalized)} AND IFNULL(language,'') = IFNULL(${sqlValue(lang)},'') AND deleted_at IS NULL AND id != ${sqlValue(itemId)} LIMIT 1`);
    if (rows.length > 0 && rows[0].id) return `dictionary-entry:${rows[0].id}`;
    return null;
  }

  if (kind === 'quote') {
    const bookHash = fieldValue(row, 'bookHash');
    const contentHash = fieldValue(row, 'contentHash');
    if (!bookHash || !contentHash) return null;
    const rows = readSqliteJson(dbPath,
      `SELECT id FROM quotes WHERE book_hash = ${sqlValue(bookHash)} AND content_hash = ${sqlValue(contentHash)} AND deleted_at IS NULL AND id != ${sqlValue(itemId)} LIMIT 1`);
    if (rows.length > 0 && rows[0].id) return `quote:${rows[0].id}`;
    return null;
  }

  if (kind === 'annotation') {
    const bookHash = fieldValue(row, 'bookHash');
    const cfi = fieldValue(row, 'cfi');
    const text = fieldValue(row, 'text');
    if (!bookHash || !cfi) return null;
    const textSql = text !== null && text !== undefined ? ` AND text = ${sqlValue(text)}` : ` AND text = ${sqlValue(null)}`;
    const rows = readSqliteJson(dbPath,
      `SELECT id FROM annotations WHERE book_hash = ${sqlValue(bookHash)} AND cfi = ${sqlValue(cfi)}${textSql} AND deleted_at IS NULL AND id != ${sqlValue(itemId)} LIMIT 1`);
    if (rows.length > 0 && rows[0].id) return `annotation:${rows[0].id}`;
    return null;
  }

  // dictionary-occurrence and unknown kinds: no semantic dedup
  return null;
}

/**
 * Merge incoming fields_jsonb into existing fields_jsonb using per-field HLC
 * comparison. Fields absent in incoming are preserved from existing. Fields
 * present in incoming overwrite existing ONLY when incoming HLC > existing HLC.
 *
 * Mirrors Rust `merge_fields_jsonb()` in `visible_repo.rs`.
 *
 * @param {object} existing - existing fields_jsonb object (or empty object {})
 * @param {object} incoming - incoming fields_jsonb object
 * @returns {object} merged fields_jsonb (new object, inputs not mutated)
 */
export function mergeReplicaFields(existing, incoming) {
  const merged = { ...existing };
  for (const [key, incomingEnv] of Object.entries(incoming)) {
    const existingEnv = merged[key];
    const incomingT = incomingEnv?.t ?? '';
    const shouldOverwrite = !existingEnv || hlcGt(incomingT, existingEnv?.t ?? '');
    if (shouldOverwrite) {
      merged[key] = incomingEnv;
    }
  }
  return merged;
}

function desktopReplicaDbPath(dataRoot, kind) {
  const { join } = require('node:path');
  const readestDir = join(dataRoot, 'Readest');
  if (kind === 'quote') return join(readestDir, 'citas.db');
  if (kind === 'annotation') return join(readestDir, 'annotations.db');
  return join(readestDir, 'dictionary.db');
}

export async function applyReplicaRowsToDesktop(kind, rows, dbPath) {
  if (!rows || rows.length === 0) return 0;

  // Harness environment: write directly to SQLite with full CRDT merge.
  // Must replicate the Rust push() pipeline:
  //   resolve_semantic_id → HLC gate → merge_fields_jsonb → upsert.
  // Without this merge, INSERT OR REPLACE blindly overwrites fields
  // causing the desktop harness to lose data from previous sync rounds.
  if (process.env.BIBLIOTECA_DEV_SYNC_HARNESS === '1') {
    ensureReplicaTables(dbPath, kind);
    let applied = 0;
    for (const row of rows) {
      const originalReplicaId = row.replica_id;

      // Step 1: resolve semantic identity
      const canonicalId = resolveSemanticId(row, kind, dbPath);
      const isSemanticRemap = canonicalId !== null && canonicalId !== row.replica_id;
      if (canonicalId) {
        row.replica_id = canonicalId;
      }

      // Step 2: read existing _replicas entry for HLC gate and existing fields
      const existingRows = readSqliteJson(dbPath,
        `SELECT fields_jsonb, updated_at_ts FROM _replicas WHERE replica_id = ${sqlValue(row.replica_id)} LIMIT 1`);

      let existingFields = {};
      if (existingRows.length > 0) {
        const existingHlc = existingRows[0].updated_at_ts;

        // HLC gate (matches Rust push() logic):
        // - Skip if existing HLC is strictly higher
        // - Skip if equal HLC and not a semantic remap (no-op)
        if (hlcGt(existingHlc, row.updated_at_ts)) continue;
        if (!isSemanticRemap && existingHlc === row.updated_at_ts) continue;

        try { existingFields = JSON.parse(existingRows[0].fields_jsonb); } catch (_) {}
      }

      // Step 3: merge fields (per-field HLC comparison)
      row.fields_jsonb = mergeReplicaFields(existingFields, row.fields_jsonb);

      // Step 4: write to app table (uses merged fields via fieldValue)
      if (!upsertVisibleRow(dbPath, kind, row)) continue;

      // Step 5: write to _replicas metadata table
      writeReplicaMetadata(dbPath, row);
      applied++;
    }
    return applied;
  }

  // Production: route through the desktop's local sync server so the full
  // CRDT merge pipeline (semantic remap, HLC gate, per-field merge,
  // app-table sync) is applied via visible_repo.rs::push(). In production,
  // the local sync server and the caller use the same data directory
  // (Tauri's app_data_dir), so there is no path mismatch.
  const desktopServerUrl = process.env.BIBLIOTECA_DESKTOP_SYNC_URL || 'http://localhost:7878';
  try {
    const resp = await fetch(`${desktopServerUrl}/replicas/${kind}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    const result = await resp.json();
    return typeof result.count === 'number' ? result.count : rows.length;
  } catch (err) {
    // Fall back to direct SQLite if the sync server is not available.
    console.error(`applyReplicaRowsToDesktop(${kind}): sync server unavailable, falling back to SQLite: ${err.message}`);
    let applied = 0;
    for (const row of rows) {
      if (upsertReplicaRow(dbPath, kind, row)) applied++;
    }
    return applied;
  }
}

export function toHlc(value) {
  if (typeof value === 'string' && /^[0-9a-f]+-[0-9a-f]+-[A-Za-z0-9_-]+$/i.test(value)) {
    return value;
  }
  // Harness generates timestamps as T<millis> (e.g., T1783984749748).
  // Parse decimal after stripping the T prefix to produce proper HLC hex.
  if (typeof value === 'string' && /^T\d+$/.test(value)) {
    const millis = parseInt(value.slice(1), 10);
    if (Number.isFinite(millis) && millis >= 0) {
      return `${millis.toString(16).padStart(13, '0')}-00000000-visible`;
    }
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  const millis = Number.isFinite(numeric) ? numeric : Date.parse(String(value || Date.now()));
  return `${Math.max(0, millis).toString(16).padStart(13, '0')}-00000001-visible`;
}

export function normalizeBookTimestamp(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value).trim();
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function remoteBookFromIndexEntry(entry) {
  return entry?.book && typeof entry.book === 'object' ? entry.book : entry;
}

function booksFromIndexPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.books)) return payload.books;
  if (Array.isArray(payload?.index)) return payload.index;
  return [];
}

function localBookMaxMillis(book) {
  return Math.max(
    normalizeBookTimestamp(book?.updatedAt),
    normalizeBookTimestamp(book?.deletedAt),
    normalizeBookTimestamp(book?.importedAt),
    normalizeBookTimestamp(book?.createdAt),
  );
}

export function mergeRemoteBookTombstones(localLibrary, remoteIndexBooks, pendingAndroidDeletes = []) {
  const library = Array.isArray(localLibrary) ? localLibrary.map((book) => ({ ...book })) : [];
  const indexByHash = new Map(library.map((book, index) => [book.hash, index]).filter(([hash]) => hash));
  let applied = 0;

  for (const entry of [...booksFromIndexPayload(remoteIndexBooks), ...booksFromIndexPayload(pendingAndroidDeletes)]) {
    const remoteBook = remoteBookFromIndexEntry(entry);
    const hash = remoteBook?.hash ?? entry?.hash;
    if (!hash || !remoteBook?.deletedAt) continue;

    const remoteDeletedAtMillis = normalizeBookTimestamp(remoteBook.deletedAt);
    if (remoteDeletedAtMillis <= 0) continue;

    const localIndex = indexByHash.get(hash);
    const localBook = localIndex === undefined ? { hash } : library[localIndex];
    if (remoteDeletedAtMillis <= localBookMaxMillis(localBook)) continue;

    const mergedBook = { ...localBook, ...remoteBook, hash, deletedAt: remoteBook.deletedAt };
    if (localIndex === undefined) {
      indexByHash.set(hash, library.length);
      library.push(mergedBook);
    } else {
      library[localIndex] = mergedBook;
    }
    applied++;
  }

  return { library, applied };
}

export function mergeRemoteBookMetadata(localLibrary, remoteIndexBooks) {
  const library = Array.isArray(localLibrary) ? localLibrary.map((book) => ({ ...book })) : [];
  const indexByHash = new Map(library.map((book, index) => [book.hash, index]).filter(([hash]) => hash));
  let applied = 0;

  for (const entry of booksFromIndexPayload(remoteIndexBooks)) {
    const remoteBook = remoteBookFromIndexEntry(entry);
    const hash = remoteBook?.hash ?? entry?.hash;
    if (!hash || remoteBook?.deletedAt) continue;

    const remoteUpdatedAtMillis = localBookMaxMillis(remoteBook);
    if (remoteUpdatedAtMillis <= 0) continue;

    // When timestamps are equal, use book.hash as deterministic tiebreaker.
    // For the same book (same hash), this preserves the existing book (local wins).
    const localIndex = indexByHash.get(hash);
    const localBook = localIndex === undefined ? { hash } : library[localIndex];
    const localMax = localBookMaxMillis(localBook);
    if (remoteUpdatedAtMillis < localMax) continue;
    if (remoteUpdatedAtMillis === localMax && hash <= (localBook.hash ?? '')) continue;

    const mergedBook = { ...localBook, ...remoteBook, hash, deletedAt: null };
    if (localIndex === undefined) {
      indexByHash.set(hash, library.length);
      library.push(mergedBook);
    } else {
      library[localIndex] = mergedBook;
    }
    applied++;
  }

  return { library, applied };
}

function bookForLibraryPush(book) {
  if (book?.deletedAt) return book;
  const orderingTimestamp = Math.max(
    normalizeBookTimestamp(book?.createdAt),
    normalizeBookTimestamp(book?.updatedAt),
    normalizeBookTimestamp(book?.importedAt),
  );
  if (orderingTimestamp <= 0) return book;
  return {
    ...book,
    createdAt: normalizeBookTimestamp(book?.createdAt) || orderingTimestamp,
    updatedAt: normalizeBookTimestamp(book?.updatedAt) || orderingTimestamp,
    importedAt: normalizeBookTimestamp(book?.importedAt) || orderingTimestamp,
  };
}

function consumePendingAndroidBookTombstones(markerPath = PENDING_ANDROID_BOOK_TOMBSTONES_PATH) {
  const { existsSync, readFileSync, unlinkSync } = require('node:fs');
  if (!existsSync(markerPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8'));
    return booksFromIndexPayload(parsed);
  } catch {
    return [];
  } finally {
    try { unlinkSync(markerPath); } catch {}
  }
}

export function mergeRemoteBookTombstonesIntoLibraryFile(libraryPath, remoteIndexBooks, pendingAndroidDeletes = []) {
  const { existsSync, readFileSync, writeFileSync } = require('node:fs');
  const localLibrary = existsSync(libraryPath) ? JSON.parse(readFileSync(libraryPath, 'utf8')) : [];
  const result = mergeRemoteBookTombstones(localLibrary, remoteIndexBooks, pendingAndroidDeletes);
  if (result.applied > 0) {
    writeFileSync(libraryPath, `${JSON.stringify(result.library, null, 2)}\n`);
  }
  return result;
}

export function mergeRemoteBookMetadataIntoLibraryFile(libraryPath, remoteIndexBooks) {
  const { existsSync, readFileSync, writeFileSync } = require('node:fs');
  const localLibrary = existsSync(libraryPath) ? JSON.parse(readFileSync(libraryPath, 'utf8')) : [];
  const result = mergeRemoteBookMetadata(localLibrary, remoteIndexBooks);
  if (result.applied > 0) {
    writeFileSync(libraryPath, `${JSON.stringify(result.library, null, 2)}\n`);
  }
  return result;
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

export function rowToReplica(row, kind, fieldMap, fallbackUpdatedAt) {
  const timestamps = replicaTimestamps(row);
  const fallbackTimestamp = toHlc(fallbackUpdatedAt ?? row.updated_at ?? row.created_at);
  const fields = {};
  for (const [replicaField, column] of Object.entries(fieldMap)) {
    fields[replicaField] = {
      v: row[column] ?? null,
      t: toHlc(timestamps[replicaField] ?? fallbackTimestamp),
      s: 'visible',
    };
  }

  // Compute max timestamp from row timestamp + all valid field envelope HLCs + deleted HLC.
  // This ensures that a field-only edit (e.g. definition updated via replica_timestamps)
  // produces a replica with high enough updated_at_ts to pass filtering and push gates.
  // Only valid HLC strings participate in the max. Non-HLC formats (e.g. harness "T${ts}")
  // are excluded so fallbackTimestamp remains the authoritative value for those cases.
  const HLC_RE = /^[0-9a-f]+-[0-9a-f]+-[A-Za-z0-9_-]+$/;
  const fieldTimestamps = Object.values(fields)
    .map(f => f.t)
    .filter(t => HLC_RE.test(String(t)));
  const allTimestamps = [fallbackTimestamp, ...fieldTimestamps];

  const deleted_at_ts = row.deleted_at ? (timestamps.__deleted ?? toHlc(row.deleted_at)) : null;
  if (deleted_at_ts) allTimestamps.push(deleted_at_ts);

  const maxTimestamp = allTimestamps.reduce((max, t) => hlcGt(t, max) ? t : max);

  return {
    user_id: 'visible',
    kind,
    replica_id: `${kind}:${row.id}`,
    fields_jsonb: fields,
    manifest_jsonb: null,
    deleted_at_ts,
    reincarnation: null,
    updated_at_ts: maxTimestamp,
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

/**
 * Push a book's assets (EPUB, cover.png, config.json) to the Android device.
 *
 * The EPUB file is required — if missing, the whole function returns early.
 * cover.png and config.json are optional — missing files are skipped with a warning.
 *
 * Mirrors usbBookSync.ts sendBook() lines 213-227.
 */
export async function pushBookAssets(transport, book, booksDir) {
  const { join } = require('node:path');
  const { readFileSync, existsSync } = require('node:fs');
  const bookDir = join(booksDir, book.hash);

  // Push the EPUB (required) — skip if fileName is missing
  if (!book.fileName) {
    console.log(`  ⚠️ Book ${book.hash}: no fileName in library entry, skipping asset push`);
    return;
  }
  const epubPath = join(bookDir, book.fileName);
  if (!existsSync(epubPath)) {
    console.log(`  ⚠️ Book ${book.hash}: EPUB not found at ${book.fileName}, skipping asset push`);
    return;
  }
  await transport.pushBookAsset(book.hash, 'book', readFileSync(epubPath));

  // Push optional assets (cover.png, config.json)
  for (const asset of ['cover.png', 'config.json']) {
    const assetPath = join(bookDir, asset);
    if (!existsSync(assetPath)) {
      console.log(`  ⚠️ Book ${book.hash}: ${asset} not found, skipping`);
      continue;
    }
    await transport.pushBookAsset(book.hash, asset, readFileSync(assetPath));
  }
}

/**
 * Push local books to Android.
 *
 * - Live books (no deletedAt) that are NOT in the remote manifest are pushed
 *   along with their assets (EPUB, cover, config).
 * - Tombstoned books (deletedAt set) are pushed to Android `/books/index`
 *   regardless of whether they exist in the remote manifest, so that Android
 *   can converge on the deletion.
 *
 * @param {object} transport - transport with pushBookLibrary and pushBookAssets
 * @param {Array<object>} localLibrary - desktop library entries
 * @param {Map<string, object>} remoteBooks - Map of hash → book from Android manifest
 * @param {string} booksDir - path to Books directory on desktop
 * @returns {Promise<{sent: number, tombstonesPushed: number}>}
 */
export async function pushBooks(transport, localLibrary, remoteBooks, booksDir) {
  let sent = 0;
  let updated = 0;
  let tombstonesPushed = 0;

  for (const book of localLibrary) {
    if (book.deletedAt) {
      // Push tombstone to Android /books/index regardless of remote state
      await transport.pushBookLibrary([book]);
      tombstonesPushed++;
      continue;
    }

    const remoteEntry = remoteBooks.get(book.hash);
    if (remoteEntry) {
      // Book exists on remote — compare updatedAt to decide if metadata update is needed
      const remoteBook = remoteEntry.book ?? remoteEntry;
      const remoteUpdatedAt = normalizeBookTimestamp(remoteBook?.updatedAt);
      const localUpdatedAt = localBookMaxMillis(book);

      if (localUpdatedAt > remoteUpdatedAt) {
        // Metadata-only update — push library entry, NO asset push
        await transport.pushBookLibrary([bookForLibraryPush(book)]);
        updated++;
      }
      // localUpdatedAt <= remoteUpdatedAt: skip (no-op)
      continue;
    }

    // Book not on remote — push assets + metadata as a new book
    await transport.pushBookLibrary([bookForLibraryPush(book)]);
    await pushBookAssets(transport, book, booksDir);
    sent++;
  }

  return { sent, updated, tombstonesPushed };
}

// ── Progress reporting (for fire-and-forget UI mode) ──────────────────
const SYNC_RUN_ID = process.env.BIBLIOTECA_SYNC_RUN_ID;
const PROGRESS_DIR = '/tmp/biblioteca-dev-sync';

function writeProgress(progress, phase) {
  if (!SYNC_RUN_ID) return;
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
    const file = path.join(PROGRESS_DIR, `progress-${SYNC_RUN_ID}.json`);
    fs.writeFileSync(file, JSON.stringify({
      runId: SYNC_RUN_ID,
      progress,
      phase,
      timestamp: new Date().toISOString(),
      ok: true,
    }));
  } catch {
    /* best-effort — sync continues even if progress tracking fails */
  }
}

async function main() {
  requireDevHarness(process.env, 'sync-execute');
  const env = createSyncDevEnvironment();

  writeProgress(5, 'init');

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
    async pullBookIndex() {
      const resp = await fetch(`${baseUrl}/books/index`);
      if (!resp.ok) throw new Error(`books index: ${resp.status}`);
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
    async pushBookConfig(_hash, _json) {
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

    writeProgress(15, 'push-dict-entries');

    const dictDbPath = desktopReplicaDbPath(dataRoot, 'dictionary-entry');
    ensureReplicaTables(dictDbPath, 'dictionary-entry');
    const filteredEntries = filterUnchangedReplicas(dictDbPath, dictionaryRows.entries, 'dictionary-entry');
    await putReplicas(baseUrl, 'dictionary-entry', DICTIONARY_ENTRY_ENDPOINT, filteredEntries, replicas);
    if (filteredEntries.length > 0) {
      for (const row of filteredEntries) writeReplicaMetadata(dictDbPath, row);
    }

    writeProgress(20, 'push-dict-occurrences');

    const filteredOccurrences = filterUnchangedReplicas(dictDbPath, dictionaryRows.occurrences, 'dictionary-occurrence');
    await putReplicas(baseUrl, 'dictionary-occurrence', DICTIONARY_OCCURRENCE_ENDPOINT, filteredOccurrences, replicas);
    if (filteredOccurrences.length > 0) {
      ensureReplicaTables(dictDbPath, 'dictionary-occurrence');
      for (const row of filteredOccurrences) writeReplicaMetadata(dictDbPath, row);
    }

    writeProgress(25, 'push-quotes');

    const quoteRows = readQuoteRows(join(dataRoot, 'Readest', 'citas.db')).map(
      (row) => rowToReplica(row, 'quote', QUOTE_FIELDS, row.updated_at ?? row.created_at),
    );
    const quoteDbPath = desktopReplicaDbPath(dataRoot, 'quote');
    const filteredQuotes = filterUnchangedReplicas(quoteDbPath, quoteRows, 'quote');
    await putReplicas(baseUrl, 'quote', QUOTE_ENDPOINT, filteredQuotes, replicas);
    if (filteredQuotes.length > 0) {
      ensureReplicaTables(quoteDbPath, 'quote');
      for (const row of filteredQuotes) writeReplicaMetadata(quoteDbPath, row);
    }

    writeProgress(30, 'push-annotations');

    const annotationRows = readAnnotationRows(join(dataRoot, 'Readest', 'annotations.db')).map(
      (row) => rowToReplica(row, 'annotation', ANNOTATION_FIELDS, row.updated_at ?? row.created_at),
    );
    const annotationDbPath = desktopReplicaDbPath(dataRoot, 'annotation');
    const filteredAnnotations = filterUnchangedReplicas(annotationDbPath, annotationRows, 'annotation');
    await putReplicas(baseUrl, 'annotation', ANNOTATION_ENDPOINT, filteredAnnotations, replicas);
    if (filteredAnnotations.length > 0) {
      ensureReplicaTables(annotationDbPath, 'annotation');
      for (const row of filteredAnnotations) writeReplicaMetadata(annotationDbPath, row);
    }

    writeProgress(40, 'push-complete');

    let pullStep = 0;
    for (const [kind, endpoint] of REPLICA_PULL_ORDER) {
      pullStep++;
      writeProgress(40 + pullStep * 10, `pull-${kind}`);
      const rows = await getReplicas(baseUrl, kind, endpoint, replicas);
      const dbPath = desktopReplicaDbPath(env.desktop.dataRoot, kind);
      const filtered = filterUnchangedReplicas(dbPath, rows, kind);
      replicas[kind].pulled = filtered.length;
      replicas[kind].appliedToDesktop = await applyReplicaRowsToDesktop(kind, filtered, dbPath);
    }

  writeProgress(80, 'merge-books');

  // Read local library
  const { readFileSync, existsSync } = await import('node:fs');
  const libraryPath = join(env.desktop.dataRoot, 'Readest', 'Books', 'library.json');
  let localLibrary = existsSync(libraryPath) ? JSON.parse(readFileSync(libraryPath, 'utf8')) : [];
  console.log(`Local books: ${localLibrary.length}`);

  // Pull Android /books/index before pushing so newer remote tombstones win
  // over stale desktop live rows and cannot be accidentally resurrected.
  const remoteIndexBooks = await transport.pullBookIndex();
  const pendingAndroidDeletes = consumePendingAndroidBookTombstones();
  const tombstoneMerge = mergeRemoteBookTombstonesIntoLibraryFile(libraryPath, remoteIndexBooks, pendingAndroidDeletes);
  localLibrary = tombstoneMerge.library;
  evidence.remoteBookTombstonesMerged = tombstoneMerge.applied;
  evidence.pendingAndroidBookDeletes = pendingAndroidDeletes.length;
  const metadataMerge = mergeRemoteBookMetadataIntoLibraryFile(libraryPath, remoteIndexBooks);
  localLibrary = metadataMerge.library;
  evidence.remoteBookMetadataMerged = metadataMerge.applied;

  // Pull remote manifest
  const remoteManifest = await transport.pullBookManifest();
  const remoteBooks = new Map(remoteManifest.books.map(e => [e.hash, e.book]));
  console.log(`Remote books: ${remoteBooks.size}`);

  // Push new books and tombstones
  const booksDir = join(env.desktop.dataRoot, 'Readest', 'Books');
  const pushResult = await pushBooks(transport, localLibrary, remoteBooks, booksDir);
  sent = pushResult.sent;
  evidence.tombstonesPushed = pushResult.tombstonesPushed;

  writeProgress(95, 'push-books');

  // Pull new books
  for (const [hash, book] of remoteBooks) {
    if (book.deletedAt) continue;
    if (localLibrary.some(b => b.hash === hash)) continue;
      received++;
    console.log(`Received: ${hash} (${book.title})`);
  }

    writeProgress(100, 'complete');

    console.log(JSON.stringify({ ok: true, sent, received, tombstonesPushed: pushResult.tombstonesPushed, replicas, evidence }));
  } catch (err) {
    writeProgress(-1, 'error');
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
