/**
 * dev-sync-fixture — Create complete test data with proper references.
 *
 * Composable toolbox for building sync test scenarios:
 *   node scripts/dev-sync-fixture.mjs --target desktop --dict zozobrar --book HASH
 *   node scripts/dev-sync-fixture.mjs --target desktop --quote "frase célebre" --book HASH
 *   node scripts/dev-sync-fixture.mjs --target desktop --note "mi análisis" --book HASH
 *   node scripts/dev-sync-fixture.mjs --target android-http --dict zozobrar --book HASH
 *
 * Each command creates the entity PLUS its associated highlight referencing
 * a real book via its hash.
 *
 * Exported functions accept an optional `injectOpts` parameter that forwards
 * `dbPath`, `execFileSync`, and `devHarnessEnabled` to the underlying
 * `injectRows` call (desktop/android target only). When omitted, defaults
 * are derived from the environment.
 *
 * When target is `android-http`, the functions use `injectReplicasViaHttp`
 * instead of `injectRows`, sending data via PUT /replicas/:kind.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncDevEnvironment, requireDevHarness, DB_KIND_MAP } from './sync-dev-env.mjs';
import { injectRows, deleteBook, updateBook } from './sync-dev-inject.mjs';
import {
  injectReplicasViaHttp,
  injectBookViaHttp,
  resolveAndroidServerUrl,
  TABLE_REPLICA_MAP,
  updateReplicaViaHttp,
  deleteReplicaViaHttp,
  deleteBookViaHttp,
  updateBookViaHttp,
  importBookViaHttp,
  deleteSemanticHighlightViaHttp,
  resolveSemanticHighlightTarget,
} from './sync-dev-inject-http.mjs';
import { updateRow, softDeleteRow } from './sync-dev-sqlite.mjs';
import { createEpubImportDescriptor, importEpubToLibrary } from './prepare-engine.mjs';

/**
 * Map table names to their DB kind for path resolution.
 */
const TABLE_DB_KIND = {
  dictionary_entries: 'dictionary',
  dictionary_occurrences: 'dictionary',
  quotes: 'quotes',
  annotations: 'annotations',
};

const EDITABLE_FIELDS = {
  dictionary_entries: new Set(['display_term', 'language', 'definition', 'enrichment_status', 'image_path', 'curiosity']),
  dictionary_occurrences: new Set(),
  quotes: new Set(['book_hash', 'book_title', 'book_author', 'cfi', 'section_href', 'page', 'context_before', 'context_after', 'content_hash']),
  annotations: new Set(['book_hash', 'book_title', 'book_author', 'cfi', 'section_href', 'page', 'note', 'style', 'color']),
  books: new Set(['title', 'author', 'coverImageUrl', 'groupId', 'readingStatus', 'progress', 'metadata']),
};

const HLC_PATTERN = /^[0-9a-f]+-[0-9a-f]+-[A-Za-z0-9_-]+$/i;

const SEMANTIC_DESKTOP_TARGETS = {
  dictionary: { table: 'dictionary_occurrences', dbTable: 'dictionary_occurrences', dbKind: 'dictionary' },
  quote: { table: 'quotes', dbTable: 'quotes', dbKind: 'quotes' },
  annotation: { table: 'annotations', dbTable: 'annotations', dbKind: 'annotations' },
};

/**
 * Resolve fixture defaults from environment or injected overrides.
 */
function resolveDefaults(_target, table) {
  const env = createSyncDevEnvironment(process.env);
  const dataRoot = env.desktop.dataRoot;
  const kind = TABLE_DB_KIND[table];
  const dbPath = kind ? join(dataRoot, 'Readest', DB_KIND_MAP[kind]) : join(dataRoot, 'Readest', 'dictionary.db');
  return {
    execFileSync,
    devHarnessEnabled: process.env.BIBLIOTECA_DEV_SYNC_HARNESS === '1' || process.env.NODE_ENV === 'development',
    dataRoot,
    dbPath,
  };
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a dictionary entry with occurrence and highlight for a book.
 *
 * @param {object} opts
 * @param {'desktop'|'android'|'android-http'} opts.target
 * @param {string} opts.bookHash
 * @param {string} [opts.bookTitle]
 * @param {string} opts.term
 * @param {string} [opts.definition]
 * @param {string} [opts.language]
 * @param {string} [opts.cfi]
 * @param {string} [opts.selectedText]
 * @param {Array} [opts.definitions]
 * @param {object} [opts.injectOpts] — overrides for dbPath, execFileSync, devHarnessEnabled (desktop/android only)
 */
export async function injectDictionary({ target, bookHash, bookTitle, term, definition, language, cfi, selectedText, definitions, injectOpts, overrideTimestamp, hlcTimestamp }) {
  const defs = definitions || [{ definition: definition || `Definición de ${term}`, cfi: cfi || '/6/4[section]!/4/2', selectedText: selectedText || term }];
  const entryId = uid('dict-entry');
  const now = overrideTimestamp ?? hlcTimestamp ?? Date.now();

  // ── android-http path ──────────────────────────────────────────────────
  if (target === 'android-http') {
    const env = createSyncDevEnvironment(process.env);
    const serverUrl = resolveAndroidServerUrl(env);
    const { fields: entryFields } = TABLE_REPLICA_MAP.dictionary_entries;
    const { fields: occFields } = TABLE_REPLICA_MAP.dictionary_occurrences;

    // 1. Dictionary entry
    const entryResult = await injectReplicasViaHttp(serverUrl, 'dictionary-entry', [{
      id: entryId, term, display_term: term, language: language || 'es',
      definition: defs[0].definition, enrichment_status: 'completed',
      replica_timestamps: JSON.stringify({ term: `T${now}`, definition: `T${now}` }),
      created_at: now, updated_at: now, deleted_at: null,
    }], entryFields, { hlcTimestamp: now });
    if (!entryResult.ok) return entryResult;

    // 2. Occurrences per definition
    const occIds = [];
    for (const def of defs) {
      const occId = uid('dict-occ');
      occIds.push(occId);
      const occResult = await injectReplicasViaHttp(serverUrl, 'dictionary-occurrence', [{
        id: occId, entry_id: entryId, book_hash: bookHash, book_title: bookTitle || 'Test Book',
        cfi: def.cfi, selected_text: def.selectedText, created_at: now,
        deleted_at: null, replica_timestamps: JSON.stringify({ selected_text: `T${now}` }),
      }], occFields, { hlcTimestamp: now });
      if (!occResult.ok) return occResult;
    }

    return { ok: true, entryId, occIds, term, definition: defs[0].definition };
  }

  // ── Desktop / legacy android path ──────────────────────────────────────
  const entryDefaults = resolveDefaults(target, 'dictionary_entries');
  const occDefaults = resolveDefaults(target, 'dictionary_occurrences');

  // 1. Dictionary entry
  const entryResult = injectRows({
    target,
    dbPath: (injectOpts && injectOpts.dbPath) || entryDefaults.dbPath,
    table: 'dictionary_entries',
    execFileSync: (injectOpts && injectOpts.execFileSync) || entryDefaults.execFileSync,
    devHarnessEnabled: injectOpts ? injectOpts.devHarnessEnabled : entryDefaults.devHarnessEnabled,
    rows: [{
      id: entryId, term, display_term: term, language: language || 'es',
      definition: defs[0].definition, enrichment_status: 'completed',
      replica_timestamps: JSON.stringify({ term: `T${now}`, definition: `T${now}` }),
      created_at: now, updated_at: now, deleted_at: null,
    }],
  });
  if (!entryResult.ok) return entryResult;

  // 2. Occurrence per definition
  const occIds = [];
  for (const def of defs) {
    const occId = uid('dict-occ');
    occIds.push(occId);
    const occResult = injectRows({
      target,
      dbPath: (injectOpts && injectOpts.dbPath) || occDefaults.dbPath,
      table: 'dictionary_occurrences',
      execFileSync: (injectOpts && injectOpts.execFileSync) || occDefaults.execFileSync,
      devHarnessEnabled: injectOpts ? injectOpts.devHarnessEnabled : occDefaults.devHarnessEnabled,
      rows: [{
        id: occId, entry_id: entryId, book_hash: bookHash, book_title: bookTitle || 'Test Book',
        cfi: def.cfi, selected_text: def.selectedText, created_at: now,
        deleted_at: null, replica_timestamps: JSON.stringify({ selected_text: `T${now}` }),
      }],
    });
    if (!occResult.ok) return occResult;
  }

  return { ok: true, entryId, occIds, term, definition: defs[0].definition };
}

/**
 * Create a quote with highlight for a book.
 *
 * @param {object} opts
 * @param {'desktop'|'android'|'android-http'} opts.target
 * @param {string} opts.bookHash
 * @param {string} [opts.bookTitle]
 * @param {string} opts.text
 * @param {string} [opts.comment]
 * @param {string} [opts.cfi]
 * @param {object} [opts.injectOpts] — overrides for dbPath, execFileSync, devHarnessEnabled (desktop/android only)
 */
export async function injectQuote({ target, bookHash, bookTitle, text, comment: _comment, cfi, injectOpts, overrideTimestamp, hlcTimestamp }) {
  const quoteId = uid('quote');
  const now = overrideTimestamp ?? hlcTimestamp ?? Date.now();

  // ── android-http path ──────────────────────────────────────────────────
  if (target === 'android-http') {
    const env = createSyncDevEnvironment(process.env);
    const serverUrl = resolveAndroidServerUrl(env);
    const { fields } = TABLE_REPLICA_MAP.quotes;

    const quoteResult = await injectReplicasViaHttp(serverUrl, 'quote', [{
      id: quoteId, text: text,
      book_hash: bookHash, book_title: bookTitle || 'Test Book',
      cfi: cfi || '/6/4[section]!/10/2:0',
      created_at: now, updated_at: now, deleted_at: null,
      replica_timestamps: JSON.stringify({ text: `T${now}` }),
    }], fields, { hlcTimestamp: now });
    if (!quoteResult.ok) return quoteResult;

    return { ok: true, quoteId, text };
  }

  // ── Desktop / legacy android path ──────────────────────────────────────
  const defaults = resolveDefaults(target, 'quotes');

  const quoteResult = injectRows({
    target,
    dbPath: (injectOpts && injectOpts.dbPath) || defaults.dbPath,
    table: 'quotes',
    execFileSync: (injectOpts && injectOpts.execFileSync) || defaults.execFileSync,
    devHarnessEnabled: injectOpts ? injectOpts.devHarnessEnabled : defaults.devHarnessEnabled,
    rows: [{
      id: quoteId, text: text,
      book_hash: bookHash, book_title: bookTitle || 'Test Book',
      cfi: cfi || '/6/4[section]!/10/2:0',
      created_at: now, updated_at: now, deleted_at: null,
      replica_timestamps: JSON.stringify({ text: `T${now}` }),
    }],
  });
  if (!quoteResult.ok) return quoteResult;

  return { ok: true, quoteId, text };
}

/**
 * Create an annotation with highlight for a book.
 *
 * @param {object} opts
 * @param {'desktop'|'android'|'android-http'} opts.target
 * @param {string} opts.bookHash
 * @param {string} [opts.bookTitle]
 * @param {string} opts.text
 * @param {string} [opts.cfi]
 * @param {string} [opts.selectedText]
 * @param {object} [opts.injectOpts] — overrides for dbPath, execFileSync, devHarnessEnabled (desktop/android only)
 */
export async function injectAnnotation({ target, bookHash, bookTitle, text, cfi, selectedText: _selectedText, injectOpts, overrideTimestamp, hlcTimestamp }) {
  const annId = uid('annotation');
  const now = overrideTimestamp ?? hlcTimestamp ?? Date.now();

  // ── android-http path ──────────────────────────────────────────────────
  if (target === 'android-http') {
    const env = createSyncDevEnvironment(process.env);
    const serverUrl = resolveAndroidServerUrl(env);
    const { fields } = TABLE_REPLICA_MAP.annotations;

    const annResult = await injectReplicasViaHttp(serverUrl, 'annotation', [{
      id: annId, text: text, book_hash: bookHash, book_title: bookTitle || 'Test Book',
      cfi: cfi || '/6/4[section]!/6/2:0',
      note: text,
      created_at: now, updated_at: now, deleted_at: null,
      replica_timestamps: JSON.stringify({ text: `T${now}`, note: `T${now}` }),
    }], fields, { hlcTimestamp: now });
    if (!annResult.ok) return annResult;

    return { ok: true, annId, text };
  }

  // ── Desktop / legacy android path ──────────────────────────────────────
  const defaults = resolveDefaults(target, 'annotations');

  const annResult = injectRows({
    target,
    dbPath: (injectOpts && injectOpts.dbPath) || defaults.dbPath,
    table: 'annotations',
    execFileSync: (injectOpts && injectOpts.execFileSync) || defaults.execFileSync,
    devHarnessEnabled: injectOpts ? injectOpts.devHarnessEnabled : defaults.devHarnessEnabled,
    rows: [{
      id: annId, text: text, book_hash: bookHash, book_title: bookTitle || 'Test Book',
      cfi: cfi || '/6/4[section]!/6/2:0',
      note: text,	// note field holds the annotation text (matches ANNOTATION_FIELDS.note)
      created_at: now, updated_at: now, deleted_at: null,
      replica_timestamps: JSON.stringify({ text: `T${now}`, note: `T${now}` }),
    }],
  });
  if (!annResult.ok) return annResult;

  return { ok: true, annId, text };
}

/**
 * Create a book entry on desktop for Case 15 testing.
 * Injects a minimal entry into library.json without requiring an EPUB file.
 *
 * @param {string} bookHash
 * @param {{dataRoot?: string, title?: string, author?: string, hlcTimestamp?: number}} [options]
 * @returns {{ok: boolean, bookHash: string, action: string}}
 */
function injectBookForDesktop(bookHash, options = {}) {
  const dataRoot = options.dataRoot ?? createSyncDevEnvironment().desktop.dataRoot;
  const booksDir = join(dataRoot, 'Readest', 'Books');
  const libraryPath = join(booksDir, 'library.json');

  mkdirSync(booksDir, { recursive: true });

  let library = [];
  try {
    library = JSON.parse(readFileSync(libraryPath, 'utf8'));
  } catch {
    library = [];
  }
  if (!Array.isArray(library)) library = [];

  const existing = library.find((b) => b?.hash === bookHash || b?.bookHash === bookHash);
  if (existing) {
    return { ok: true, bookHash, action: 'already-exists' };
  }

  const now = options.hlcTimestamp ?? Date.now();
  library.push({
    hash: bookHash,
    title: options.title ?? 'Test Book',
    author: options.author ?? 'Test Author',
    updatedAt: now,
    createdAt: now,
  });

  writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf8');
  return { ok: true, bookHash, action: 'created' };
}

// ── CLI ──
function requireValue(args, index, flag) {
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index + 1];
}

function parseEditSpec(spec) {
  const firstColon = spec.indexOf(':');
  const secondColon = spec.indexOf(':', firstColon + 1);
  if (firstColon <= 0 || secondColon <= firstColon + 1 || secondColon === spec.length - 1) {
    throw new Error('--edit expects table:id:field=value[,field2=value2]');
  }

  const table = spec.slice(0, firstColon);
  const rowId = spec.slice(firstColon + 1, secondColon);
  const assignments = spec.slice(secondColon + 1).split(',').filter(Boolean);
  if (assignments.length === 0) {
    throw new Error('--edit expects at least one field=value assignment');
  }

  const updates = {};
  for (const assignment of assignments) {
    const equalsIndex = assignment.indexOf('=');
    if (equalsIndex <= 0) {
      throw new Error('--edit expects table:id:field=value[,field2=value2]');
    }
    const field = assignment.slice(0, equalsIndex);
    updates[field === 'imagePath' ? 'image_path' : field] = assignment.slice(equalsIndex + 1);
  }

  return { table, rowId, updates };
}

function parseDeleteSpec(spec) {
  const colon = spec.indexOf(':');
  if (colon <= 0 || colon === spec.length - 1 || spec.indexOf(':', colon + 1) !== -1) {
    throw new Error('--delete expects table:id');
  }
  return { table: spec.slice(0, colon), rowId: spec.slice(colon + 1) };
}

function semanticTargetFromOpts(opts) {
  if (!opts.semanticDelete) return undefined;
  return {
    ...opts.semanticDelete,
    bookHash: opts.bookHash,
  };
}

export function parseFixtureArgs(args = process.argv.slice(2)) {
  const opts = { target: 'desktop' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target') opts.target = requireValue(args, i++, '--target');
    else if (args[i] === '--dict') { opts.type = 'dict'; opts.term = requireValue(args, i++, '--dict'); }
    else if (args[i] === '--quote') { opts.type = 'quote'; opts.text = requireValue(args, i++, '--quote'); }
    else if (args[i] === '--note') { opts.type = 'note'; opts.text = requireValue(args, i++, '--note'); }
    else if (args[i] === '--case15') { opts.type = 'case15'; opts.case15BookHash = requireValue(args, i++, '--case15'); }
    else if (args[i] === '--case16') { opts.type = 'case16'; opts.case16Term = requireValue(args, i++, '--case16'); }
    else if (args[i] === '--case17') { opts.type = 'case17'; opts.case17Text = requireValue(args, i++, '--case17'); }
    else if (args[i] === '--semantic-delete') opts.semanticDelete = { ...(opts.semanticDelete ?? {}), kind: requireValue(args, i++, '--semantic-delete') };
    else if (args[i] === '--id') opts.semanticDelete = { ...(opts.semanticDelete ?? {}), id: requireValue(args, i++, '--id') };
    else if (args[i] === '--note-id') opts.semanticDelete = { ...(opts.semanticDelete ?? {}), noteId: requireValue(args, i++, '--note-id') };
    else if (args[i] === '--dictionary-entry') opts.semanticDelete = { ...(opts.semanticDelete ?? {}), dictionaryEntryId: requireValue(args, i++, '--dictionary-entry') };
    else if (args[i] === '--cfi') opts.semanticDelete = { ...(opts.semanticDelete ?? {}), cfi: requireValue(args, i++, '--cfi') };
    else if (args[i] === '--text') opts.semanticDelete = { ...(opts.semanticDelete ?? {}), text: requireValue(args, i++, '--text') };
    else if (args[i] === '--book') opts.bookHash = requireValue(args, i++, '--book');
    else if (args[i] === '--import-book') opts.importBookPath = requireValue(args, i++, '--import-book');
    else if (args[i] === '--title') opts.title = requireValue(args, i++, '--title');
    else if (args[i] === '--author') opts.author = requireValue(args, i++, '--author');
    else if (args[i] === '--language') opts.language = requireValue(args, i++, '--language');
    else if (args[i] === '--definition') opts.definition = requireValue(args, i++, '--definition');
    else if (args[i] === '--comment') opts.comment = requireValue(args, i++, '--comment');
    else if (args[i] === '--edit') opts.edit = parseEditSpec(requireValue(args, i++, '--edit'));
    else if (args[i] === '--delete') opts.delete = parseDeleteSpec(requireValue(args, i++, '--delete'));
    else if (args[i] === '--delete-book') opts.deleteBookHash = requireValue(args, i++, '--delete-book');
    else if (args[i] === '--hlc') {
      const raw = requireValue(args, i++, '--hlc');
      const hlcTimestamp = Number(raw);
      if (Number.isFinite(hlcTimestamp)) {
        opts.hlcTimestamp = hlcTimestamp;
      } else if (HLC_PATTERN.test(raw)) {
        opts.hlcTimestamp = raw;
      } else {
        throw new Error('--hlc expects milliseconds or a hex-encoded HLC string');
      }
    }
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  return opts;
}

function validateSingleOperation(opts) {
  // --import-book is a parameter modifier for --case15, not an independent operation
  const operations = [opts.type, opts.edit, opts.delete, opts.deleteBookHash, opts.semanticDelete];
  if (opts.importBookPath && !opts.type) {
    operations.push(opts.importBookPath);
  }
  const count = operations.filter(Boolean).length;
  if (count !== 1) {
    throw new Error('Choose exactly one fixture operation: --dict, --quote, --note, --edit, --delete, --delete-book, --import-book, or --semantic-delete');
  }
}

function validateEditableFields({ table, updates }) {
  const editable = EDITABLE_FIELDS[table];
  if (!editable) {
    throw new Error(`Entity is not editable by this harness: ${table}`);
  }
  for (const field of Object.keys(updates)) {
    const rootField = field.startsWith('metadata.') ? 'metadata' : normalizeBookField(field);
    if (!editable.has(rootField)) {
      throw new Error(`Field is not editable by this harness: ${table}.${field}`);
    }
  }
}

function normalizeBookField(field) {
  if (field === 'cover') return 'coverImageUrl';
  if (field === 'group') return 'groupId';
  return field;
}

function normalizeBookUpdates(updates) {
  const normalized = {};
  for (const [field, value] of Object.entries(updates)) {
    if (field.startsWith('metadata.')) {
      normalized.metadata = normalized.metadata ?? {};
      normalized.metadata[field.slice('metadata.'.length)] = value;
    } else if (field === 'metadata') {
      normalized.metadata = value;
    } else {
      normalized[normalizeBookField(field)] = value;
    }
  }
  return normalized;
}

function resolveReplica(table) {
  const replica = TABLE_REPLICA_MAP[table];
  if (!replica) throw new Error(`Unsupported replica table: ${table}`);
  return replica;
}

function sqliteRows({ dbPath, execFileSync, table }) {
  const raw = execFileSync('sqlite3', [dbPath, '-json', `SELECT * FROM "${table}"`], { encoding: 'utf8', stdio: 'pipe' });
  return JSON.parse(raw || '[]');
}

export async function deleteSemanticHighlightOnDesktop(target, options = {}) {
  const kind = target?.kind === 'dict' ? 'dictionary' : target?.kind;
  const config = SEMANTIC_DESKTOP_TARGETS[kind];
  if (!config) return { ok: false, target: 'desktop', table: 'semantic-delete', error: `Unsupported semantic delete kind: ${target?.kind}` };
  if (!target?.bookHash) return { ok: false, target: 'desktop', table: config.table, error: 'Semantic delete requires bookHash' };

  const defaults = (options.resolveDefaults ?? resolveDefaults)('desktop', config.table);
  const configPath = join(defaults.dataRoot, 'Readest', 'Books', target.bookHash, 'config.json');
  if (!existsSync(configPath)) return { ok: false, target: 'desktop', table: 'book-config', error: `Book config not found: ${configPath}` };

  const bookConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  const rows = sqliteRows({ dbPath: defaults.dbPath, execFileSync: options.execFileSync ?? defaults.execFileSync, table: config.dbTable });
  const resolved = resolveSemanticHighlightTarget(target, bookConfig, rows);
  if (!resolved.ok) return { ok: false, target: 'desktop', table: config.table, ...resolved };

  const deletedAt = options.hlcTimestamp ?? Date.now();
  const nextBooknotes = bookConfig.booknotes.map((note) => note.id === resolved.note.id ? { ...note, deletedAt } : note);
  writeFileSync(configPath, `${JSON.stringify({ ...bookConfig, booknotes: nextBooknotes, updatedAt: deletedAt }, null, 2)}\n`, 'utf8');
  const deleteResult = softDeleteRow({
    dbPath: defaults.dbPath,
    execFileSync: options.execFileSync ?? defaults.execFileSync,
    table: config.dbTable,
    rowId: resolved.rowId,
    timestamp: deletedAt,
    hlcTimestamp: options.hlcTimestamp,
  });
  return deleteResult.ok
    ? { ok: true, target: 'desktop', action: 'semantic-delete', table: config.table, deletedConfigNotes: 1, deletedSemanticRows: 1, semanticRowId: resolved.rowId, booknoteId: resolved.note.id }
    : deleteResult;
}

export async function dispatchFixture(opts, deps = {}) {
  validateSingleOperation(opts);
  const resolveDefaultsFn = deps.resolveDefaults ?? resolveDefaults;
  const resolveAndroidServerUrlFn = deps.resolveAndroidServerUrl ?? (() => resolveAndroidServerUrl(createSyncDevEnvironment(process.env)));
  const updateRowFn = deps.updateRow ?? updateRow;
  const softDeleteRowFn = deps.softDeleteRow ?? softDeleteRow;
  const deleteBookFn = deps.deleteBook ?? deleteBook;
  const updateBookFn = deps.updateBook ?? updateBook;
  const updateReplicaViaHttpFn = deps.updateReplicaViaHttp ?? updateReplicaViaHttp;
  const deleteReplicaViaHttpFn = deps.deleteReplicaViaHttp ?? deleteReplicaViaHttp;
  const deleteBookViaHttpFn = deps.deleteBookViaHttp ?? deleteBookViaHttp;
  const updateBookViaHttpFn = deps.updateBookViaHttp ?? updateBookViaHttp;
  const importBookViaHttpFn = deps.importBookViaHttp ?? importBookViaHttp;
  const injectBookViaHttpFn = deps.injectBookViaHttp ?? injectBookViaHttp;
  const importEpubToLibraryFn = deps.importEpubToLibrary ?? importEpubToLibrary;
  const deleteSemanticHighlightViaHttpFn = deps.deleteSemanticHighlightViaHttp ?? deleteSemanticHighlightViaHttp;
  const deleteSemanticHighlightOnDesktopFn = deps.deleteSemanticHighlightOnDesktop ?? deleteSemanticHighlightOnDesktop;
  const createEpubImportDescriptorFn = deps.createEpubImportDescriptor ?? createEpubImportDescriptor;
  const injectDictionaryFn = deps.injectDictionary ?? injectDictionary;
  const injectQuoteFn = deps.injectQuote ?? injectQuote;
  const injectAnnotationFn = deps.injectAnnotation ?? injectAnnotation;

  if (opts.edit) {
    validateEditableFields(opts.edit);
    if (opts.edit.table === 'books') {
      if (opts.target === 'android-http') {
        return updateBookViaHttpFn(
          resolveAndroidServerUrlFn(),
          opts.edit.rowId,
          normalizeBookUpdates(opts.edit.updates),
          { now: opts.hlcTimestamp },
        );
      }
      const defaults = resolveDefaultsFn(opts.target, 'dictionary_entries');
      return updateBookFn(opts.edit.rowId, normalizeBookUpdates(opts.edit.updates), { dataRoot: defaults.dataRoot });
    }
    if (opts.target === 'android-http') {
      const replica = resolveReplica(opts.edit.table);
      return updateReplicaViaHttpFn(
        resolveAndroidServerUrlFn(),
        replica.kind,
        [{ id: opts.edit.rowId, ...opts.edit.updates }],
        { fieldMap: replica.fields, hlcTimestamp: opts.hlcTimestamp },
      );
    }
    const defaults = resolveDefaultsFn(opts.target, opts.edit.table);
    return updateRowFn({
      dbPath: defaults.dbPath,
      execFileSync: defaults.execFileSync,
      table: opts.edit.table,
      rowId: opts.edit.rowId,
      updates: opts.edit.updates,
      timestamp: opts.hlcTimestamp,
      hlcTimestamp: opts.hlcTimestamp,
    });
  }

  if (opts.delete) {
    if (opts.target === 'android-http') {
      const replica = resolveReplica(opts.delete.table);
      return deleteReplicaViaHttpFn(
        resolveAndroidServerUrlFn(),
        replica.kind,
        [opts.delete.rowId],
        { fieldMap: replica.fields, hlcTimestamp: opts.hlcTimestamp },
      );
    }
    const defaults = resolveDefaultsFn(opts.target, opts.delete.table);
    return softDeleteRowFn({
      dbPath: defaults.dbPath,
      execFileSync: defaults.execFileSync,
      table: opts.delete.table,
      rowId: opts.delete.rowId,
      timestamp: opts.hlcTimestamp,
      hlcTimestamp: opts.hlcTimestamp,
    });
  }

  if (opts.deleteBookHash) {
    if (opts.target === 'android-http') {
      return deleteBookViaHttpFn(resolveAndroidServerUrlFn(), opts.deleteBookHash);
    }
    const defaults = resolveDefaultsFn(opts.target, 'dictionary_entries');
    return deleteBookFn(opts.deleteBookHash, { dataRoot: defaults.dataRoot });
  }

  // ── Case 15: same book hash on target device ──
  //
  // MUST execute BEFORE the generic --import-book block because case15
  // also accepts --import-book for real-EPUB import on both targets.
  //
  // Two modes:
  //   1. With --import-book <path>: import a real EPUB (follows real user code path)
  //   2. Without --import-book: create stub entry for fast unit tests
  //
  // Real-device verification MUST use --import-book for >80% reliability.
  if (opts.type === 'case15') {
    const bookHash = opts.case15BookHash;
    if (!bookHash) throw new Error('--case15 requires a book hash argument');

    // ── Mode 1: Real EPUB import (follows real code path) ──
    if (opts.importBookPath) {
      if (opts.target === 'android-http') {
        const serverUrl = resolveAndroidServerUrlFn();
        const descriptor = createEpubImportDescriptorFn({
          filePath: opts.importBookPath,
          title: opts.title,
          author: opts.author,
          language: opts.language,
          now: opts.hlcTimestamp,
        });
        return importBookViaHttpFn(serverUrl, descriptor, { now: opts.hlcTimestamp, reimport: true });
      }
      // Desktop: import real EPUB via prepare-engine (same code path as dev:sync:prepare)
      const defaults = resolveDefaultsFn('desktop', 'dictionary_entries');
      const importResult = importEpubToLibraryFn({
        filePath: opts.importBookPath,
        dataRoot: defaults.dataRoot,
        title: opts.title,
        author: opts.author,
        language: opts.language,
      });
      return { bookHash: importResult.book?.hash, ...importResult };
    }

    // ── Mode 2: Stub entry (fast setup, not real code path) ──
    if (opts.target === 'android-http') {
      const serverUrl = resolveAndroidServerUrlFn();
      const now = opts.hlcTimestamp ?? Date.now();
      return injectBookViaHttpFn(serverUrl, [{
        hash: bookHash,
        title: opts.title ?? 'Test Book',
        author: opts.author ?? 'Test Author',
        fileName: `${bookHash}.epub`,
        updatedAt: new Date(now).toISOString(),
      }]);
    }

    const defaults = resolveDefaultsFn('desktop', 'dictionary_entries');
    return injectBookForDesktop(bookHash, {
      dataRoot: defaults.dataRoot,
      title: opts.title ?? 'Test Book',
      author: opts.author ?? 'Test Author',
      hlcTimestamp: opts.hlcTimestamp,
    });
  }

  if (opts.importBookPath) {
    if (opts.target !== 'android-http') {
      throw new Error('--import-book is currently supported only with --target android-http');
    }
    const descriptor = createEpubImportDescriptorFn({
      filePath: opts.importBookPath,
      title: opts.title,
      author: opts.author,
      language: opts.language,
      now: opts.hlcTimestamp,
    });
    return importBookViaHttpFn(resolveAndroidServerUrlFn(), descriptor, { now: opts.hlcTimestamp, reimport: true });
  }

  if (opts.semanticDelete) {
    const target = semanticTargetFromOpts(opts);
    if (!target.bookHash) throw new Error('--semantic-delete requires --book <hash>');
    if (opts.target === 'android-http') {
      return deleteSemanticHighlightViaHttpFn(resolveAndroidServerUrlFn(), target, { hlcTimestamp: opts.hlcTimestamp });
    }
    return deleteSemanticHighlightOnDesktopFn(target, {
      resolveDefaults: resolveDefaultsFn,
      hlcTimestamp: opts.hlcTimestamp,
    });
  }

  if (!opts.bookHash) {
    throw new Error('Usage: dev-sync-fixture.mjs --dict <term> --book <hash> [--definition <text>]');
  }

  switch (opts.type) {
    case 'dict':
    case 'case16':
      return injectDictionaryFn({
        target: opts.target, bookHash: opts.bookHash,
        term: opts.type === 'case16' ? opts.case16Term : opts.term,
        definition: opts.definition,
        language: opts.language,
        overrideTimestamp: opts.hlcTimestamp,
        hlcTimestamp: opts.hlcTimestamp,
      });
    case 'quote':
    case 'case17':
      return injectQuoteFn({
        target: opts.target, bookHash: opts.bookHash,
        text: opts.type === 'case17' ? opts.case17Text : opts.text,
        comment: opts.comment,
        overrideTimestamp: opts.hlcTimestamp,
        hlcTimestamp: opts.hlcTimestamp,
      });
    case 'note':
      return injectAnnotationFn({
        target: opts.target, bookHash: opts.bookHash,
        text: opts.text,
        overrideTimestamp: opts.hlcTimestamp,
        hlcTimestamp: opts.hlcTimestamp,
      });
    default:
      throw new Error('Unknown fixture type. Use --dict, --quote, --note, --case15, --case16, or --case17.');
  }
}

// Only run CLI if executed directly (not imported)
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\.\//, ''));
if (isMain) {
  let resultPromise;
  try {
    const opts = parseFixtureArgs();
    requireDevHarness(process.env, 'dev-sync-fixture');
    resultPromise = dispatchFixture(opts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  resultPromise.then(result => {
    console.log(JSON.stringify({ ok: result.ok, ...result }));
    if (result.ok === false) process.exit(1);
  }).catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
