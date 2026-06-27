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
import { join } from 'node:path';
import { createSyncDevEnvironment, requireDevHarness, DB_KIND_MAP } from './sync-dev-env.mjs';
import { injectRows } from './sync-dev-inject.mjs';
import { injectReplicasViaHttp, resolveAndroidServerUrl, TABLE_REPLICA_MAP } from './sync-dev-inject-http.mjs';

/**
 * Map table names to their DB kind for path resolution.
 */
const TABLE_DB_KIND = {
  dictionary_entries: 'dictionary',
  dictionary_occurrences: 'dictionary',
  quotes: 'quotes',
  annotations: 'annotations',
};

/**
 * Resolve fixture defaults from environment or injected overrides.
 */
function resolveDefaults(target, table) {
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
export async function injectDictionary({ target, bookHash, bookTitle, term, definition, language, cfi, selectedText, definitions, injectOpts }) {
  const defs = definitions || [{ definition: definition || `Definición de ${term}`, cfi: cfi || '/6/4[section]!/4/2', selectedText: selectedText || term }];
  const entryId = uid('dict-entry');
  const now = Date.now();

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
    }], entryFields);
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
      }], occFields);
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
export async function injectQuote({ target, bookHash, bookTitle, text, comment, cfi, injectOpts }) {
  const quoteId = uid('quote');
  const now = Date.now();

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
    }], fields);
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
export async function injectAnnotation({ target, bookHash, bookTitle, text, cfi, selectedText, injectOpts }) {
  const annId = uid('annotation');
  const now = Date.now();

  // ── android-http path ──────────────────────────────────────────────────
  if (target === 'android-http') {
    const env = createSyncDevEnvironment(process.env);
    const serverUrl = resolveAndroidServerUrl(env);
    const { fields } = TABLE_REPLICA_MAP.annotations;

    const annResult = await injectReplicasViaHttp(serverUrl, 'annotation', [{
      id: annId, text: text, book_hash: bookHash, book_title: bookTitle || 'Test Book',
      cfi: cfi || '/6/4[section]!/6/2:0',
      created_at: now, updated_at: now, deleted_at: null,
      replica_timestamps: JSON.stringify({ text: `T${now}` }),
    }], fields);
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
      created_at: now, updated_at: now, deleted_at: null,
      replica_timestamps: JSON.stringify({ text: `T${now}` }),
    }],
  });
  if (!annResult.ok) return annResult;

  return { ok: true, annId, text };
}

// ── CLI ──
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { target: 'desktop' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i+1]) opts.target = args[++i];
    else if (args[i] === '--dict' && args[i+1]) { opts.type = 'dict'; opts.term = args[++i]; }
    else if (args[i] === '--quote' && args[i+1]) { opts.type = 'quote'; opts.text = args[++i]; }
    else if (args[i] === '--note' && args[i+1]) { opts.type = 'note'; opts.text = args[++i]; }
    else if (args[i] === '--book' && args[i+1]) opts.bookHash = args[++i];
    else if (args[i] === '--definition' && args[i+1]) opts.definition = args[++i];
    else if (args[i] === '--comment' && args[i+1]) opts.comment = args[++i];
  }
  return opts;
}

// Only run CLI if executed directly (not imported)
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^\.\//, ''));
if (isMain) {
  const opts = parseArgs();
  requireDevHarness(process.env, 'dev-sync-fixture');

  if (!opts.bookHash) {
    console.error('Usage: dev-sync-fixture.mjs --dict <term> --book <hash> [--definition <text>]');
    process.exit(1);
  }

  let resultPromise;
  switch (opts.type) {
    case 'dict':
      resultPromise = injectDictionary({
        target: opts.target, bookHash: opts.bookHash,
        term: opts.term, definition: opts.definition,
      });
      break;
    case 'quote':
      resultPromise = injectQuote({
        target: opts.target, bookHash: opts.bookHash,
        text: opts.text, comment: opts.comment,
      });
      break;
    case 'note':
      resultPromise = injectAnnotation({
        target: opts.target, bookHash: opts.bookHash,
        text: opts.text,
      });
      break;
    default:
      console.error('Unknown fixture type. Use --dict, --quote, or --note.');
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
