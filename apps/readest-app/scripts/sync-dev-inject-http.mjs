/**
 * HTTP-based injection module for Android dev sync harness.
 *
 * Injects fixture data into Android via the replicas PUT API
 * instead of the broken ADB sqlite3 path.
 *
 * Reuses rowToReplica(), field maps, and millisToHlc() from sync-execute.mjs.
 *
 * Gate: BIBLIOTECA_DEV_SYNC_HARNESS=1 (enforced via requireDevHarness in caller).
 */

import {
  rowToReplica,
  ENTRY_FIELDS,
  OCCURRENCE_FIELDS,
  QUOTE_FIELDS,
  ANNOTATION_FIELDS,
} from './sync-execute.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

export const PENDING_ANDROID_BOOK_TOMBSTONES_PATH =
  process.env.BIBLIOTECA_PENDING_ANDROID_BOOK_TOMBSTONES_PATH
    ?? '/tmp/biblioteca-dev-sync/pending-android-book-tombstones.json';

const EDITABLE_BOOK_FIELDS = new Set(['title', 'author', 'coverImageUrl', 'groupId', 'readingStatus', 'progress', 'metadata']);

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Resolve the Android server URL from a sync-dev-environment object.
 *
 * @param {object} [env] — environment object (e.g., from createSyncDevEnvironment())
 * @param {object} [env.android] — android section
 * @param {string} [env.android.serverUrl] — server URL override
 * @returns {string} — the resolved server URL
 */
export function resolveAndroidServerUrl(env) {
  if (env?.android?.serverUrl) return env.android.serverUrl;
  return 'http://localhost:7878';
}

function fieldMapForKind(kind, options = {}) {
  return options.fieldMap ?? options.fields ?? TABLE_REPLICA_MAP[kind]?.fields;
}

async function putJson(serverUrl, path, body, table, inserted) {
  let resp;
  try {
    resp = await fetch(`${serverUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table,
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table,
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  return { ok: true, inserted, target: 'android-http', table };
}

async function putBytes(serverUrl, path, bytes, table) {
  let resp;
  try {
    resp = await fetch(`${serverUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table,
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table,
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  return { ok: true, inserted: 1, target: 'android-http', table };
}

async function getJson(serverUrl, path, table) {
  let resp;
  try {
    resp = await fetch(`${serverUrl}${path}`);
  } catch (err) {
    return {
      ok: false,
      target: 'android-http',
      table,
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      target: 'android-http',
      table,
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  try {
    return { ok: true, target: 'android-http', table, data: responseText ? JSON.parse(responseText) : null };
  } catch (err) {
    return {
      ok: false,
      target: 'android-http',
      table,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function booksFromIndexPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.books)) return payload.books;
  return null;
}

function resolveNowValue(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function validateBookUpdates(updates) {
  if (!updates || Object.keys(updates).length === 0) {
    return 'no book fields to update';
  }
  for (const field of Object.keys(updates)) {
    const rootField = field.startsWith('metadata.') ? 'metadata' : field;
    if (!EDITABLE_BOOK_FIELDS.has(rootField)) {
      return `Field is not editable by this harness: books.${field}`;
    }
  }
  return null;
}

function descriptorError(evidence, error) {
  return { ok: false, inserted: 0, target: 'android-http', table: 'books', evidence, error };
}

const SEMANTIC_TARGETS = {
  dictionary: {
    kind: 'dictionary-occurrence',
    table: 'dictionary_occurrences',
    noteRef: 'dictionaryEntryId',
    semanticIdFields: ['entry_id', 'entryId', 'dictionaryEntryId'],
    textFields: ['selected_text', 'selectedText', 'text'],
  },
  quote: {
    kind: 'quote',
    table: 'quotes',
    noteRef: 'citeId',
    semanticIdFields: ['id', 'quoteId', 'citeId'],
    textFields: ['text'],
  },
  annotation: {
    kind: 'annotation',
    table: 'annotations',
    noteRef: 'annotationId',
    semanticIdFields: ['id', 'annotationId'],
    textFields: ['note', 'text'],
  },
};

function normalizeSemanticKind(kind) {
  if (kind === 'dict' || kind === 'dictionary-occurrence' || kind === 'dictionary_entries' || kind === 'dictionary_occurrences') return 'dictionary';
  if (kind === 'cita' || kind === 'cite' || kind === 'quotes') return 'quote';
  if (kind === 'note' || kind === 'annotations') return 'annotation';
  return kind;
}

function rowValue(row, fields) {
  for (const field of fields) {
    const direct = row?.[field];
    if (direct !== undefined && direct !== null && direct !== '') return direct;
    const envelope = row?.fields_jsonb?.[field];
    if (envelope && envelope.v !== undefined && envelope.v !== null && envelope.v !== '') return envelope.v;
  }
  return undefined;
}

function rowId(row) {
  const direct = rowValue(row, ['id']);
  if (direct) return String(direct);
  const replicaId = row?.replica_id ?? row?.replicaId;
  if (typeof replicaId === 'string' && replicaId.includes(':')) return replicaId.slice(replicaId.indexOf(':') + 1);
  return replicaId ? String(replicaId) : undefined;
}

function rowIsDeleted(row) {
  return Boolean(row?.deleted_at || row?.deletedAt || row?.deleted_at_ts || row?.deleted);
}

function semanticRowBookHash(row) {
  return rowValue(row, ['book_hash', 'bookHash']);
}

function semanticRowCfi(row) {
  return rowValue(row, ['cfi']);
}

function semanticRowText(row, targetConfig) {
  return rowValue(row, targetConfig.textFields);
}

function semanticRowRef(row, targetConfig) {
  return rowValue(row, targetConfig.semanticIdFields) ?? rowId(row);
}

function idsMatch(expected, candidates) {
  if (!expected) return true;
  return candidates.some((candidate) => candidate !== undefined && candidate !== null && String(candidate) === String(expected));
}

function noteMatchesTarget(note, target, row, targetConfig) {
  if (note?.deletedAt) return false;
  const semanticRefFields = ['dictionaryEntryId', 'citeId', 'annotationId'];
  if (semanticRefFields.some((field) => field !== targetConfig.noteRef && note?.[field])) return false;
  if (target.noteId && note?.id !== target.noteId) return false;
  const semanticId = semanticRowRef(row, targetConfig);
  const idCandidates = [rowId(row), semanticId];
  if (target.id && !idsMatch(target.id, idCandidates)) return false;
  if (target.cfi && note?.cfi !== target.cfi) return false;
  if (target.text && note?.text !== target.text) return false;
  const ref = note?.[targetConfig.noteRef];
  if (ref) return idsMatch(ref, idCandidates);
  return (!target.id || idsMatch(target.id, [note?.id, semanticId, rowId(row)]))
    && (!target.cfi || note?.cfi === target.cfi)
    && (!target.text || note?.text === target.text);
}

function matchSemanticRow(row, target, targetConfig) {
  if (rowIsDeleted(row)) return false;
  if (semanticRowBookHash(row) !== target.bookHash) return false;
  const semanticId = semanticRowRef(row, targetConfig);
  if (target.id && !idsMatch(target.id, [rowId(row), semanticId])) return false;
  const explicitSemanticId = target.dictionaryEntryId ?? target.quoteId ?? target.citeId ?? target.annotationId ?? target.semanticId;
  if (explicitSemanticId && !idsMatch(explicitSemanticId, [semanticId, rowId(row)])) return false;
  if (target.cfi && semanticRowCfi(row) !== target.cfi) return false;
  if (target.text && semanticRowText(row, targetConfig) !== target.text) return false;
  return true;
}

function markBooknoteDeleted(config, noteId, deletedAt) {
  let deletedConfigNotes = 0;
  const booknotes = Array.isArray(config?.booknotes) ? config.booknotes : [];
  const nextBooknotes = booknotes.map((note) => {
    if (note?.id !== noteId || note.deletedAt) return note;
    deletedConfigNotes += 1;
    return { ...note, deletedAt };
  });
  return { config: { ...(config ?? {}), booknotes: nextBooknotes, updatedAt: deletedAt }, deletedConfigNotes };
}

function compareBookTimestamp(a, b) {
  const aMillis = bookTimestampMillis(a);
  const bMillis = bookTimestampMillis(b);
  if (!Number.isFinite(aMillis) || !Number.isFinite(bMillis)) return false;
  return aMillis > bMillis;
}

function bookTimestampMillis(value) {
  const millis = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(millis) ? millis : null;
}

export function recordPendingAndroidBookTombstone(tombstone, markerPath = PENDING_ANDROID_BOOK_TOMBSTONES_PATH) {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = awaitableRequireFs();
  const { dirname } = awaitableRequirePath();
  const deletedAt = Number(tombstone?.deletedAt ?? tombstone?.updatedAt);
  const hash = tombstone?.hash;
  if (!hash || !Number.isFinite(deletedAt)) return { recorded: 0, path: markerPath };

  mkdirSync(dirname(markerPath), { recursive: true });
  let existing = [];
  if (existsSync(markerPath)) {
    try {
      const parsed = JSON.parse(readFileSync(markerPath, 'utf8'));
      existing = Array.isArray(parsed) ? parsed : [];
    } catch {
      existing = [];
    }
  }
  const next = [
    ...existing.filter((entry) => entry?.hash !== hash),
    { hash, deletedAt, updatedAt: deletedAt },
  ];
  writeFileSync(markerPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { recorded: 1, path: markerPath };
}

export function clearPendingAndroidBookTombstone(hash, markerPath = PENDING_ANDROID_BOOK_TOMBSTONES_PATH) {
  const { existsSync, readFileSync, writeFileSync } = awaitableRequireFs();
  if (!hash || !existsSync(markerPath)) return { cleared: 0, path: markerPath };

  let existing = [];
  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8'));
    existing = Array.isArray(parsed) ? parsed : [];
  } catch {
    existing = [];
  }

  const next = existing.filter((entry) => entry?.hash !== hash);
  writeFileSync(markerPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { cleared: existing.length - next.length, path: markerPath };
}

function awaitableRequireFs() {
  return require('node:fs');
}

function awaitableRequirePath() {
  return require('node:path');
}

/**
 * Convert fixture rows to ReplicaRow[] and inject into Android via PUT /replicas/:kind.
 *
 * @param {string} serverUrl — Android server base URL (e.g., http://localhost:7878)
 * @param {string} kind — replica kind (dictionary-entry, dictionary-occurrence, quote, annotation)
 * @param {object[]} rows — fixture row objects
 * @param {object} fieldMap — field map from sync-execute.mjs (ENTRY_FIELDS, OCCURRENCE_FIELDS, etc.)
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function injectReplicasViaHttp(serverUrl, kind, rows, fieldMap, options = {}) {
  if (!rows || rows.length === 0) {
    return { ok: false, inserted: 0, target: 'android-http', table: kind, error: 'no rows to inject' };
  }

  // Convert fixture rows to ReplicaRow[] using the shared conversion
  // Pass Date.now() as fallback timestamp so even rows without updated_at/created_at get valid HLC
  const now = options.hlcTimestamp ?? options.hlc ?? Date.now();
  const replicas = rows.map((row) => rowToReplica(row, kind, fieldMap, now));

  let resp;
  try {
    resp = await fetch(`${serverUrl}/replicas/${kind}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(replicas),
    });
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: kind,
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: kind,
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  return { ok: true, inserted: rows.length, target: 'android-http', table: kind };
}

/**
 * Update Android replica rows via the existing PUT /replicas/:kind upsert API.
 *
 * @param {string} serverUrl — Android server base URL
 * @param {string} kind — replica kind
 * @param {object[]} rows — updated fixture row objects
 * @param {object} [options] — { fieldMap, hlcTimestamp }
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function updateReplicaViaHttp(serverUrl, kind, rows, options = {}) {
  if (!rows || rows.length === 0) {
    return { ok: false, inserted: 0, target: 'android-http', table: kind, error: 'no rows to update' };
  }

  const fieldMap = fieldMapForKind(kind, options);
  const now = options.hlcTimestamp ?? options.hlc ?? Date.now();
  const replicas = rows.map((row) => rowToReplica(row, kind, fieldMap, now));
  return putJson(serverUrl, `/replicas/${kind}`, replicas, kind, rows.length);
}

/**
 * Soft-delete Android replicas by PUT-ing tombstone-compatible rows.
 *
 * @param {string} serverUrl — Android server base URL
 * @param {string} kind — replica kind
 * @param {string[]} ids — replica IDs to tombstone
 * @param {object} [options] — { fieldMap, hlcTimestamp }
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function deleteReplicaViaHttp(serverUrl, kind, ids, options = {}) {
  if (!ids || ids.length === 0) {
    return { ok: false, inserted: 0, target: 'android-http', table: kind, error: 'no ids to delete' };
  }

  const fieldMap = fieldMapForKind(kind, options);
  const now = options.hlcTimestamp ?? options.hlc ?? Date.now();
  const replicas = ids.map((id) => rowToReplica({ id, deleted_at: now }, kind, fieldMap, now));
  return putJson(serverUrl, `/replicas/${kind}`, replicas, kind, ids.length);
}

/**
 * Inject book data (library entries) into Android via PUT /books/index.
 *
 * @param {string} serverUrl — Android server base URL
 * @param {object[]} books — book objects with at minimum { hash, title, fileName }
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function injectBookViaHttp(serverUrl, books) {
  if (!books || books.length === 0) {
    return { ok: false, inserted: 0, target: 'android-http', table: 'books', error: 'no books to inject' };
  }

  let resp;
  try {
    resp = await fetch(`${serverUrl}/books/index`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(books),
    });
  } catch (err) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: 'books',
      error: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const responseText = await resp.text();
  if (!resp.ok) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: 'books',
      error: `HTTP ${resp.status}: ${responseText}`,
    };
  }

  return { ok: true, inserted: books.length, target: 'android-http', table: 'books' };
}

/**
 * Read the Android book index via GET /books/index.
 *
 * @param {string} serverUrl — Android server base URL
 * @returns {Promise<{ok: boolean, books?: object[], target: string, table: string, error?: string}>}
 */
export async function getBooksIndexViaHttp(serverUrl) {
  const result = await getJson(serverUrl, '/books/index', 'books');
  if (!result.ok) return { ok: false, target: 'android-http', table: 'books', error: result.error };
  const books = booksFromIndexPayload(result.data);
  if (!books) {
    return { ok: false, target: 'android-http', table: 'books', error: 'invalid /books/index response: expected array or { books: [] }' };
  }
  return { ok: true, books, target: 'android-http', table: 'books' };
}

/**
 * Safely update editable metadata for one Android book index entry.
 *
 * The helper reads the current index first, updates only the matching book,
 * preserves all unknown fields, bumps updatedAt, and writes the full index back.
 *
 * @param {string} serverUrl — Android server base URL
 * @param {string} bookHash — book hash to edit
 * @param {Record<string, unknown>} updates — editable book fields
 * @param {{now?: (() => Date|string|number)|Date|string|number}} [options]
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, action?: string, error?: string}>}
 */
export async function updateBookViaHttp(serverUrl, bookHash, updates, options = {}) {
  if (!bookHash) {
    return { ok: false, inserted: 0, target: 'android-http', table: 'books', error: 'missing book hash' };
  }
  const validationError = validateBookUpdates(updates);
  if (validationError) {
    return { ok: false, inserted: 0, target: 'android-http', table: 'books', error: validationError };
  }

  const indexResult = await getBooksIndexViaHttp(serverUrl);
  if (!indexResult.ok) return { ok: false, inserted: 0, target: 'android-http', table: 'books', error: indexResult.error };

  let found = false;
  const updatedAt = resolveNowValue(options.now);
  const nextBooks = indexResult.books.map((book) => {
    if (book?.hash !== bookHash && book?.bookHash !== bookHash) return book;
    found = true;
    const next = { ...book, updatedAt };
    for (const [field, value] of Object.entries(updates)) {
      if (field === 'metadata' && value && typeof value === 'object' && !Array.isArray(value)) {
        next.metadata = { ...(next.metadata ?? {}), ...value };
      } else {
        next[field] = value;
      }
    }
    return next;
  });

  if (!found) return { ok: true, inserted: 0, target: 'android-http', table: 'books', action: 'not-found', bookHash };

  const putResult = await putJson(serverUrl, '/books/index', nextBooks, 'books', 1);
  return putResult.ok
    ? { ...putResult, action: 'updated', bookHash, updatedAt }
    : putResult;
}

/**
 * Import or same-hash reimport an EPUB into Android through HTTP assets + index.
 */
export async function importBookViaHttp(serverUrl, descriptor, options = {}) {
  if (!descriptor?.entry) return descriptorError('descriptor.entry', 'missing EPUB import descriptor entry');
  if (!descriptor.hash) return descriptorError('descriptor.hash', 'missing EPUB import descriptor hash');
  if (!descriptor.fileName) return descriptorError('descriptor.fileName', 'missing EPUB import descriptor fileName');

  const bytes = descriptor.bytes ?? (descriptor.filePath ? readFileSync(descriptor.filePath) : null);
  if (!bytes) return descriptorError('descriptor.bytes', 'missing EPUB import asset bytes');

  const hash = descriptor.hash;
  const liveUpdatedAt = resolveNowValue(options.now ?? descriptor.entry.updatedAt);
  const liveCreatedAt = bookTimestampMillis(liveUpdatedAt) ?? liveUpdatedAt;
  const liveEntry = {
    ...descriptor.entry,
    hash,
    fileName: descriptor.fileName,
    byteSize: descriptor.byteSize ?? descriptor.entry.byteSize,
    createdAt: liveCreatedAt,
    importedAt: liveUpdatedAt,
    updatedAt: liveUpdatedAt,
    deletedAt: null,
  };

  const assetResult = await putBytes(serverUrl, `/books/${hash}/book`, bytes, 'books');
  if (!assetResult.ok) return assetResult;

  const indexResult = await getBooksIndexViaHttp(serverUrl);
  if (!indexResult.ok) return { ok: false, inserted: 0, target: 'android-http', table: 'books', evidence: 'book-index', error: indexResult.error };

  const sameHashEntries = indexResult.books.filter((book) => book?.hash === hash || book?.bookHash === hash);
  const tombstones = sameHashEntries.filter((book) => book?.deletedAt);
  const newestTombstone = tombstones.reduce((newest, book) => {
    if (!newest) return book;
    const bookTimestamp = book.updatedAt ?? book.deletedAt;
    const newestTimestamp = newest.updatedAt ?? newest.deletedAt;
    return compareBookTimestamp(bookTimestamp, newestTimestamp) ? book : newest;
  }, null);

  if (newestTombstone && !compareBookTimestamp(liveUpdatedAt, newestTombstone.updatedAt ?? newestTombstone.deletedAt)) {
    return {
      ok: false,
      inserted: 0,
      target: 'android-http',
      table: 'books',
      evidence: 'tombstone-ordering',
      error: 'live reimport timestamp must be newer than same-hash tombstone',
      tombstoneUpdatedAt: newestTombstone.updatedAt ?? newestTombstone.deletedAt,
      liveUpdatedAt,
    };
  }

  const nextBooks = [
    ...indexResult.books.filter((book) => book?.hash !== hash && book?.bookHash !== hash),
    liveEntry,
  ];
  const putResult = await putJson(serverUrl, '/books/index', nextBooks, 'books', 1);
  if (!putResult.ok) return putResult;
  clearPendingAndroidBookTombstone(hash);
  return {
    ...putResult,
    action: 'imported',
    bookHash: hash,
    resurrected: tombstones.length > 0,
    tombstoneUpdatedAt: newestTombstone?.updatedAt ?? newestTombstone?.deletedAt,
    liveUpdatedAt,
  };
}

export async function getBookConfigViaHttp(serverUrl, bookHash) {
  const result = await getJson(serverUrl, `/books/${bookHash}/config`, 'book-config');
  if (!result.ok) return { ok: false, target: 'android-http', table: 'book-config', error: result.error };
  return { ok: true, target: 'android-http', table: 'book-config', config: result.data ?? {} };
}

export async function putBookConfigViaHttp(serverUrl, bookHash, config) {
  return putJson(serverUrl, `/books/${bookHash}/config`, config, 'book-config', 1);
}

export async function getReplicasViaHttp(serverUrl, kind) {
  const result = await getJson(serverUrl, `/replicas/${kind}`, kind);
  if (!result.ok) return { ok: false, target: 'android-http', table: kind, error: result.error };
  const rows = Array.isArray(result.data) ? result.data : (Array.isArray(result.data?.rows) ? result.data.rows : []);
  return { ok: true, target: 'android-http', table: kind, rows };
}

export function resolveSemanticHighlightTarget(target, config, semanticRows) {
  const kind = normalizeSemanticKind(target?.kind ?? target?.type);
  const targetConfig = SEMANTIC_TARGETS[kind];
  if (!targetConfig) {
    return { ok: false, reason: 'unsupported-kind', error: `Unsupported semantic delete kind: ${target?.kind ?? target?.type}` };
  }
  if (!target?.bookHash) return { ok: false, reason: 'missing-book-hash', error: 'Semantic delete requires bookHash' };

  const matches = (semanticRows ?? []).filter((row) => matchSemanticRow(row, target, targetConfig));
  if (matches.length === 0) {
    return { ok: false, reason: 'zero-match', kind, error: `No ${kind} semantic row matched target`, matches: [] };
  }
  if (matches.length > 1 && !target.id) {
    return { ok: false, reason: 'multi-match', kind, error: `Multiple ${kind} semantic rows matched target`, matches: matches.map(rowId).filter(Boolean) };
  }

  const row = matches[0];
  const noteMatches = (config?.booknotes ?? []).filter((note) => noteMatchesTarget(note, target, row, targetConfig));
  if (noteMatches.length === 0) {
    return { ok: false, reason: 'zero-booknote-match', kind, rowId: rowId(row), error: `No BookNote association matched ${kind} semantic row` };
  }
  if (noteMatches.length > 1 && !target.noteId) {
    return { ok: false, reason: 'multi-booknote-match', kind, rowId: rowId(row), matches: noteMatches.map((note) => note.id), error: `Multiple BookNote associations matched ${kind} semantic row` };
  }
  return { ok: true, kind, table: targetConfig.table, replicaKind: targetConfig.kind, row, rowId: rowId(row), note: noteMatches[0] };
}

export async function deleteSemanticHighlightViaHttp(serverUrl, target, options = {}) {
  const kind = normalizeSemanticKind(target?.kind ?? target?.type);
  const targetConfig = SEMANTIC_TARGETS[kind];
  if (!targetConfig) return { ok: false, target: 'android-http', table: 'semantic-delete', error: `Unsupported semantic delete kind: ${target?.kind ?? target?.type}` };
  if (!target?.bookHash) return { ok: false, target: 'android-http', table: 'semantic-delete', error: 'Semantic delete requires bookHash' };

  const configResult = await getBookConfigViaHttp(serverUrl, target.bookHash);
  if (!configResult.ok) return { ok: false, inserted: 0, target: 'android-http', table: 'book-config', error: configResult.error };
  const replicasResult = await getReplicasViaHttp(serverUrl, targetConfig.kind);
  if (!replicasResult.ok) return { ok: false, inserted: 0, target: 'android-http', table: targetConfig.kind, error: replicasResult.error };
  const resolved = resolveSemanticHighlightTarget(target, configResult.config, replicasResult.rows);
  if (!resolved.ok) return { ok: false, inserted: 0, target: 'android-http', table: targetConfig.kind, ...resolved };

  const deletedAt = options.hlcTimestamp ?? options.hlc ?? Date.now();
  const configUpdate = markBooknoteDeleted(configResult.config, resolved.note.id, deletedAt);
  if (configUpdate.deletedConfigNotes !== 1) {
    return { ok: false, inserted: 0, target: 'android-http', table: 'book-config', error: 'resolved BookNote association was not deleted' };
  }

  const putConfigResult = await putBookConfigViaHttp(serverUrl, target.bookHash, configUpdate.config);
  if (!putConfigResult.ok) return putConfigResult;
  const deleteResult = await deleteReplicaViaHttp(serverUrl, targetConfig.kind, [resolved.rowId], { fieldMap: TABLE_REPLICA_MAP[targetConfig.table].fields, hlcTimestamp: deletedAt });
  return deleteResult.ok
    ? { ...deleteResult, action: 'semantic-delete', kind, bookHash: target.bookHash, deletedConfigNotes: 1, deletedSemanticRows: 1, semanticRowId: resolved.rowId, booknoteId: resolved.note.id }
    : deleteResult;
}

/**
 * Delete an Android book via the dev server's book tombstone endpoint.
 *
 * @param {string} serverUrl — Android server base URL
 * @param {string} bookHash — book hash to delete
 * @returns {Promise<{ok: boolean, inserted: number, target: string, table: string, error?: string}>}
 */
export async function deleteBookViaHttp(serverUrl, bookHash) {
  if (!bookHash) {
    return { ok: false, inserted: 0, target: 'android-http', table: 'books', error: 'missing book hash' };
  }

  const deletedAt = Date.now();
  const result = await putJson(serverUrl, '/books/delete', { hash: bookHash, deletedAt }, 'books', 1);
  if (result.ok) recordPendingAndroidBookTombstone({ hash: bookHash, deletedAt });
  return result;
}

/**
 * Map fixture table names to their replica kind and field map.
 */
export const TABLE_REPLICA_MAP = {
  dictionary_entries: { kind: 'dictionary-entry', fields: ENTRY_FIELDS },
  dictionary_occurrences: { kind: 'dictionary-occurrence', fields: OCCURRENCE_FIELDS },
  quotes: { kind: 'quote', fields: QUOTE_FIELDS },
  annotations: { kind: 'annotation', fields: ANNOTATION_FIELDS },
};
