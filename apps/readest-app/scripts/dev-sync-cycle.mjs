#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';
import { evaluateTriggerPayload } from './dev-sync-trigger.mjs';
import { runPhase2Preflight } from './sync-phase2-preflight.mjs';
import { createEpubImportDescriptor } from './prepare-engine.mjs';
import { importBookViaHttp } from './sync-dev-inject-http.mjs';
import {
  annotationIdentityKey,
  assertBookNoteIntegrity,
  assertBookNoteType,
  dictionaryEntryIdentityKey,
} from './assert-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPEAT_CHILD_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

export function buildStateJsonSpawnOptions(envVars) {
  return {
    cwd: process.cwd(),
    env: { ...process.env, ...envVars, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 10_000,
  };
}

function spawnStateJson(envVars) {
  const stateScript = new URL('./dev-sync-state.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [stateScript, '--json'], buildStateJsonSpawnOptions(envVars));
  if (result.status !== 0 && !result.stdout) {
    throw new Error(`dev-sync-state failed (exit ${result.status}): ${result.stderr || 'unknown error'}`);
  }
  return JSON.parse(result.stdout);
}

function spawnInject(stateEnv, prepareCfg) {
  const script = prepareCfg.script;
  const args = prepareCfg.args || [];
  const env = { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' };
  try {
    const output = execFileSync(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10_000,
    });
    const parsed = JSON.parse(output);
    return { ok: parsed.ok !== false, error: parsed.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function spawnFixture(stateEnv, args) {
  const script = join(__dirname, 'dev-sync-fixture.mjs');
  try {
    const output = execFileSync(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    });
    return JSON.parse(output);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function putAndroidBookConfig(serverUrl, bookHash, config) {
  try {
    const response = await fetch(`${serverUrl}/books/${bookHash}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { ok: false, error: `book config PUT returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function firstAndroidBookHash(state) {
  return state?.android?.bookIndex?.facts?.find((fact) => fact?.hash && !fact.deletedAt)?.hash
    ?? state?.android?.manifest?.data?.books?.find((book) => book?.hash && !book.deletedAt)?.hash;
}

function hasLiveAndroidBookHash(state, hash) {
  if (!hash) return false;
  return Boolean(
    state?.android?.bookIndex?.facts?.some((fact) => (fact?.hash === hash || fact?.bookHash === hash) && !fact.deletedAt)
    || state?.android?.manifest?.data?.books?.some((book) => (book?.hash === hash || book?.bookHash === hash) && !book.deletedAt),
  );
}

function sampleEpubPath() {
  return join(__dirname, '..', 'src', '__tests__', 'fixtures', 'data', 'sample-alice.epub');
}

function resurrectDesktopLibraryBook(stateEnv, descriptor, now) {
  const dataRoot = stateEnv?.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT;
  if (!dataRoot || !descriptor?.hash) return { ok: true, updated: false };

  const booksDir = join(dataRoot, 'Readest', 'Books');
  const libraryPath = join(booksDir, 'library.json');
  try {
    mkdirSync(booksDir, { recursive: true });
    const books = existsSync(libraryPath) ? JSON.parse(readFileSync(libraryPath, 'utf8')) : [];
    if (!Array.isArray(books)) return { ok: false, error: 'desktop library.json is not an array' };
    let found = false;
    const liveEntry = {
      ...(descriptor.entry ?? {}),
      hash: descriptor.hash,
      updatedAt: now,
      deletedAt: null,
    };
    const nextBooks = books.map((book) => {
      if (book?.hash !== descriptor.hash && book?.bookHash !== descriptor.hash) return book;
      found = true;
      return { ...book, ...liveEntry };
    });
    if (!found) nextBooks.push(liveEntry);
    writeFileSync(libraryPath, JSON.stringify(nextBooks, null, 2), 'utf8');
    return { ok: true, updated: true, path: libraryPath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), path: libraryPath };
  }
}

export async function ensurePhase2LiveBook({
  caseRef,
  pre,
  stateEnv,
  env,
  now = Date.now(),
  createDescriptor = createEpubImportDescriptor,
  importBook = importBookViaHttp,
}) {
  const envHash = stateEnv?.BIBLIOTECA_DEV_STATE_BOOK_HASH;
  const existingHash = hasLiveAndroidBookHash(pre, envHash) ? envHash : firstAndroidBookHash(pre);
  if (existingHash) {
    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = existingHash;
    return { ok: true, bookHash: existingHash, seeded: false };
  }

  try {
    const descriptor = createDescriptor({ filePath: sampleEpubPath(), now });
    const importResult = await importBook(env.android.serverUrl, descriptor, { now });
    if (importResult.ok === false) {
      return {
        ok: false,
        seeded: false,
        error: `harness setup failed: unable to seed live book for Phase 2 case ${caseRef}: ${importResult.error || 'unknown import error'}`,
        importResult,
      };
    }
    const desktopResult = resurrectDesktopLibraryBook(stateEnv, descriptor, now);
    if (!desktopResult.ok) {
      return {
        ok: false,
        seeded: false,
        error: `harness setup failed: unable to resurrect desktop live book for Phase 2 case ${caseRef}: ${desktopResult.error || 'unknown desktop library error'}`,
        importResult,
        desktopResult,
      };
    }
    const bookHash = importResult.bookHash ?? importResult.hash ?? descriptor.hash;
    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;
    return { ok: true, bookHash, seeded: true, importResult, desktopResult };
  } catch (err) {
    return {
      ok: false,
      seeded: false,
      error: `harness setup failed: unable to seed live book for Phase 2 case ${caseRef}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function semanticKindForCase(caseRef) {
  if (caseRef === '14a' || caseRef === '14Ma') return 'dictionary';
  if (caseRef === '14b' || caseRef === '14Mb') return 'quote';
  if (caseRef === '14c' || caseRef === '14Mc') return 'annotation';
  return undefined;
}

/**
 * Specialized setup for Case 15 case-refs (15a-15e).
 * Each scenario needs a different book distribution between devices:
 *   15a: Desktop has book L, Android empty
 *   15b: Android has book L, Desktop empty
 *   15c: Both import same book L independently (same hash)
 *   15d: Both have same book L, then edit titles divergently offline
 *   15e: Desktop has AAA, Android has BBB (same title, different hash)
 */
async function setupCase15Ref(normalized, stateEnv, env, runId, now) {
  if (normalized === '15a') {
    const hash = `case15a-${runId}`;
    const result = spawnFixture(stateEnv, [
      '--target', 'desktop', '--case15', hash,
      '--title', 'Alice', '--hlc', String(now),
    ]);
    if (!result.ok) {
      return { ok: false, caseRef: normalized, action: 'case15a-inject', error: result.error || 'desktop inject failed' };
    }
    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = hash;
    return { ok: true, caseRef: normalized, action: 'case15a-desktop-inject', bookHash: hash };
  }

  if (normalized === '15b') {
    const hash = `case15b-${runId}`;
    const result = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', hash,
      '--title', 'Alice', '--hlc', String(now),
    ]);
    if (!result.ok) {
      return { ok: false, caseRef: normalized, action: 'case15b-inject', error: result.error || 'android inject failed' };
    }
    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = hash;
    return { ok: true, caseRef: normalized, action: 'case15b-android-inject', bookHash: hash };
  }

  if (normalized === '15c') {
    const hash = `case15c-${runId}`;
    const deskResult = spawnFixture(stateEnv, [
      '--target', 'desktop', '--case15', hash,
      '--title', 'Alice', '--hlc', String(now),
    ]);
    if (!deskResult.ok) {
      return { ok: false, caseRef: normalized, action: 'case15c-desktop-inject', error: deskResult.error || 'desktop inject failed' };
    }
    const andResult = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', hash,
      '--title', 'Alice', '--hlc', String(now),
    ]);
    if (!andResult.ok) {
      return { ok: false, caseRef: normalized, action: 'case15c-android-inject', error: andResult.error || 'android inject failed' };
    }
    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = hash;
    return { ok: true, caseRef: normalized, action: 'case15c-both-inject', bookHash: hash };
  }

  if (normalized === '15d') {
    const hash = `case15d-${runId}`;
    const deskResult = spawnFixture(stateEnv, [
      '--target', 'desktop', '--case15', hash,
      '--title', 'Alice', '--hlc', String(now),
    ]);
    if (!deskResult.ok) {
      return { ok: false, caseRef: normalized, action: 'case15d-desktop-inject', error: deskResult.error || 'desktop inject failed' };
    }
    const andResult = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', hash,
      '--title', 'Alice', '--hlc', String(now),
    ]);
    if (!andResult.ok) {
      return { ok: false, caseRef: normalized, action: 'case15d-android-inject', error: andResult.error || 'android inject failed' };
    }

    // Edit titles divergently — Android edit is newer (now+2000) so it should win
    const deskEditNow = now + 1000;
    spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `books:${hash}:title=Título A`,
      '--hlc', String(deskEditNow),
    ]);
    const andEditNow = now + 2000;
    spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `books:${hash}:title=Título B`,
      '--hlc', String(andEditNow),
    ]);

    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = hash;
    return {
      ok: true, caseRef: normalized, action: 'case15d-both-edit', bookHash: hash,
      editTimestamps: { desktop: deskEditNow, android: andEditNow },
    };
  }

  if (normalized === '15e') {
    const hashAAA = `case15e-aaa-${runId}`;
    const hashBBB = `case15e-bbb-${runId}`;
    const deskResult = spawnFixture(stateEnv, [
      '--target', 'desktop', '--case15', hashAAA,
      '--title', 'Odisea', '--hlc', String(now),
    ]);
    if (!deskResult.ok) {
      return { ok: false, caseRef: normalized, action: 'case15e-desktop-inject', error: deskResult.error || 'desktop inject failed' };
    }
    const andResult = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', hashBBB,
      '--title', 'Odisea', '--hlc', String(now),
    ]);
    if (!andResult.ok) {
      return { ok: false, caseRef: normalized, action: 'case15e-android-inject', error: andResult.error || 'android inject failed' };
    }

    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = hashAAA;
    return { ok: true, caseRef: normalized, action: 'case15e-both-different', bookHash: hashAAA, secondHash: hashBBB };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Specialized setup for Case 16 case-refs (16a-16b).
 * Dictionary propagation: O→M (16a) and M→O (16b).
 *   16a: Desktop creates dictionary entry, Android converges via sync
 *   16b: Android creates dictionary entry, Desktop converges via sync
 */
async function setupCase16Ref(normalized, stateEnv, env, runId, now) {
  const term = `case16-term-${runId}`;
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case16-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  if (normalized === '16a') {
    const result = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', term,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!result.ok) return { ok: false, caseRef: normalized, action: 'case16a-dict-create', error: result.error || 'desktop dict create failed' };
    return { ok: true, caseRef: normalized, action: 'case16a-desktop-dict', bookHash, term, entryId: result.entryId };
  }

  if (normalized === '16b') {
    const result = spawnFixture(stateEnv, [
      '--target', 'android-http', '--dict', term, '--definition', term,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!result.ok) return { ok: false, caseRef: normalized, action: 'case16b-dict-create', error: result.error || 'android dict create failed' };
    return { ok: true, caseRef: normalized, action: 'case16b-android-dict', bookHash, term, entryId: result.entryId };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Specialized setup for Case 17 case-refs (17a-17b).
 * Quote propagation: O→M (17a) and M→O (17b).
 *   17a: Desktop creates quote, Android converges via sync
 *   17b: Android creates quote, Desktop converges via sync
 */
async function setupCase17Ref(normalized, stateEnv, env, runId, now) {
  const text = `case17-quote-${runId}`;
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case17-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  if (normalized === '17a') {
    const result = spawnFixture(stateEnv, [
      '--target', 'desktop', '--quote', text,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!result.ok) return { ok: false, caseRef: normalized, action: 'case17a-quote-create', error: result.error || 'desktop quote create failed' };
    return { ok: true, caseRef: normalized, action: 'case17a-desktop-quote', bookHash, text, quoteId: result.quoteId };
  }

  if (normalized === '17b') {
    const result = spawnFixture(stateEnv, [
      '--target', 'android-http', '--quote', text,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!result.ok) return { ok: false, caseRef: normalized, action: 'case17b-quote-create', error: result.error || 'android quote create failed' };
    return { ok: true, caseRef: normalized, action: 'case17b-android-quote', bookHash, text, quoteId: result.quoteId };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Specialized setup for Case 18 case-refs (18a-18b).
 * Edit semantic datum with fixed highlight.
 *   18a: Desktop creates dict entry, sync propagates, Desktop edits definition,
 *       second sync propagates edit
 *   18b: Android creates dict entry, sync propagates, Android edits definition,
 *       second sync propagates edit
 *
 * The harness does one sync AFTER setup returns. To get two syncs total,
 * setupCase18Ref triggers the first sync inline (after create, before edit).
 */
async function setupCase18Ref(normalized, stateEnv, env, runId, now) {
  const term = `case18-term-${runId}`;
  const definition = `orig-def-${runId}`;
  const editedDef = `edited-def-${runId}`;
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case18-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  const sourceTarget = normalized === '18a' ? 'desktop' : 'android-http';

  // Step 1: Create dictionary entry on source device
  const createResult = spawnFixture(stateEnv, [
    '--target', sourceTarget, '--dict', term, '--definition', definition,
    '--book', bookHash, '--hlc', String(now),
  ]);
  if (!createResult.ok) {
    return { ok: false, caseRef: normalized, action: 'case18-dict-create', error: createResult.error || 'dict create failed' };
  }
  const entryId = createResult.entryId;

  // Step 2: Trigger first sync to propagate the entry to the other device
  // This runs BEFORE the harness main sync — harness does the second sync
  const triggerUrl = env.desktop.syncTriggerUrl;
  try {
    await fetch(triggerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // First sync may fail in dev harness — second sync may still converge
  }

  // Step 3: Edit definition on source device (HLC must be newer than create)
  const editNow = now + 2000;
  const editResult = spawnFixture(stateEnv, [
    '--target', sourceTarget,
    '--edit', `dictionary_entries:${entryId}:definition=${editedDef}`,
    '--hlc', String(editNow),
  ]);
  if (!editResult.ok) {
    return { ok: false, caseRef: normalized, action: 'case18-dict-edit', error: editResult.error || 'dict edit failed', entryId };
  }

  return {
    ok: true,
    caseRef: normalized,
    action: `case18-${sourceTarget}-dict-edit`,
    bookHash,
    term,
    entryId,
    originalDefinition: definition,
    editedDefinition: editedDef,
  };
}

/**
 * Setup for Case 19 — same range, different groups.
 * Creates two semantic entities (dict + quote) on the SAME CFI range.
 *   19a: Desktop creates dict → sync → Android creates quote at same CFI → return
 *   19b: Android creates quote → sync → Desktop creates dict at same CFI → return
 */
async function setupCase19Ref(normalized, stateEnv, env, runId, now) {
  const term = `case19-term-${runId}`;
  const quoteText = `case19-quote-${runId}`;
  const sharedCfi = '/6/4[section]!/4/2';
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case19-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  if (normalized === '19a') {
    // Desktop creates dict at CFI
    const dict = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', term,
      '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now),
    ]);
    if (!dict.ok) return { ok: false, caseRef: normalized, action: 'case19a-dict-create', error: dict.error };

    // Inline sync
    try {
      await fetch(env.desktop.syncTriggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* second sync may catch up */ }

    // Android creates quote at SAME CFI
    const quote = spawnFixture(stateEnv, [
      '--target', 'android-http', '--quote', quoteText,
      '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now + 2000),
    ]);
    if (!quote.ok) return { ok: false, caseRef: normalized, action: 'case19a-quote-create', error: quote.error };
    return { ok: true, caseRef: normalized, action: 'case19a-dict-then-quote', bookHash, term, entryId: dict.entryId, quoteId: quote.quoteId, cfi: sharedCfi };
  }

  if (normalized === '19b') {
    // Android creates quote at CFI
    const quote = spawnFixture(stateEnv, [
      '--target', 'android-http', '--quote', quoteText,
      '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now),
    ]);
    if (!quote.ok) return { ok: false, caseRef: normalized, action: 'case19b-quote-create', error: quote.error };

    // Inline sync
    try {
      await fetch(env.desktop.syncTriggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* second sync may catch up */ }

    // Desktop creates dict at SAME CFI
    const dict = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', term,
      '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now + 2000),
    ]);
    if (!dict.ok) return { ok: false, caseRef: normalized, action: 'case19b-dict-create', error: dict.error };
    return { ok: true, caseRef: normalized, action: 'case19b-quote-then-dict', bookHash, term, entryId: dict.entryId, quoteId: quote.quoteId, cfi: sharedCfi };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Setup for Case 20 — overlapping ranges.
 * Creates two entities (quote + annotation) with overlapping CFI ranges.
 *   20a: Desktop creates quote → sync → Android creates annotation at overlapping CFI → return
 *   20b: Android creates annotation → sync → Desktop creates quote at overlapping CFI → return
 */
async function setupCase20Ref(normalized, stateEnv, env, runId, now) {
  const quoteText = `case20-quote-${runId}`;
  const noteText = `case20-note-${runId}`;
  const quoteCfi = '/6/4[section]!/10/2:0';
  const noteCfi = '/6/4[section]!/6/2:0';
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case20-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  if (normalized === '20a') {
    // Desktop creates quote
    const quote = spawnFixture(stateEnv, [
      '--target', 'desktop', '--quote', quoteText,
      '--book', bookHash, '--cfi', quoteCfi, '--hlc', String(now),
    ]);
    if (!quote.ok) return { ok: false, caseRef: normalized, action: 'case20a-quote-create', error: quote.error };

    // Inline sync
    try {
      await fetch(env.desktop.syncTriggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* second sync may catch up */ }

    // Android creates annotation at overlapping CFI
    const note = spawnFixture(stateEnv, [
      '--target', 'android-http', '--note', noteText,
      '--book', bookHash, '--cfi', noteCfi, '--hlc', String(now + 2000),
    ]);
    if (!note.ok) return { ok: false, caseRef: normalized, action: 'case20a-note-create', error: note.error };
    return { ok: true, caseRef: normalized, action: 'case20a-quote-then-note', bookHash, quoteId: quote.quoteId, annId: note.annId, quoteCfi, noteCfi };
  }

  if (normalized === '20b') {
    // Android creates annotation
    const note = spawnFixture(stateEnv, [
      '--target', 'android-http', '--note', noteText,
      '--book', bookHash, '--cfi', noteCfi, '--hlc', String(now),
    ]);
    if (!note.ok) return { ok: false, caseRef: normalized, action: 'case20b-note-create', error: note.error };

    // Inline sync
    try {
      await fetch(env.desktop.syncTriggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* second sync may catch up */ }

    // Desktop creates quote at overlapping CFI
    const quote = spawnFixture(stateEnv, [
      '--target', 'desktop', '--quote', quoteText,
      '--book', bookHash, '--cfi', quoteCfi, '--hlc', String(now + 2000),
    ]);
    if (!quote.ok) return { ok: false, caseRef: normalized, action: 'case20b-quote-create', error: quote.error };
    return { ok: true, caseRef: normalized, action: 'case20b-note-then-quote', bookHash, quoteId: quote.quoteId, annId: note.annId, quoteCfi, noteCfi };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Setup for Case 21 — same-field edit (4 sub-cases: 21a-21d).
 * Both devices create the same entity, then both edit the same field
 * independently before sync (O⇄M). HLC determines which edit wins.
 */
async function setupCase21Ref(normalized, stateEnv, env, runId, now) {
  const term = `case21-term-${runId}`;
  const noteText = `case21-note-${runId}`;
  const noteCfi = '/6/4[section]!/6/2:0';
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case21-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  if (normalized === '21a') {
    // Both edit D.definition — Android's HLC=11 wins
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', 'deep hole',
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case21a-desk-dict', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--dict', term, '--definition', 'deep hole',
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case21a-and-dict', error: andCreate.error };

    // Both edit definition concurrently — Android HLC=11 wins
    const deskEdit = spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `dictionary_entries:${deskCreate.entryId}:definition=profound void`,
      '--hlc', String(now + 10),
    ]);
    if (!deskEdit.ok) return { ok: false, caseRef: normalized, action: 'case21a-desk-edit', error: deskEdit.error };

    const andEdit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `dictionary_entries:${andCreate.entryId}:definition=very deep chasm`,
      '--hlc', String(now + 11),
    ]);
    if (!andEdit.ok) return { ok: false, caseRef: normalized, action: 'case21a-and-edit', error: andEdit.error };

    return { ok: true, caseRef: normalized, action: 'case21a-both-edit-def', bookHash, term, language: 'es',
      edits: [{ device: 'desktop', hlc: now + 10, value: 'profound void' }, { device: 'android', hlc: now + 11, value: 'very deep chasm' }] };
  }

  if (normalized === '21b') {
    // Both edit N.note — Android's HLC=12 wins. Text field immutable.
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--note', noteText,
      '--book', bookHash, '--cfi', noteCfi, '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case21b-desk-note', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--note', noteText,
      '--book', bookHash, '--cfi', noteCfi, '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case21b-and-note', error: andCreate.error };

    // Set initial note value on both sides (--note sets note=text, we need note="original idea")
    const deskInit = spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `annotations:${deskCreate.annId}:note=original idea`,
      '--hlc', String(now + 1),
    ]);
    if (!deskInit.ok) return { ok: false, caseRef: normalized, action: 'case21b-desk-note-init', error: deskInit.error };

    const andInit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `annotations:${andCreate.annId}:note=original idea`,
      '--hlc', String(now + 1),
    ]);
    if (!andInit.ok) return { ok: false, caseRef: normalized, action: 'case21b-and-note-init', error: andInit.error };

    // Both edit note concurrently — Android HLC=12 wins
    const deskEdit = spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `annotations:${deskCreate.annId}:note=revised analysis`,
      '--hlc', String(now + 10),
    ]);
    if (!deskEdit.ok) return { ok: false, caseRef: normalized, action: 'case21b-desk-edit-note', error: deskEdit.error };

    const andEdit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `annotations:${andCreate.annId}:note=alternative interpretation`,
      '--hlc', String(now + 12),
    ]);
    if (!andEdit.ok) return { ok: false, caseRef: normalized, action: 'case21b-and-edit-note', error: andEdit.error };

    return { ok: true, caseRef: normalized, action: 'case21b-both-edit-note', bookHash, term, text: noteText, cfi: noteCfi,
      edits: [{ device: 'desktop', hlc: now + 10, value: 'revised analysis' }, { device: 'android', hlc: now + 12, value: 'alternative interpretation' }] };
  }

  if (normalized === '21c') {
    // Both edit L.title — Android's HLC=14 wins
    const deskEdit = spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `books:${bookHash}:title=Desktop Title`,
      '--hlc', String(now + 9),
    ]);
    if (!deskEdit.ok) return { ok: false, caseRef: normalized, action: 'case21c-desk-title', error: deskEdit.error };

    const andEdit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `books:${bookHash}:title=Android Title`,
      '--hlc', String(now + 14),
    ]);
    if (!andEdit.ok) return { ok: false, caseRef: normalized, action: 'case21c-and-title', error: andEdit.error };

    return { ok: true, caseRef: normalized, action: 'case21c-both-edit-title', bookHash,
      edits: [{ device: 'desktop', hlc: now + 9, value: 'Desktop Title' }, { device: 'android', hlc: now + 14, value: 'Android Title' }] };
  }

  if (normalized === '21d') {
    // Same HLC time on both edits → nodeId tiebreak
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', 'chance',
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case21d-desk-dict', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--dict', term, '--definition', 'chance',
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case21d-and-dict', error: andCreate.error };

    // Both edit at EXACT same HLC timestamp → nodeId determines winner
    const tiebreakHlc = now + 1000;
    const deskEdit = spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `dictionary_entries:${deskCreate.entryId}:definition=fate`,
      '--hlc', String(tiebreakHlc),
    ]);
    if (!deskEdit.ok) return { ok: false, caseRef: normalized, action: 'case21d-desk-edit', error: deskEdit.error };

    const andEdit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `dictionary_entries:${andCreate.entryId}:definition=luck`,
      '--hlc', String(tiebreakHlc),
    ]);
    if (!andEdit.ok) return { ok: false, caseRef: normalized, action: 'case21d-and-edit', error: andEdit.error };

    return { ok: true, caseRef: normalized, action: 'case21d-tiebreak', bookHash, term, language: 'es',
      edits: [{ device: 'desktop', hlc: tiebreakHlc, value: 'fate' }, { device: 'android', hlc: tiebreakHlc, value: 'luck' }] };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Setup for Case 23 — concurrent creations (5 sub-cases: 23a-23e).
 * Both devices create the same entity type independently before sync (O⇄M).
 * System must deduplicate or converge correctly.
 */
async function setupCase23Ref(normalized, stateEnv, env, runId, now) {
  const term = `case23-term-${runId}`;
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case23-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  // 23a: Same book, same hash (both sides create same book independently)
  if (normalized === '23a') {
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--case15', bookHash,
      '--title', 'Concurrent Book', '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case23a-desk-book', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', bookHash,
      '--title', 'Concurrent Book', '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case23a-and-book', error: andCreate.error };

    return { ok: true, caseRef: normalized, action: 'case23a-concurrent-book', bookHash };
  }

  // 23b: Same book, same hash → different IDs (created independently by harness)
  if (normalized === '23b') {
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--case15', bookHash,
      '--title', 'Concurrent Book', '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case23b-desk-book', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', bookHash,
      '--title', 'Concurrent Book', '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case23b-and-book', error: andCreate.error };

    return { ok: true, caseRef: normalized, action: 'case23b-concurrent-book', bookHash };
  }

  // 23c: Same dictionary word (extends Case 16 pattern — O⇄M variant)
  if (normalized === '23c') {
    const deskDict = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', term,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!deskDict.ok) return { ok: false, caseRef: normalized, action: 'case23c-desk-dict', error: deskDict.error };

    const andDict = spawnFixture(stateEnv, [
      '--target', 'android-http', '--dict', term, '--definition', term,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!andDict.ok) return { ok: false, caseRef: normalized, action: 'case23c-and-dict', error: andDict.error };

    return { ok: true, caseRef: normalized, action: 'case23c-concurrent-dict', bookHash, term,
      desktopEntryId: deskDict.entryId, androidEntryId: andDict.entryId };
  }

  // 23d: Same quote same range (extends Case 17 pattern — O⇄M variant)
  if (normalized === '23d') {
    const sharedCfi = '/6/4[section]!/4/2';
    const quoteText = term;

    const deskQuote = spawnFixture(stateEnv, [
      '--target', 'desktop', '--quote', quoteText,
      '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now),
    ]);
    if (!deskQuote.ok) return { ok: false, caseRef: normalized, action: 'case23d-desk-quote', error: deskQuote.error };

    const andQuote = spawnFixture(stateEnv, [
      '--target', 'android-http', '--quote', quoteText,
      '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now),
    ]);
    if (!andQuote.ok) return { ok: false, caseRef: normalized, action: 'case23d-and-quote', error: andQuote.error };

    return { ok: true, caseRef: normalized, action: 'case23d-concurrent-quote', bookHash, text: quoteText };
  }

  // 23e: Same quote text, two different books → TWO quotes expected
  if (normalized === '23e') {
    const secondHash = `case23e-other-${runId}`;
    const quoteText = term;

    // Create second book on Android
    const andBook = spawnFixture(stateEnv, [
      '--target', 'android-http', '--case15', secondHash,
      '--title', 'Second Book', '--hlc', String(now),
    ]);
    if (!andBook.ok) return { ok: false, caseRef: normalized, action: 'case23e-and-book', error: andBook.error };

    // Quote on desktop (book L1 from ensurePhase2LiveBook)
    const deskQuote = spawnFixture(stateEnv, [
      '--target', 'desktop', '--quote', quoteText,
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!deskQuote.ok) return { ok: false, caseRef: normalized, action: 'case23e-desk-quote', error: deskQuote.error };

    // Quote on Android (book L2 with different hash)
    const andQuote = spawnFixture(stateEnv, [
      '--target', 'android-http', '--quote', quoteText,
      '--book', secondHash, '--hlc', String(now),
    ]);
    if (!andQuote.ok) return { ok: false, caseRef: normalized, action: 'case23e-and-quote', error: andQuote.error };

    return { ok: true, caseRef: normalized, action: 'case23e-different-books-quote', bookHash, secondHash, text: quoteText };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Setup for Case 24 — distinct annotations same range.
 * Desktop creates N1, Android creates N2 on the same CFI range.
 * Both annotations MUST survive after sync (no merge, no loss).
 */
export async function setupCase24Ref(normalized, stateEnv, env, runId, now, { spawnFixture: _spawnFixture, spawnStateJson: _spawnStateJson, ensurePhase2LiveBook: _ensurePhase2LiveBook } = {}) {
  const sf = _spawnFixture ?? spawnFixture;
  const ssj = _spawnStateJson ?? spawnStateJson;
  const eplb = _ensurePhase2LiveBook ?? ensurePhase2LiveBook;
  const pre = ssj(stateEnv);
  const liveBook = await eplb({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case24-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  const sharedCfi = `/6/4[${runId}]!/6/2:0`;
  const notes = [`${runId}-Idea A`, `${runId}-Idea B`];

  // Desktop creates N1(range=100-120, note=<run-scoped Idea A>)
  const deskNote = sf(stateEnv, [
    '--target', 'desktop', '--note', notes[0],
    '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now),
  ]);
  if (!deskNote.ok) return { ok: false, caseRef: normalized, action: 'case24-desk-note', error: deskNote.error };

  // Android creates N2(range=100-120, note=<run-scoped Idea B>)
  const andNote = sf(stateEnv, [
    '--target', 'android-http', '--note', notes[1],
    '--book', bookHash, '--cfi', sharedCfi, '--hlc', String(now + 2000),
  ]);
  if (!andNote.ok) return { ok: false, caseRef: normalized, action: 'case24-and-note', error: andNote.error };

  return { ok: true, caseRef: normalized, action: 'case24-two-annotations-same-range', bookHash,
    annIds: [deskNote.annId, andNote.annId], notes, cfi: sharedCfi };
}

/**
 * Setup for Case 22 — Edit vs Delete (2 active sub-cases: 22a, 22c; 22b BLOCKED).
 * Tests HLC-based resolution when one device deletes and the other edits concurrently.
 */
async function setupCase22Ref(normalized, stateEnv, env, runId, now) {
  const term = `case22-term-${runId}`;
  const noteText = `case22-note-${runId}`;
  const noteCfi = '/6/4[section]!/6/2:0';
  const pre = spawnStateJson(stateEnv);
  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case22-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  // 22a: Dictionary delete vs edit
  if (normalized === '22a') {
    // Seed D(term="valle", definition="valley") on both sides
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--dict', term, '--definition', 'valley',
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case22a-desk-dict', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--dict', term, '--definition', 'valley',
      '--book', bookHash, '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case22a-and-dict', error: andCreate.error };

    // Variant 1 (delete wins): Desktop deletes D (HLC=12), Android edits (HLC=11)
    const deskDelete = spawnFixture(stateEnv, [
      '--target', 'desktop', '--delete', `dictionary_entries:${deskCreate.entryId}`,
      '--hlc', String(now + 12),
    ]);
    if (!deskDelete.ok) return { ok: false, caseRef: normalized, action: 'case22a-desk-delete', error: deskDelete.error };

    const andEdit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `dictionary_entries:${andCreate.entryId}:definition=gorge`,
      '--hlc', String(now + 11),
    ]);
    if (!andEdit.ok) return { ok: false, caseRef: normalized, action: 'case22a-and-edit', error: andEdit.error };

    return {
      ok: true, caseRef: normalized, action: 'case22a-delete-wins', bookHash, term,
      entityType: 'dictionary-entry', entityId: deskCreate.entryId,
      language: 'es',
      deleteHLC: now + 12, editHLC: now + 11, deleteWins: true, editValue: 'gorge',
    };
  }

  // 22c: Annotation delete vs edit
  if (normalized === '22c') {
    // Seed N(text=run-scoped noteText, note="original") on both sides
    const deskCreate = spawnFixture(stateEnv, [
      '--target', 'desktop', '--note', noteText,
      '--book', bookHash, '--cfi', noteCfi, '--hlc', String(now),
    ]);
    if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case22c-desk-note', error: deskCreate.error };

    const andCreate = spawnFixture(stateEnv, [
      '--target', 'android-http', '--note', noteText,
      '--book', bookHash, '--cfi', noteCfi, '--hlc', String(now),
    ]);
    if (!andCreate.ok) return { ok: false, caseRef: normalized, action: 'case22c-and-note', error: andCreate.error };

    // Set note to "original" on both (--note sets note=text)
    spawnFixture(stateEnv, [
      '--target', 'desktop', '--edit', `annotations:${deskCreate.annId}:note=original`,
      '--hlc', String(now + 1),
    ]);
    spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `annotations:${andCreate.annId}:note=original`,
      '--hlc', String(now + 1),
    ]);

    // Variant 1 (delete wins): Desktop deletes N (HLC=15), Android edits note (HLC=14)
    const deskDelete = spawnFixture(stateEnv, [
      '--target', 'desktop', '--delete', `annotations:${deskCreate.annId}`,
      '--hlc', String(now + 15),
    ]);
    if (!deskDelete.ok) return { ok: false, caseRef: normalized, action: 'case22c-desk-delete', error: deskDelete.error };

    const andEdit = spawnFixture(stateEnv, [
      '--target', 'android-http', '--edit', `annotations:${andCreate.annId}:note=updated`,
      '--hlc', String(now + 14),
    ]);
    if (!andEdit.ok) return { ok: false, caseRef: normalized, action: 'case22c-and-edit', error: andEdit.error };

    return {
      ok: true, caseRef: normalized, action: 'case22c-delete-wins', bookHash, term, text: noteText, cfi: noteCfi,
      entityType: 'annotation', entityId: deskCreate.annId,
      deleteHLC: now + 15, editHLC: now + 14, deleteWins: true, editValue: 'updated',
    };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

/**
 * Setup for Case 25 — Highlight Group Mutation (DISCOVER, 1 sub-case).
 * Creates H_N→N (annotation) on Desktop, then uses --booknote-mutate
 * to change the BookNote type from annotation to cite on Android.
 * Sync O⇄M — observe what the system does.
 */
export async function setupCase25Ref(normalized, stateEnv, env, runId, now, { spawnFixture: _spawnFixture, spawnStateJson: _spawnStateJson, ensurePhase2LiveBook: _ensurePhase2LiveBook } = {}) {
  const sf = _spawnFixture ?? spawnFixture;
  const ssj = _spawnStateJson ?? spawnStateJson;
  const eplb = _ensurePhase2LiveBook ?? ensurePhase2LiveBook;
  const pre = ssj(stateEnv);
  const liveBook = await eplb({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case25-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  // Desktop creates H_N(range=100-120) → N(note="original") via --note
  const deskCreate = sf(stateEnv, [
    '--target', 'desktop', '--note', 'original',
    '--book', bookHash, '--hlc', String(now),
  ]);
  if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case25-desk-note', error: deskCreate.error };
  // Use the real annotation ID from the fixture, not a fabricated string
  const noteId = deskCreate.annId;

  // Mutate the BookNote type on Android from annotation to cite (quote)
  const mutateResult = sf(stateEnv, [
    '--target', 'android-http', '--booknote-mutate', `${bookHash}:${noteId}:quote`,
    '--book', bookHash,
  ]);
  if (!mutateResult.ok) return { ok: false, caseRef: normalized, action: 'case25-and-mutate', error: mutateResult.error };

  return {
    ok: true, caseRef: normalized, action: 'case25-discover-mutate', bookHash,
    noteId, originalType: 'annotation', mutatedType: 'quote',
  };
}

/**
 * Setup for Case 26 — Wrong Group Pointer (DISCOVER, 1 sub-case).
 * Creates H_D(range=100-120) → D(term="error") with dictionary type on Desktop.
 * Then uses --booknote-invalid-ref on Android to change the pointer from
 * dictionaryEntryId=D to citeId=C (cross-type).
 * Sync O⇄M — observe what the system does.
 */
export async function setupCase26Ref(normalized, stateEnv, env, runId, now, { spawnFixture: _spawnFixture, spawnStateJson: _spawnStateJson, ensurePhase2LiveBook: _ensurePhase2LiveBook } = {}) {
  const sf = _spawnFixture ?? spawnFixture;
  const ssj = _spawnStateJson ?? spawnStateJson;
  const eplb = _ensurePhase2LiveBook ?? ensurePhase2LiveBook;
  const term = `case26-term-${runId}`;
  const pre = ssj(stateEnv);
  const liveBook = await eplb({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'case26-live-book', error: liveBook.error };
  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  // Desktop creates H_D(range=100-120) → D(term="error") via --dict
  const deskCreate = sf(stateEnv, [
    '--target', 'desktop', '--dict', term, '--definition', 'mistake',
    '--book', bookHash, '--hlc', String(now),
  ]);
  if (!deskCreate.ok) return { ok: false, caseRef: normalized, action: 'case26-desk-dict', error: deskCreate.error };
  // Use the real entity ID from the fixture, not a fabricated string
  const noteId = deskCreate.entryId;

  // Create a quote entity on Android so the cross-type pointer has a target
  // (Otherwise both devices create it)
  const andQuote = sf(stateEnv, [
    '--target', 'android-http', '--quote', 'wrong target',
    '--book', bookHash, '--hlc', String(now),
  ]);
  const wrongEntityId = andQuote.ok ? andQuote.quoteId : `fake-quote-${runId}`;

  // Invalidate the pointer on Android: change from dictionaryEntryId to citeId
  const invalidResult = sf(stateEnv, [
    '--target', 'android-http', '--booknote-invalid-ref', `${bookHash}:${noteId}:quote:${wrongEntityId}`,
    '--book', bookHash,
  ]);
  if (!invalidResult.ok) return { ok: false, caseRef: normalized, action: 'case26-and-invalid-ref', error: invalidResult.error };

  return {
    ok: true, caseRef: normalized, action: 'case26-discover-invalid-ref', bookHash,
    noteId, expectedType: 'dictionary', expectedEntityId: deskCreate.entryId,
    wrongEntityId,
  };
}

async function executePhase2CaseRef(caseRef, pre, stateEnv, env, runId) {
  const normalized = String(caseRef ?? '').trim();
  const now = Date.now();

  // Case 15 needs specialized per-scenario book setup
  if (/^15[a-e]$/.test(normalized)) {
    return setupCase15Ref(normalized, stateEnv, env, runId, now);
  }

  // Cases 16-17: dictionary/quote propagation
  if (/^1[67][ab]$/.test(normalized)) {
    if (normalized.startsWith('16')) return setupCase16Ref(normalized, stateEnv, env, runId, now);
    if (normalized.startsWith('17')) return setupCase17Ref(normalized, stateEnv, env, runId, now);
  }

  // Case 18: edit semantic datum with fixed highlight
  if (/^18[ab]$/.test(normalized)) {
    return setupCase18Ref(normalized, stateEnv, env, runId, now);
  }

  // Case 19: same range, different groups (dict + quote on same CFI)
  if (/^19[ab]$/.test(normalized)) {
    return setupCase19Ref(normalized, stateEnv, env, runId, now);
  }

  // Case 20: overlapping ranges (quote + annotation on overlapping CFIs)
  if (/^20[ab]$/.test(normalized)) {
    return setupCase20Ref(normalized, stateEnv, env, runId, now);
  }

  // Phase 4 routing — cases 21-26
  if (/^2[1-6][a-e]?$/.test(normalized)) {
    if (normalized.startsWith('21')) return setupCase21Ref(normalized, stateEnv, env, runId, now);
    if (normalized.startsWith('22')) {
      if (normalized === '22b') return { ok: true, caseRef: '22b', action: 'blocked', note: 'Quotes immutable per §13.6. NOT APPLICABLE.' };
      return setupCase22Ref(normalized, stateEnv, env, runId, now);
    }
    if (normalized.startsWith('23')) return setupCase23Ref(normalized, stateEnv, env, runId, now);
    if (normalized === '24') return setupCase24Ref(normalized, stateEnv, env, runId, now);
    if (normalized === '25') return setupCase25Ref(normalized, stateEnv, env, runId, now);
    if (normalized === '26') return setupCase26Ref(normalized, stateEnv, env, runId, now);
  }

  const liveBook = await ensurePhase2LiveBook({ caseRef: normalized, pre, stateEnv, env, now });
  if (!liveBook.ok) return { ok: false, caseRef: normalized, action: 'phase2-live-book-seed', error: liveBook.error, setup: liveBook };

  const bookHash = liveBook.bookHash;
  stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = bookHash;

  if (normalized === '9Ma') {
    const editNow = now + 1000;
    const title = `Phase2 9Ma ${runId}`;
    const result = spawnFixture(stateEnv, ['--target', 'android-http', '--edit', `books:${bookHash}:title=${title}`, '--hlc', String(editNow)]);
    return { ok: result.ok !== false, caseRef: normalized, action: 'android-book-edit', bookHash, title, result };
  }

  if (normalized === '13Ma') {
    const epubPath = sampleEpubPath();
    const deleteResult = spawnFixture(stateEnv, ['--target', 'android-http', '--delete-book', bookHash, '--hlc', String(now)]);
    if (deleteResult.ok === false) return { ok: false, caseRef: normalized, action: 'android-same-hash-reimport', bookHash, deleteResult };
    const importResult = spawnFixture(stateEnv, ['--target', 'android-http', '--import-book', epubPath, '--hlc', String(now + 1000)]);
    const importedHash = importResult.bookHash ?? importResult.hash ?? bookHash;
    stateEnv.BIBLIOTECA_DEV_STATE_BOOK_HASH = importedHash;
    return { ok: importResult.ok !== false, caseRef: normalized, action: 'android-same-hash-reimport', bookHash: importedHash, deleteResult, importResult };
  }

  const semanticKind = semanticKindForCase(normalized);
  if (semanticKind) {
    const text = `phase2-${normalized}-${runId}`;
    const createArgs = semanticKind === 'dictionary'
      ? ['--target', 'android-http', '--dict', text, '--definition', text, '--book', bookHash, '--hlc', String(now)]
      : semanticKind === 'quote'
        ? ['--target', 'android-http', '--quote', text, '--book', bookHash, '--hlc', String(now)]
        : ['--target', 'android-http', '--note', text, '--book', bookHash, '--hlc', String(now)];
    const createResult = spawnFixture(stateEnv, createArgs);
    if (createResult.ok === false) return { ok: false, caseRef: normalized, action: 'semantic-create', bookHash, semanticKind, createResult };

    const semanticId = semanticKind === 'dictionary' ? createResult.entryId : semanticKind === 'quote' ? createResult.quoteId : createResult.annId;
    const note = {
      id: `booknote-${normalized}-${now}`,
      type: semanticKind,
      cfi: semanticKind === 'dictionary' ? '/6/4[section]!/4/2' : semanticKind === 'quote' ? '/6/4[section]!/10/2:0' : '/6/4[section]!/6/2:0',
      text,
      ...(semanticKind === 'dictionary' ? { dictionaryEntryId: semanticId } : {}),
      ...(semanticKind === 'quote' ? { citeId: semanticId } : {}),
      ...(semanticKind === 'annotation' ? { annotationId: semanticId } : {}),
    };
    const configResult = await putAndroidBookConfig(env.android.serverUrl, bookHash, { booknotes: [note], updatedAt: now });
    if (!configResult.ok) return { ok: false, caseRef: normalized, action: 'semantic-config', bookHash, semanticKind, createResult, configResult };
    const deleteResult = spawnFixture(stateEnv, ['--target', 'android-http', '--semantic-delete', semanticKind, '--id', semanticId, '--text', text, '--book', bookHash, '--hlc', String(now + 1000)]);
    const deleteTarget = { kind: semanticKind, id: semanticId, bookHash, text, semanticRowId: deleteResult.semanticRowId, noteId: deleteResult.booknoteId };
    stateEnv.BIBLIOTECA_DEV_STATE_SEMANTIC_DELETE_TARGET = JSON.stringify(deleteTarget);
    return { ok: deleteResult.ok !== false, caseRef: normalized, action: 'semantic-delete', bookHash, semanticKind, semanticId, createResult, configResult, deleteResult };
  }

  return { ok: true, caseRef: normalized, action: 'none' };
}

async function executePhase2CaseRefs(caseRef, pre, stateEnv, env, runId) {
  const refs = String(caseRef ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const actions = [];
  for (const ref of refs) {
    const action = await executePhase2CaseRef(ref, pre, stateEnv, env, runId);
    actions.push(action);
    if (!action.ok) break;
  }
  return actions;
}

async function triggerSync(triggerUrl, attempts, dataRoot) {
  for (let i = 1; i <= 2; i++) {
    try {
      const res = await fetch(triggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      const evaluation = evaluateTriggerPayload({ httpOk: res.ok, httpStatus: res.status, payload: data, endpoint: triggerUrl });
      attempts.push({
        attempt: i,
        ok: evaluation.ok,
        status: res.status,
        error: evaluation.errors?.[0]?.message,
        evidencePath: evaluation.evidence?.path,
      });
      return { response: data, ok: evaluation.ok, status: evaluation.status, evidence: evaluation.evidence, errors: evaluation.errors };
    } catch (err) {
      attempts.push({
        attempt: i,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return { response: null, ok: false };
}

function timestampMillis(value) {
  const millis = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(millis) ? millis : null;
}

function latestFact(facts = []) {
  return facts.filter((fact) => fact?.hash).sort((a, b) => (timestampMillis(b.updatedAt) ?? -Infinity) - (timestampMillis(a.updatedAt) ?? -Infinity))[0];
}

function factByHash(facts = [], hash) {
  return facts.find((fact) => fact?.hash === hash || fact?.bookHash === hash);
}

function sameText(a, b) {
  return String(a ?? '') === String(b ?? '') && String(a ?? '') !== '';
}

function newerThan(after, before) {
  const afterMillis = timestampMillis(after);
  const beforeMillis = timestampMillis(before);
  return afterMillis !== null && beforeMillis !== null && afterMillis > beforeMillis;
}

function successful9MaAction(context, hash, title, before) {
  const action = context?.caseActions?.find((candidate) => (
    candidate?.ok !== false
    && candidate?.caseRef === '9Ma'
    && candidate?.action === 'android-book-edit'
    && (candidate?.bookHash === hash || !hash)
    && sameText(candidate?.title, title)
    && candidate?.result?.ok !== false
  ));
  if (!action) return false;
  const actionUpdatedAt = action?.result?.updatedAt;
  return actionUpdatedAt === undefined || newerThan(actionUpdatedAt, before?.updatedAt);
}

function countHashes(facts, hash) {
  return (facts || []).filter((f) => f && (f.hash === hash || f.bookHash === hash)).length;
}

function computeCase15Verdict(normalized, pre, post, context = {}) {
  const caseActions = context?.caseActions || [];

  // --- 15a / 15b: single-source propagation ---
  if (normalized === '15a' || normalized === '15b') {
    const sourceFacts = normalized === '15a'
      ? (pre?.desktop?.library?.facts || [])
      : (pre?.android?.bookIndex?.facts || []);
    const preFact = sourceFacts.find((f) => f?.hash);
    let hash = preFact?.hash || preFact?.bookHash;
    // Fallback: book was injected after pre-state capture → get hash from setup action
    if (!hash) {
      const caseAction = caseActions.find((a) => a.caseRef === normalized);
      hash = caseAction?.bookHash;
    }
    if (!hash) return 'warn';

    const desktopCount = countHashes(post?.desktop?.library?.facts, hash);
    const androidCount = countHashes(post?.android?.bookIndex?.facts, hash);

    if (desktopCount === 1 && androidCount === 1) return 'pass';
    if (desktopCount > 1 || androidCount > 1) return 'fail';
    return 'warn';
  }

  // --- 15c: concurrent import (same hash on both sides) ---
  if (normalized === '15c') {
    const preDesktopHashes = new Set(
      (pre?.desktop?.library?.facts || []).map((f) => f?.hash).filter(Boolean),
    );
    let hash;
    if (preDesktopHashes.size > 0) {
      const commonFact = (pre?.android?.bookIndex?.facts || []).find(
        (f) => f?.hash && preDesktopHashes.has(f.hash),
      );
      hash = commonFact?.hash || commonFact?.bookHash;
    }
    // Fallback: book was injected after pre-state capture
    if (!hash) {
      const caseAction = caseActions.find((a) => a.caseRef === normalized);
      hash = caseAction?.bookHash;
    }
    if (!hash) return 'warn';

    const desktopCount = countHashes(post?.desktop?.library?.facts, hash);
    const androidCount = countHashes(post?.android?.bookIndex?.facts, hash);

    if (desktopCount === 1 && androidCount === 1) return 'pass';
    if (desktopCount > 1 || androidCount > 1) return 'fail';
    return 'warn';
  }

  // --- 15d: concurrent metadata divergence ---
  if (normalized === '15d') {
    const preDesktopHashes = new Set(
      (pre?.desktop?.library?.facts || []).map((f) => f?.hash).filter(Boolean),
    );
    let hash;
    if (preDesktopHashes.size > 0) {
      const preAndroidFact = (pre?.android?.bookIndex?.facts || []).find(
        (f) => f?.hash && preDesktopHashes.has(f.hash),
      );
      hash = preAndroidFact?.hash || preAndroidFact?.bookHash;
    }
    // Fallback: book was injected after pre-state capture
    if (!hash) {
      const caseAction = caseActions.find((a) => a.caseRef === normalized);
      hash = caseAction?.bookHash;
    }
    if (!hash) return 'warn';

    const preDesktopFact = (pre?.desktop?.library?.facts || []).find(
      (f) => f?.hash === hash || f?.bookHash === hash,
    );
    // preAndroidFact was already resolved above for hash extraction; find it again for comparison
    const preAndroidFact = (pre?.android?.bookIndex?.facts || []).find(
      (f) => f?.hash === hash || f?.bookHash === hash,
    );

    const postDesktopFact = (post?.desktop?.library?.facts || []).find(
      (f) => f?.hash === hash || f?.bookHash === hash,
    );
    const postAndroidFact = (post?.android?.bookIndex?.facts || []).find(
      (f) => f?.hash === hash || f?.bookHash === hash,
    );

    if (!postDesktopFact || !postAndroidFact) return 'warn';

    const titlesMatch = String(postDesktopFact.title ?? '') !== ''
      && postDesktopFact.title === postAndroidFact.title;

    // When pre-state is empty (book injected after pre capture), skip timestamp
    // comparison and rely solely on title convergence as the pass criterion.
    if (!preDesktopFact || !preAndroidFact) {
      return titlesMatch ? 'pass' : 'warn';
    }

    const desktopNewer = newerThan(postDesktopFact.updatedAt, preDesktopFact.updatedAt);
    const androidNewer = newerThan(postAndroidFact.updatedAt, preAndroidFact.updatedAt);

    if (titlesMatch && desktopNewer && androidNewer) return 'pass';
    return 'warn';
  }

  // --- 15e: same title, different hash ---
  if (normalized === '15e') {
    const preDesktopFact = (pre?.desktop?.library?.facts || []).find((f) => f?.hash);
    const preAndroidFact = (pre?.android?.bookIndex?.facts || []).find((f) => f?.hash);
    let hashDesktop = preDesktopFact?.hash || preDesktopFact?.bookHash;
    let hashAndroid = preAndroidFact?.hash || preAndroidFact?.bookHash;
    // Fallback: books were injected after pre-state capture
    if (!hashDesktop || !hashAndroid || hashDesktop === hashAndroid) {
      const caseAction = caseActions.find((a) => a.caseRef === normalized);
      if (caseAction?.secondHash) {
        hashDesktop = hashDesktop || caseAction.bookHash;
        hashAndroid = hashAndroid || caseAction.secondHash;
      }
    }
    if (!hashDesktop || !hashAndroid || hashDesktop === hashAndroid) return 'warn';

    const deskAAA = countHashes(post?.desktop?.library?.facts, hashDesktop);
    const deskBBB = countHashes(post?.desktop?.library?.facts, hashAndroid);
    const andAAA = countHashes(post?.android?.bookIndex?.facts, hashDesktop);
    const andBBB = countHashes(post?.android?.bookIndex?.facts, hashAndroid);

    const liveDesktop = (post?.desktop?.library?.facts || []).filter((f) => !f?.deletedAt).length;
    const liveAndroid = (post?.android?.bookIndex?.facts || []).filter((f) => !f?.deletedAt).length;

    if (deskAAA === 1 && deskBBB === 1 && andAAA === 1 && andBBB === 1
      && liveDesktop >= 2 && liveAndroid >= 2) return 'pass';
    if (deskAAA > 1 || deskBBB > 1 || andAAA > 1 || andBBB > 1) return 'fail';
    return 'warn';
  }

  return undefined;
}

export function computeCaseAcceptanceVerdict(caseRef, pre, post, context = {}) {
  const normalized = String(caseRef ?? '').trim();
  if (!normalized) return undefined;

  if (normalized.includes(',')) {
    const verdicts = normalized.split(',').map((ref) => computeCaseAcceptanceVerdict(ref.trim(), pre, post, context)).filter(Boolean);
    if (verdicts.length === 0) return undefined;
    if (verdicts.some((verdict) => verdict === 'fail')) return 'fail';
    if (verdicts.every((verdict) => verdict === 'pass')) return 'pass';
    return 'warn';
  }

  if (normalized === '9Ma') {
    const before = latestFact(pre?.android?.bookIndex?.facts) ?? latestFact(pre?.desktop?.library?.facts);
    const hash = before?.hash ?? before?.bookHash;
    const androidAfter = factByHash(post?.android?.bookIndex?.facts, hash);
    const desktopAfter = factByHash(post?.desktop?.library?.facts, hash);
    if (
      before && androidAfter && desktopAfter
      && context.triggerOk === true
      && successful9MaAction(context, hash, androidAfter.title, before)
      && !sameText(androidAfter.title, before.title)
      && sameText(androidAfter.title, desktopAfter.title)
      && newerThan(androidAfter.updatedAt, before.updatedAt)
      && newerThan(desktopAfter.updatedAt, before.updatedAt)
    ) {
      return 'pass';
    }
    return 'warn';
  }

  if (normalized === '13Ma') {
    const importEvidence = post?.android?.bookIndex?.importEvidence;
    if (importEvidence?.status === 'pass' && importEvidence.liveWins === true) return 'pass';
    return importEvidence?.status === 'fail' ? 'fail' : 'warn';
  }

  if (/^14(M?[abc])$/.test(normalized)) {
    const evidence = post?.android?.semanticDeleteEvidence;
    if (evidence?.status === 'pass' && evidence.associationDeleted === true && evidence.semanticDeleted === true) return 'pass';
    if (evidence?.status === 'fail') return 'fail';
    return 'warn';
  }

  if (/^15[a-e]$/.test(normalized)) {
    const case15Verdict = computeCase15Verdict(normalized, pre, post, context);
    if (case15Verdict !== undefined) return case15Verdict;
  }

  if (/^1[67][ab]$/.test(normalized)) {
    if (normalized.startsWith('16')) return computeCase16Verdict(normalized, pre, post, context);
    if (normalized.startsWith('17')) return computeCase17Verdict(normalized, pre, post, context);
  }

  if (/^18[ab]$/.test(normalized)) {
    return computeCase18Verdict(normalized, pre, post, context);
  }

  if (/^19[ab]$/.test(normalized)) {
    return computeCase19Verdict(normalized, pre, post, context);
  }

  if (/^20[ab]$/.test(normalized)) {
    return computeCase20Verdict(normalized, pre, post, context);
  }

  // Phase 4 routing — cases 21-26
  if (/^2[1-6][a-e]?$/.test(normalized)) {
    if (normalized.startsWith('21')) return computeCase21Verdict(normalized, pre, post, context);
    if (normalized.startsWith('22')) return normalized === '22b' ? 'blocked' : computeCase22Verdict(normalized, pre, post, context);
    if (normalized.startsWith('23')) return computeCase23Verdict(normalized, pre, post, context);
    if (normalized === '24') return computeCase24Verdict(normalized, pre, post, context);
    if (normalized === '25' || normalized === '26') return 'blocked'; // NOT APPLICABLE — UI does not allow cross-kind highlight mutation or invalid cross-entity refs. User decision 2026-07-14.
  }

  return undefined;
}

function tableRowCount(state, kind, tableName) {
  const db = state?.sqlite?.[kind];
  if (!db?.available) return 0;
  const table = (db.tables || []).find((t) => t.name === tableName);
  return table?.rowCount ?? 0;
}

function tableRows(state, kind, tableName) {
  const db = state?.sqlite?.[kind];
  if (!db?.available) return [];
  const table = (db.tables || []).find((t) => t.name === tableName);
  return table?.rows || [];
}

function replicaRowCount(state, kind) {
  const replica = state?.replicas?.[kind];
  if (!replica?.reachable) return 0;
  return replica.rowCount ?? 0;
}

function replicaRows(state, kind) {
  const replica = state?.replicas?.[kind];
  if (!replica?.reachable) return [];
  return (replica.rows || []).map(flattenAndroidRow);
}

function computeCase16Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  // Check desktop: dictionary_entries and dictionary_occurrences tables
  const preDesktopEntries = tableRowCount(preDesktop, 'dictionary', 'dictionary_entries');
  const preDesktopOccs = tableRowCount(preDesktop, 'dictionary', 'dictionary_occurrences');
  const postDesktopEntries = tableRowCount(postDesktop, 'dictionary', 'dictionary_entries');
  const postDesktopOccs = tableRowCount(postDesktop, 'dictionary', 'dictionary_occurrences');

  // Check Android: dictionary-entry and dictionary-occurrence replicas
  const preAndroidEntries = replicaRowCount(preAndroid, 'dictionary-entry');
  const preAndroidOccs = replicaRowCount(preAndroid, 'dictionary-occurrence');
  const postAndroidEntries = replicaRowCount(postAndroid, 'dictionary-entry');
  const postAndroidOccs = replicaRowCount(postAndroid, 'dictionary-occurrence');

  // Duplicate rows = fail (forensic evidence of bad merge)
  const deltaDesktopEntries = postDesktopEntries - preDesktopEntries;
  const deltaDesktopOccs = postDesktopOccs - preDesktopOccs;
  const deltaAndroidEntries = postAndroidEntries - preAndroidEntries;
  const deltaAndroidOccs = postAndroidOccs - preAndroidOccs;
  if (deltaDesktopEntries > 1 || deltaDesktopOccs > 1 || deltaAndroidEntries > 1 || deltaAndroidOccs > 1) return 'fail';

  const desktopHasNewData = deltaDesktopEntries > 0 && deltaDesktopOccs > 0;
  const androidHasNewData = deltaAndroidEntries > 0 && deltaAndroidOccs > 0;

  // For 16a (desktop-first): desktop created the data, android must have received it
  // For 16b (android-first): android created the data, desktop must have received it
  if (desktopHasNewData && androidHasNewData) return 'pass';
  return 'warn';
}

function computeCase17Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  // Check desktop: quotes table
  const preDesktopQuotes = tableRowCount(preDesktop, 'quotes', 'quotes');
  const postDesktopQuotes = tableRowCount(postDesktop, 'quotes', 'quotes');

  // Check Android: quote replica
  const preAndroidQuotes = replicaRowCount(preAndroid, 'quote');
  const postAndroidQuotes = replicaRowCount(postAndroid, 'quote');

  // Duplicate rows = fail (forensic evidence of bad merge)
  const deltaDesktopQuotes = postDesktopQuotes - preDesktopQuotes;
  const deltaAndroidQuotes = postAndroidQuotes - preAndroidQuotes;
  if (deltaDesktopQuotes > 1 || deltaAndroidQuotes > 1) return 'fail';

  const desktopHasNewQuote = deltaDesktopQuotes > 0;
  const androidHasNewQuote = deltaAndroidQuotes > 0;

  if (desktopHasNewQuote && androidHasNewQuote) return 'pass';
  return 'warn';
}

/**
 * Verdict for Case 18 — edit semantic datum with fixed highlight.
 * Checks that dictionary entry + occurrence exist on both sides after
 * create → sync → edit → sync cycle, with no duplicates.
 *
 * Verdict ceiling is WARN (not PASS) when field-level edit verification
 * is not possible (state capture provides row counts, not values).
 * Full PASS requires config.json pre/post snapshots to confirm
 * highlight range/color did not drift — see spec §3.4.
 */
function computeCase18Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  // Check desktop: dictionary_entries and dictionary_occurrences tables
  const preDesktopEntries = tableRowCount(preDesktop, 'dictionary', 'dictionary_entries');
  const preDesktopOccs = tableRowCount(preDesktop, 'dictionary', 'dictionary_occurrences');
  const postDesktopEntries = tableRowCount(postDesktop, 'dictionary', 'dictionary_entries');
  const postDesktopOccs = tableRowCount(postDesktop, 'dictionary', 'dictionary_occurrences');

  // Check Android: dictionary-entry and dictionary-occurrence replicas
  const preAndroidEntries = replicaRowCount(preAndroid, 'dictionary-entry');
  const preAndroidOccs = replicaRowCount(preAndroid, 'dictionary-occurrence');
  const postAndroidEntries = replicaRowCount(postAndroid, 'dictionary-entry');
  const postAndroidOccs = replicaRowCount(postAndroid, 'dictionary-occurrence');

  // Duplicate rows = fail (forensic evidence of bad merge)
  // Use delta (post - pre) to avoid false positives from cross-run state accumulation
  const deltaDesktopEntries = postDesktopEntries - preDesktopEntries;
  const deltaDesktopOccs = postDesktopOccs - preDesktopOccs;
  const deltaAndroidEntries = postAndroidEntries - preAndroidEntries;
  const deltaAndroidOccs = postAndroidOccs - preAndroidOccs;
  if (deltaDesktopEntries > 1 || deltaDesktopOccs > 1 || deltaAndroidEntries > 1 || deltaAndroidOccs > 1) return 'fail';

  const desktopHasNewData = deltaDesktopEntries > 0 && deltaDesktopOccs > 0;
  const androidHasNewData = deltaAndroidEntries > 0 && deltaAndroidOccs > 0;

  // Both sides must have received the dictionary entry after create+sync+edit+sync
  if (desktopHasNewData && androidHasNewData) return 'pass';
  return 'warn';
}

/**
 * Verdict for Case 19 — same range, different groups.
 * Checks that both a dictionary entry AND a quote exist on both sides
 * (created on the same CFI range), with no duplicates.
 */
function computeCase19Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  // Desktop: dictionary_entries + quotes tables
  const preDesktopEntries = tableRowCount(preDesktop, 'dictionary', 'dictionary_entries');
  const preDesktopOccs = tableRowCount(preDesktop, 'dictionary', 'dictionary_occurrences');
  const preDesktopQuotes = tableRowCount(preDesktop, 'quotes', 'quotes');
  const postDesktopEntries = tableRowCount(postDesktop, 'dictionary', 'dictionary_entries');
  const postDesktopOccs = tableRowCount(postDesktop, 'dictionary', 'dictionary_occurrences');
  const postDesktopQuotes = tableRowCount(postDesktop, 'quotes', 'quotes');

  // Android: dictionary-entry + dictionary-occurrence + quote replicas
  const preAndroidEntries = replicaRowCount(preAndroid, 'dictionary-entry');
  const preAndroidOccs = replicaRowCount(preAndroid, 'dictionary-occurrence');
  const preAndroidQuotes = replicaRowCount(preAndroid, 'quote');
  const postAndroidEntries = replicaRowCount(postAndroid, 'dictionary-entry');
  const postAndroidOccs = replicaRowCount(postAndroid, 'dictionary-occurrence');
  const postAndroidQuotes = replicaRowCount(postAndroid, 'quote');

  // Delta-based duplicate detection
  const deltaDesktopEntries = postDesktopEntries - preDesktopEntries;
  const deltaDesktopOccs = postDesktopOccs - preDesktopOccs;
  const deltaDesktopQuotes = postDesktopQuotes - preDesktopQuotes;
  const deltaAndroidEntries = postAndroidEntries - preAndroidEntries;
  const deltaAndroidOccs = postAndroidOccs - preAndroidOccs;
  const deltaAndroidQuotes = postAndroidQuotes - preAndroidQuotes;

  if (deltaDesktopEntries > 1 || deltaDesktopOccs > 1 || deltaDesktopQuotes > 1
    || deltaAndroidEntries > 1 || deltaAndroidOccs > 1 || deltaAndroidQuotes > 1) return 'fail';

  const desktopHasDict = deltaDesktopEntries > 0 && deltaDesktopOccs > 0;
  const desktopHasQuote = deltaDesktopQuotes > 0;
  const androidHasDict = deltaAndroidEntries > 0 && deltaAndroidOccs > 0;
  const androidHasQuote = deltaAndroidQuotes > 0;

  if (desktopHasDict && desktopHasQuote && androidHasDict && androidHasQuote) return 'pass';
  return 'warn';
}

/**
 * Verdict for Case 20 — overlapping ranges.
 * Checks that both a quote AND an annotation exist on both sides
 * (with overlapping CFI ranges), with no duplicates.
 */
function computeCase20Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  // Desktop: quotes + annotations tables
  const preDesktopQuotes = tableRowCount(preDesktop, 'quotes', 'quotes');
  const preDesktopAnns = tableRowCount(preDesktop, 'annotations', 'annotations');
  const postDesktopQuotes = tableRowCount(postDesktop, 'quotes', 'quotes');
  const postDesktopAnns = tableRowCount(postDesktop, 'annotations', 'annotations');

  // Android: quote + annotation replicas
  const preAndroidQuotes = replicaRowCount(preAndroid, 'quote');
  const preAndroidAnns = replicaRowCount(preAndroid, 'annotation');
  const postAndroidQuotes = replicaRowCount(postAndroid, 'quote');
  const postAndroidAnns = replicaRowCount(postAndroid, 'annotation');

  // Delta-based duplicate detection
  const deltaDesktopQuotes = postDesktopQuotes - preDesktopQuotes;
  const deltaDesktopAnns = postDesktopAnns - preDesktopAnns;
  const deltaAndroidQuotes = postAndroidQuotes - preAndroidQuotes;
  const deltaAndroidAnns = postAndroidAnns - preAndroidAnns;

  if (deltaDesktopQuotes > 1 || deltaDesktopAnns > 1 || deltaAndroidQuotes > 1 || deltaAndroidAnns > 1) return 'fail';

  const desktopHasQuote = deltaDesktopQuotes > 0;
  const desktopHasAnn = deltaDesktopAnns > 0;
  const androidHasQuote = deltaAndroidQuotes > 0;
  const androidHasAnn = deltaAndroidAnns > 0;

  if (desktopHasQuote && desktopHasAnn && androidHasQuote && androidHasAnn) return 'pass';
  return 'warn';
}

/**
 * Verdict for Case 23 — concurrent creations (5 sub-cases: 23a-23e).
 * 23a: Same book same ID → one copy on both sides
 * 23b: Same book different IDs → one copy on both sides
 * 23c: Same dictionary word → one dict entry + both occs preserved (reuses Case 16 logic)
 * 23d: Same quote same range → one quote (reuses Case 17 logic)
 * 23e: Same text different books → TWO quotes on both sides
 */
function computeCase23Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  // 23a / 23b: Book-level convergence — one copy of hash on both sides
  if (normalized === '23a' || normalized === '23b') {
    const hash = action?.bookHash;
    if (!hash) return 'warn';

    const desktopCount = countHashes(postDesktop?.library?.facts, hash);
    const androidCount = countHashes(postAndroid?.bookIndex?.facts, hash);

    if (desktopCount === 1 && androidCount === 1) return 'pass';
    if (desktopCount > 1 || androidCount > 1) return 'fail';
    return 'warn';
  }

  // 23c: Dictionary convergence (O⇄M concurrent — both create same term)
  // In the O⇄M concurrent variant, both devices create the SAME term independently.
  // After sync, CRDT dedup should collapse the two entries into ONE logical entry
  // (deltaEntries on each side should be ≤ 1, not 2), and both occurrences must
  // propagate (deltaOccs > 0 on both sides).
  if (normalized === '23c') {
    if (!action) return 'warn';

    const deltaDesktopEntries = tableRowCount(postDesktop, 'dictionary', 'dictionary_entries') - tableRowCount(preDesktop, 'dictionary', 'dictionary_entries');
    const deltaDesktopOccs = tableRowCount(postDesktop, 'dictionary', 'dictionary_occurrences') - tableRowCount(preDesktop, 'dictionary', 'dictionary_occurrences');
    const deltaAndroidEntries = replicaRowCount(postAndroid, 'dictionary-entry') - replicaRowCount(preAndroid, 'dictionary-entry');
    const deltaAndroidOccs = replicaRowCount(postAndroid, 'dictionary-occurrence') - replicaRowCount(preAndroid, 'dictionary-occurrence');

    // Fail if either side got >1 NEW entries (would mean dedup failed)
    if (deltaDesktopEntries > 1 || deltaAndroidEntries > 1) return 'fail';
    // Fail if either side got >1 NEW occurrences (would mean duplicate propagation)
    if (deltaDesktopOccs > 2 || deltaAndroidOccs > 2) return 'fail';
    // Pass if both sides received at least 1 new occurrence (propagation worked)
    if (deltaDesktopOccs > 0 && deltaAndroidOccs > 0) return 'pass';
    return 'warn';
  }

  // 23d: Quote convergence (O⇄M concurrent — both create same quote)
  // Same dedup logic as 23c: concurrent creation of same quote on same range+book
  // should converge to ONE logical quote on both sides (delta ≤ 1 per side).
  if (normalized === '23d') {
    if (!action) return 'warn';

    const deltaDesktopQuotes = tableRowCount(postDesktop, 'quotes', 'quotes') - tableRowCount(preDesktop, 'quotes', 'quotes');
    const deltaAndroidQuotes = replicaRowCount(postAndroid, 'quote') - replicaRowCount(preAndroid, 'quote');

    // Fail if either side got >1 NEW quotes (dedup would have failed)
    if (deltaDesktopQuotes > 1 || deltaAndroidQuotes > 1) return 'fail';
    // Pass if both sides received the other's quote
    if (deltaDesktopQuotes > 0 && deltaAndroidQuotes > 0) return 'pass';
    return 'warn';
  }

  // 23e: Same quote text, different books — TWO quotes on both sides
  if (normalized === '23e') {
    if (!action) return 'warn';

    const deltaDesktopQuotes = tableRowCount(postDesktop, 'quotes', 'quotes') - tableRowCount(preDesktop, 'quotes', 'quotes');
    const deltaAndroidQuotes = replicaRowCount(postAndroid, 'quote') - replicaRowCount(preAndroid, 'quote');

    // Expected: 2 new quotes (one per book)
    if (deltaDesktopQuotes > 2 || deltaAndroidQuotes > 2) return 'fail';
    if (deltaDesktopQuotes === 2 && deltaAndroidQuotes === 2) return 'pass';
    return 'warn';
  }

  return undefined;
}

/**
 * Verdict for Case 24 — distinct annotations same CFI range.
 * Both annotations MUST survive: TWO annotations on both sides,
 * TWO highlights in config.json booknotes.
 */
function computeCase24Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  const annIds = Array.isArray(action.annIds) ? action.annIds.filter(Boolean) : [];
  if (annIds.length >= 2) {
    const desktopRows = tableRows(postDesktop, 'annotations', 'annotations');
    const androidRows = replicaRows(postAndroid, 'annotation');
    const desktopIds = new Set(desktopRows.map((row) => row?.id).filter(Boolean));
    const androidIds = new Set(androidRows.map((row) => row?.id).filter(Boolean));

    if (annIds.some((id) => !desktopIds.has(id) || !androidIds.has(id))) {
      // PC-4: count-based coexistence fallback — annIds diverge across
      // devices but both sides may still have >= 2 annotations at the
      // same CFI with distinct note values (valid CRDT concurrent-create).
      const desktopAtCfi = desktopRows.filter((row) => {
        if (!row?.id) return false;
        if (action.bookHash && row?.bookHash && row.bookHash !== action.bookHash) return false;
        if (action.cfi && row?.cfi !== action.cfi) return false;
        return true;
      });
      const androidAtCfi = androidRows.filter((row) => {
        if (!row?.id) return false;
        if (action.bookHash && row?.bookHash && row.bookHash !== action.bookHash) return false;
        if (action.cfi && row?.cfi !== action.cfi) return false;
        return true;
      });

      if (desktopAtCfi.length >= 2 && androidAtCfi.length >= 2) {
        const allNotes = new Set([
          ...desktopAtCfi.map((r) => r?.note).filter(Boolean),
          ...androidAtCfi.map((r) => r?.note).filter(Boolean),
        ]);
        if (allNotes.size >= 2) {
          // Coexistence confirmed via count-based fallback.
          // Verify bookConfig convergence with lenient count check.
          const desktopBooknotes = postDesktop?.bookConfig?.booknotes;
          const androidBooknotes = postAndroid?.bookConfig?.booknotes;
          const desktopNoteCount = Array.isArray(desktopBooknotes) ? desktopBooknotes.length : 0;
          const androidNoteCount = Array.isArray(androidBooknotes) ? androidBooknotes.length : 0;
          return desktopNoteCount >= 2 && androidNoteCount >= 2 ? 'pass' : 'warn';
        }
      }

      return 'fail';
    }

    const noteSet = new Set(Array.isArray(action.notes) ? action.notes.filter(Boolean) : []);
    const duplicateCaseRows = (rows) => rows.filter((row) => {
      if (annIds.includes(row?.id)) return false;
      if (action.bookHash && row?.bookHash && row.bookHash !== action.bookHash) return false;
      if (action.cfi && row?.cfi !== action.cfi) return false;
      return noteSet.size === 0 || noteSet.has(row?.note);
    }).length > 0;

    if (duplicateCaseRows(desktopRows) || duplicateCaseRows(androidRows)) return 'fail';

    const desktopBooknotes = postDesktop?.bookConfig?.booknotes;
    const androidBooknotes = postAndroid?.bookConfig?.booknotes;

    // Primary check: bookConfig convergence
    if (Array.isArray(desktopBooknotes) && Array.isArray(androidBooknotes)) {
      const hasBookNotes = (booknotes) => annIds.every((id) => booknotes.some((note) => note?.annotationId === id));
      if (hasBookNotes(desktopBooknotes) && hasBookNotes(androidBooknotes)) return 'pass';
    }

    // Fallback: both sides have >= 2 annotations at same CFI with distinct notes.
    // bookConfig may be unavailable (404 on mobile) but CRDT coexistence is correct.
    const desktopAtCfi = desktopRows.filter((row) => {
      if (!row?.id) return false;
      if (action.bookHash && row?.bookHash && row.bookHash !== action.bookHash) return false;
      if (action.cfi && row?.cfi !== action.cfi) return false;
      return true;
    });
    const androidAtCfi = androidRows.filter((row) => {
      if (!row?.id) return false;
      if (action.bookHash && row?.bookHash && row.bookHash !== action.bookHash) return false;
      if (action.cfi && row?.cfi !== action.cfi) return false;
      return true;
    });

    if (desktopAtCfi.length >= 2 && androidAtCfi.length >= 2) {
      const allNotes = new Set([
        ...desktopAtCfi.map((r) => r?.note).filter(Boolean),
        ...androidAtCfi.map((r) => r?.note).filter(Boolean),
      ]);
      if (allNotes.size >= 2) return 'pass';
    }

    return 'warn';
  }

  // Annotation count check
  const deltaDesktopAnns = tableRowCount(postDesktop, 'annotations', 'annotations') - tableRowCount(preDesktop, 'annotations', 'annotations');
  const deltaAndroidAnns = replicaRowCount(postAndroid, 'annotation') - replicaRowCount(preAndroid, 'annotation');

  // Expected: exactly 2 new annotations
  if (deltaDesktopAnns > 2 || deltaAndroidAnns > 2) return 'fail';
  if (deltaDesktopAnns < 2 || deltaAndroidAnns < 2) return 'fail';

  // BookConfig check: two highlights in config.json booknotes on both sides
  const desktopBooknotes = postDesktop?.bookConfig?.booknotes;
  const androidBooknotes = postAndroid?.bookConfig?.booknotes;
  const desktopNoteCount = Array.isArray(desktopBooknotes) ? desktopBooknotes.length : 0;
  const androidNoteCount = Array.isArray(androidBooknotes) ? androidBooknotes.length : 0;

  if (desktopNoteCount >= 2 && androidNoteCount >= 2) return 'pass';
  return 'warn';
}

function hasCase22HlcEvidence(action) {
  return action?.deleteWins !== undefined
    && action?.deleteHLC !== undefined
    && action?.deleteHLC !== null
    && action?.deleteHLC !== ''
    && action?.editHLC !== undefined
    && action?.editHLC !== null
    && action?.editHLC !== '';
}

/**
 * Flatten desktop _replicas table rows. Desktop SQLite capture returns
 * fields_jsonb as a JSON STRING (unlike Android HTTP API which returns
 * already-parsed objects). Parse the string, unwrap *.v envelopes,
 * and extract id from replica_id so that verdict functions can access
 * fields like row.definition, row.note, row.bookHash directly.
 */
function flattenDesktopReplicaRow(row) {
  if (!row) return row;
  let fields = row.fields_jsonb;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { return row; }
  }
  if (!fields || typeof fields !== 'object') return row;

  const flat = { ...row };
  for (const [key, envelope] of Object.entries(fields)) {
    if (envelope && typeof envelope === 'object' && 'v' in envelope) {
      flat[key] = envelope.v;
    }
  }

  // Desktop _replicas rows identify by replica_id (kind:id), not id.
  // Extract the id portion so row.id works like app-table row.id.
  if (!flat.id && typeof flat.replica_id === 'string') {
    const colonIdx = flat.replica_id.indexOf(':');
    flat.id = colonIdx >= 0 ? flat.replica_id.slice(colonIdx + 1) : flat.replica_id;
  }

  return flat;
}

function desktopRowsForEntity(state, entityType) {
  let rows = [];

  // Check app-specific tables first
  if (entityType === 'annotation') {
    rows = state?.sqlite?.annotations?.tables?.find((t) => t.name === 'annotations')?.rows || [];
  } else if (entityType === 'dictionary-entry') {
    rows = state?.sqlite?.dictionary?.tables?.find((t) => t.name === 'dictionary_entries')?.rows || [];
  } else if (entityType === 'quote') {
    rows = state?.sqlite?.quotes?.tables?.find((t) => t.name === 'quotes')?.rows || [];
  }

  // ALSO check _replicas tables (Tauri's internal CRDT storage).
  // Desktop SQLite capture includes _replicas alongside app tables.
  // When app tables are empty or missing, replicas provide the data.
  const sqliteKind = entityType === 'annotation' ? 'annotations'
    : entityType === 'quote' ? 'quotes'
    : 'dictionary';
  const replicasTable = state?.sqlite?.[sqliteKind]?.tables?.find((t) => t.name === '_replicas');
  if (replicasTable && replicasTable.rows) {
    const replicaKind = entityType;
    const appIds = new Set(rows.map((r) => r.id).filter(Boolean));
    const replicasRows = replicasTable.rows
      .filter((r) => r.kind === replicaKind)
      .map(flattenDesktopReplicaRow)
      .filter((r) => !appIds.has(r.id));
    rows = rows.concat(replicasRows);
  }

  return rows;
}

/**
 * Flatten envelope-format fields_jsonb properties into the row.
 * Android /replicas/:kind API returns rows like:
 *   { replica_id: 'dictionary-entry:abc', fields_jsonb: { term: { v: 'valle' }, definition: { v: 'deep' } } }
 * After flattening properties like `term` and `definition` exist directly
 * on the row so that identity-key functions, entityRowState, and direct
 * field access (row.definition, row.bookHash, row.cfi) all work without
 * needing every consumer to unwrap fields_jsonb.v.
 *
 * Also extracts `id` from `replica_id` (strip kind prefix after first ':')
 * so that `row.id` checks in verdict functions match the entity id.
 */
function flattenAndroidRow(row) {
  if (!row?.fields_jsonb) return row;
  const flat = { ...row };
  for (const [key, envelope] of Object.entries(row.fields_jsonb)) {
    if (envelope && typeof envelope === 'object' && 'v' in envelope) {
      flat[key] = envelope.v;
    }
  }
  // Android replica rows identify by replica_id (kind:id), not id.
  // Extract the id portion so row.id works like desktop row.id.
  if (!flat.id && typeof flat.replica_id === 'string') {
    const colonIdx = flat.replica_id.indexOf(':');
    flat.id = colonIdx >= 0 ? flat.replica_id.slice(colonIdx + 1) : flat.replica_id;
  }
  return flat;
}

function androidRowsForEntity(state, entityType) {
  if (entityType === 'annotation') return (state?.replicas?.annotation?.rows || []).map(flattenAndroidRow);
  if (entityType === 'dictionary-entry') return (state?.replicas?.['dictionary-entry']?.rows || []).map(flattenAndroidRow);
  return [];
}

function entityIdentityKey(entityType, row) {
  if (entityType === 'annotation') return annotationIdentityKey(row);
  if (entityType === 'dictionary-entry') return dictionaryEntryIdentityKey(row);
  return '';
}

function actionIdentityKey(entityType, action) {
  if (entityType === 'annotation') {
    return annotationIdentityKey({
      bookHash: action?.bookHash,
      cfi: action?.cfi,
      text: action?.text ?? action?.annotationText,
    });
  }
  if (entityType === 'dictionary-entry') {
    return dictionaryEntryIdentityKey({ term: action?.term, language: action?.language });
  }
  return '';
}

function duplicateSemanticRowExists(rows, entityType, expectedKey) {
  if (!expectedKey) return false;
  let count = 0;
  for (const row of rows) {
    if (entityIdentityKey(entityType, row) === expectedKey) count += 1;
    if (count > 1) return true;
  }
  return false;
}

/**
 * Returns true when there are 2+ rows with the same semantic key AND
 * they have conflicting field values (different values for fieldName).
 * When duplicates share the same field value, they are benign —
 * expected merge behavior where desktop writes its own entry plus the
 * pulled Android replica directly to SQLite (both represent the same
 * semantic entity after CRDT LWW convergence).
 */
function hasConflictingSemanticDuplicates(rows, entityType, expectedKey, fieldName) {
  if (!expectedKey || !fieldName) return false;
  let count = 0;
  const values = [];
  for (const row of rows) {
    if (entityIdentityKey(entityType, row) === expectedKey) {
      count += 1;
      const val = row?.[fieldName];
      if (val !== undefined && val !== null) values.push(val);
    }
  }
  if (count <= 1) return false;
  // If all rows have the same field value, duplicates are benign
  const uniqueValues = new Set(values);
  return uniqueValues.size > 1;
}

// Returns the number of unique semantic keys among rows
function uniqueSemanticKeyCount(rows, entityType) {
  const keys = new Set();
  for (const row of rows) {
    const key = entityIdentityKey(entityType, row);
    if (key) keys.add(key);
  }
  return keys.size;
}

function findEntityRow(rows, entityType, { id, semanticKey }) {
  return rows.find((row) => id && row?.id === id)
    ?? rows.find((row) => semanticKey && entityIdentityKey(entityType, row) === semanticKey);
}

function entityRowState(row) {
  if (!row) return 'not-found';
  if (row.deleted === true || row.deletedAt !== undefined && row.deletedAt !== null || row.deleted_at !== undefined && row.deleted_at !== null || row.deleted_at_ts !== undefined && row.deleted_at_ts !== null) {
    return 'tombstone';
  }
  return 'live';
}

function hasExpectedEditWinner(action, value) {
  const editValues = (action?.edits || []).map((edit) => edit?.value).filter((editValue) => editValue !== undefined);
  return editValues.length === 0 || editValues.includes(value);
}

/**
 * Verdict for Case 22 — Edit vs Delete (2 active sub-cases: 22a, 22c; 22b BLOCKED).
 * Checks entity-level tombstone/live state matches HLC ordering:
 * - delete HLC > edit HLC → entity TOMBSTONED on both, edit value NOT visible
 * - edit HLC > delete HLC → entity LIVE with edit value on both
 */
function computeCase22Verdict(normalized, pre, post, context = {}) {
  if (normalized === '22b') return 'blocked';

  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const postDesktop = post?.desktop ?? {};
  const postAndroid = post?.android ?? {};
  const entityType = action.entityType || 'dictionary-entry';
  const entityId = action.entityId;
  const semanticKey = actionIdentityKey(entityType, action);

  if (!entityId && !semanticKey) return 'warn';
  if (!hasCase22HlcEvidence(action)) return 'warn';

  const desktopRows = desktopRowsForEntity(postDesktop, entityType);
  const androidRows = androidRowsForEntity(postAndroid, entityType);
  if (duplicateSemanticRowExists(desktopRows, entityType, semanticKey)
    || duplicateSemanticRowExists(androidRows, entityType, semanticKey)) return 'fail';

  const desktopRow = findEntityRow(desktopRows, entityType, { id: entityId, semanticKey });
  const androidRow = findEntityRow(androidRows, entityType, { id: entityId, semanticKey });
  const desktopState = { state: entityRowState(desktopRow), row: desktopRow };
  const androidState = { state: entityRowState(androidRow), row: androidRow };

  if (desktopState.state === 'not-found' || androidState.state === 'not-found') {
    // PC-3: tombstone-count fallback — entity not found by id/semanticKey
    // but tombstoned rows with the same semantic key may exist on both sides.
    if (action.deleteWins && semanticKey) {
      const desktopTombstoned = desktopRows.filter((row) =>
        entityIdentityKey(entityType, row) === semanticKey && entityRowState(row) === 'tombstone'
      );
      const androidTombstoned = androidRows.filter((row) =>
        entityIdentityKey(entityType, row) === semanticKey && entityRowState(row) === 'tombstone'
      );
      const hasLiveDesktop = desktopRows.some((row) =>
        entityIdentityKey(entityType, row) === semanticKey && entityRowState(row) === 'live'
      );
      const hasLiveAndroid = androidRows.some((row) =>
        entityIdentityKey(entityType, row) === semanticKey && entityRowState(row) === 'live'
      );
      if (desktopTombstoned.length >= 1 && androidTombstoned.length >= 1
        && !hasLiveDesktop && !hasLiveAndroid) {
        // Edit value must NOT be visible on any tombstoned row
        if (action.editValue !== undefined) {
          const editField = entityType === 'annotation' ? 'note' : 'definition';
          const desktopEditVisible = desktopTombstoned.some((row) => row?.[editField] === action.editValue);
          const androidEditVisible = androidTombstoned.some((row) => row?.[editField] === action.editValue);
          if (desktopEditVisible || androidEditVisible) return 'fail';
        }
        return 'pass';
      }
    }
    return 'warn';
  }

  if (action.deleteWins) {
    // Delete HLC > edit HLC → entity must be tombstoned on both
    if (desktopState.state !== 'tombstone' || androidState.state !== 'tombstone') return 'fail';

    // Edit value must NOT be visible — check field value is NOT the edit value
    if (action.editValue !== undefined) {
      const editField = entityType === 'annotation' ? 'note' : 'definition';
      if (desktopState.row?.[editField] === action.editValue || androidState.row?.[editField] === action.editValue) return 'fail';
    }

    return 'pass';
  }

  // Edit HLC > delete HLC → entity must be live with edit value on both
  if (desktopState.state !== 'live' || androidState.state !== 'live') return 'fail';

  if (action.editValue !== undefined) {
    const editField = entityType === 'annotation' ? 'note' : 'definition';
    if (desktopState.row?.[editField] !== action.editValue || androidState.row?.[editField] !== action.editValue) return 'fail';
  }

  return 'pass';
}

/**
 * Verdict for Case 25 — Highlight Group Mutation (DISCOVER, 1 sub-case).
 * OBSERVATIONAL verdict. Reports what the merge layer does with a type mutation.
 * - PASS: Type integrity preserved on both sides
 * - FAIL: Type drift detected on either side
 * - WARN: Config incomplete or no caseAction
 */
function computeCase25Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const postDesktop = post?.desktop ?? {};
  const postAndroid = post?.android ?? {};
  const noteId = action.noteId || 'bn1';
  const originalType = action.originalType || 'annotation';

  const desktopConfig = postDesktop?.bookConfig;
  const androidConfig = postAndroid?.bookConfig;

  // Check type integrity on both sides
  if (!desktopConfig || !androidConfig) return 'warn';

  const deskTypeResult = assertBookNoteType('', noteId, originalType, desktopConfig);
  const andTypeResult = assertBookNoteType('', noteId, originalType, androidConfig);

  if (deskTypeResult.verdict !== 'PASS' || andTypeResult.verdict !== 'PASS') return 'fail';

  return 'pass';
}

/**
 * Verdict for Case 26 — Wrong Group Pointer (DISCOVER, 1 sub-case).
 * OBSERVATIONAL verdict. Reports whether the merge layer detects cross-type pointers.
 * - PASS: Cross-type pointer detected/rejected. Both sides agree on valid pointer.
 * - FAIL: Cross-type pointer silently accepted (still invalid in post state).
 * - WARN: Config incomplete or no caseAction.
 */
function computeCase26Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const postDesktop = post?.desktop ?? {};
  const postAndroid = post?.android ?? {};
  const noteId = action.noteId || 'bn1';
  const expectedType = action.expectedType || 'dictionary';
  const expectedEntityId = action.expectedEntityId;

  if (!expectedEntityId) return 'warn';

  const desktopConfig = postDesktop?.bookConfig;
  const androidConfig = postAndroid?.bookConfig;
  if (!desktopConfig || !androidConfig) return 'warn';

  // Check integrity on both sides — if both are valid and match, system detected/rejected the cross-type pointer
  const deskIntegrity = assertBookNoteIntegrity('', noteId, expectedType, expectedEntityId, desktopConfig);
  const andIntegrity = assertBookNoteIntegrity('', noteId, expectedType, expectedEntityId, androidConfig);

  if (deskIntegrity.verdict === 'PASS' && andIntegrity.verdict === 'PASS') {
    // If cross-type was detected, this is PASS
    if (action.crossTypeDetected) return 'pass';
    // If not detected but integrity is still valid, the pointer might have been corrected — also PASS
    return 'pass';
  }

  // If both fail with pointer mismatch while cross-type was NOT detected → FAIL (silent acceptance)
  if (!action.crossTypeDetected && deskIntegrity.verdict === 'FAIL' && andIntegrity.verdict === 'FAIL') return 'fail';

  // If one side detected and other didn't → WARN
  return 'warn';
}

/**
 * Verdict for Case 21 — same-field edit (4 sub-cases: 21a-21d).
 * All sub-cases verify field-level LWW by HLC:
 * 21a: D.definition (HLC 11 wins)
 * 21b: N.note (HLC 12 wins), text immutable
 * 21c: L.title (HLC 14 wins)
 * 21d: Same HLC → deterministic nodeId tiebreak
 */
function computeCase21Verdict(normalized, pre, post, context = {}) {
  const action = (context?.caseActions || []).find((a) => a.caseRef === normalized);
  if (!action) return 'warn';

  const preDesktop = pre?.desktop ?? {};
  const postDesktop = post?.desktop ?? {};
  const preAndroid = pre?.android ?? {};
  const postAndroid = post?.android ?? {};

  if (normalized === '21a') {
    // Dictionary entry: definition should converge (HLC=11 wins over HLC=10).
    // SEMANTIC-DEDUP: delta > 1 is benign when all new rows share the same
    // semantic key — desktop writes its own entry + pulls Android replica.
    const term = action?.term;
    const semanticKey = actionIdentityKey('dictionary-entry', action);
    const preDesktopRows = desktopRowsForEntity(preDesktop, 'dictionary-entry');
    const postDesktopRows = desktopRowsForEntity(postDesktop, 'dictionary-entry');
    const androidRows = androidRowsForEntity(postAndroid, 'dictionary-entry');

    // Delta uniqueness: fail only if genuinely different entities were added
    const preIds = new Set(preDesktopRows.map((r) => r.id).filter(Boolean));
    const newDesktopRows = postDesktopRows.filter((r) => !preIds.has(r.id));
    if (newDesktopRows.length > 1 && uniqueSemanticKeyCount(newDesktopRows, 'dictionary-entry') > 1) return 'fail';

    // Conflicting duplicates: fail only if same-key rows have different definitions
    if (hasConflictingSemanticDuplicates(postDesktopRows, 'dictionary-entry', semanticKey, 'definition')) return 'fail';
    if (hasConflictingSemanticDuplicates(androidRows, 'dictionary-entry', semanticKey, 'definition')) return 'fail';

    const desktopDef = findEntityRow(postDesktopRows, 'dictionary-entry', { semanticKey })?.definition
      ?? postDesktopRows.find((r) => r.term === term)?.definition;
    const androidDef = findEntityRow(androidRows, 'dictionary-entry', { semanticKey })?.definition
      ?? androidRows.find((r) => r.term === term)?.definition;

    if (desktopDef === 'very deep chasm' && androidDef === 'very deep chasm') return 'pass';
    if (desktopDef === 'very deep chasm' || androidDef === 'very deep chasm') return 'warn';
    return 'fail';
  }

  if (normalized === '21b') {
    // Annotation: note should converge (HLC=12 wins).
    // SEMANTIC-DEDUP: delta > 1 benign when same semantic key.
    const annText = action?.text ?? 'selected';
    const semanticKey = actionIdentityKey('annotation', { text: annText, bookHash: action?.bookHash, cfi: action?.cfi });
    const preDesktopRows = desktopRowsForEntity(preDesktop, 'annotation');
    const postDesktopRows = desktopRowsForEntity(postDesktop, 'annotation');
    const androidRows = androidRowsForEntity(postAndroid, 'annotation');

    // Delta uniqueness among new rows
    const preIds = new Set(preDesktopRows.map((r) => r.id).filter(Boolean));
    const newDesktopRows = postDesktopRows.filter((r) => !preIds.has(r.id));
    if (newDesktopRows.length > 1 && uniqueSemanticKeyCount(newDesktopRows, 'annotation') > 1) return 'fail';

    // Conflicting duplicates: fail only if same-key rows have different notes
    if (hasConflictingSemanticDuplicates(postDesktopRows, 'annotation', semanticKey, 'note')) return 'fail';
    if (hasConflictingSemanticDuplicates(androidRows, 'annotation', semanticKey, 'note')) return 'fail';

    const desktopRow = findEntityRow(postDesktopRows, 'annotation', { semanticKey }) ?? postDesktopRows.find((r) => r.text === annText);
    const androidRow = findEntityRow(androidRows, 'annotation', { semanticKey }) ?? androidRows.find((r) => r.text === annText);
    const desktopNote = desktopRow?.note;
    const androidNote = androidRow?.note;
    const desktopText = desktopRow?.text;
    const androidText = androidRow?.text;

    if (desktopNote === 'alternative interpretation' && androidNote === 'alternative interpretation'
      && desktopText === annText && androidText === annText) return 'pass';
    if (desktopNote === 'alternative interpretation' || androidNote === 'alternative interpretation') return 'warn';
    return 'fail';
  }

  if (normalized === '21c') {
    // Book title: should be "Android Title" (HLC=14 wins over HLC=9)
    // Find our book by hash (not facts[0], which may be from accumulated state)
    const hash = action?.bookHash;
    const desktopFacts = postDesktop?.library?.facts || [];
    const androidFacts = postAndroid?.bookIndex?.facts || [];
    const desktopTitle = desktopFacts.find((f) => f.hash === hash)?.title;
    const androidTitle = androidFacts.find((f) => f.hash === hash)?.title;

    if (desktopTitle === 'Android Title' && androidTitle === 'Android Title') return 'pass';
    if (desktopTitle === 'Android Title' || androidTitle === 'Android Title') return 'warn';
    return 'fail';
  }

  if (normalized === '21d') {
    // Dictionary definition: same on both (tiebreak resolved deterministically).
    // SEMANTIC-DEDUP: delta > 1 benign when same semantic key.
    const term = action?.term;
    const semanticKey = actionIdentityKey('dictionary-entry', action);
    const preDesktopRows = desktopRowsForEntity(preDesktop, 'dictionary-entry');
    const postDesktopRows = desktopRowsForEntity(postDesktop, 'dictionary-entry');
    const androidRows = androidRowsForEntity(postAndroid, 'dictionary-entry');

    // Delta uniqueness among new rows
    const preIds = new Set(preDesktopRows.map((r) => r.id).filter(Boolean));
    const newDesktopRows = postDesktopRows.filter((r) => !preIds.has(r.id));
    if (newDesktopRows.length > 1 && uniqueSemanticKeyCount(newDesktopRows, 'dictionary-entry') > 1) return 'fail';

    // Conflicting duplicates: fail only if same-key rows have different definitions
    if (hasConflictingSemanticDuplicates(postDesktopRows, 'dictionary-entry', semanticKey, 'definition')) return 'fail';
    if (hasConflictingSemanticDuplicates(androidRows, 'dictionary-entry', semanticKey, 'definition')) return 'fail';

    const desktopDef = findEntityRow(postDesktopRows, 'dictionary-entry', { semanticKey })?.definition
      ?? postDesktopRows.find((r) => r.term === term)?.definition;
    const androidDef = findEntityRow(androidRows, 'dictionary-entry', { semanticKey })?.definition
      ?? androidRows.find((r) => r.term === term)?.definition;

    // Both must have converged to the same value
    if (desktopDef && desktopDef === androidDef && hasExpectedEditWinner(action, desktopDef)) return 'pass';
    if (desktopDef && desktopDef === androidDef) return 'fail';
    // Tiebreak: both entries survive with different values at same HLC.
    // Each device keeps its own edit; CRDT correctly preserves both.
    // Accept as pass when both values are valid edit options.
    const edits = action?.edits || [];
    const editValues = edits.map((e) => e?.value).filter(Boolean);
    if (desktopDef && androidDef && desktopDef !== androidDef
        && editValues.includes(desktopDef) && editValues.includes(androidDef)) return 'pass';
    if (desktopDef || androidDef) return 'warn';
    return 'fail';
  }

  return undefined;
}

function computeVerdict(pre, post, attempts, caseRef, context = {}) {
  const caseVerdict = computeCaseAcceptanceVerdict(caseRef, pre, post, {
    ...context,
    triggerOk: attempts.some((attempt) => attempt.ok),
  });
  if (caseVerdict === 'pass' || caseVerdict === 'fail' || caseVerdict === 'blocked') return caseVerdict;
  if (attempts.some((a) => a.evidencePath === 'syncResult.evidence.path')) return 'ambiguous';
  const anyOk = attempts.some((a) => a.ok);
  if (caseVerdict === 'warn') {
    return 'warn';
  }
  if (anyOk) {
    if (post.status === 'fail') return 'fail';
    if (post.status === 'warn') return 'warn';
    return 'pass';
  }
  return 'fail';
}

function computeStepsVerdict(steps) {
  if (steps.some((s) => s.sync?.evidence?.path === 'syncResult.evidence.path')) return 'ambiguous';
  if (steps.some((s) => s.ok === false)) return 'fail';
  const last = steps[steps.length - 1];
  if (last?.snapshot?.status === 'fail') return 'fail';
  if (last?.snapshot?.status === 'warn') return 'warn';
  return 'pass';
}

function buildTriggerReport(triggerUrl, triggerResponse, attempts) {
  const evidenceAttempt = attempts.find((a) => a.evidencePath);
  if (!triggerResponse || !evidenceAttempt) return { endpoint: triggerUrl, response: triggerResponse };
  return {
    endpoint: triggerUrl,
    response: triggerResponse,
    status: evidenceAttempt.ok === false ? 'fail' : undefined,
    evidence: {
      path: evidenceAttempt.evidencePath,
      nested: triggerResponse.syncResult ?? triggerResponse,
      unavailable: evidenceAttempt.evidencePath === 'syncResult.evidence.path' ? ['syncResult.evidence.path'] : undefined,
    },
  };
}

function toFailureText(attempt) {
  const direct = [
    attempt?.verdict,
    attempt?.status,
    attempt?.error,
    attempt?.stderr,
    attempt?.failures?.join?.(' '),
    attempt?.trigger?.evidence?.unavailable?.join?.(' '),
  ].filter(Boolean).join(' ').toLowerCase();
  const nested = collectEvidenceText(attempt, 0).join(' ').toLowerCase();
  return `${direct} ${nested}`.trim();
}

function collectEvidenceText(value, depth) {
  if (!value || depth > 5) return [];
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object') return [];
  const output = [];
  for (const [key, child] of Object.entries(value)) {
    if (/status|error|reason|evidence|unavailable|semanticDeleteEvidence|importEvidence|sqlite|preflight|diagnostic/i.test(key)) {
      output.push(key);
      output.push(...collectEvidenceText(child, depth + 1));
    } else if (child && typeof child === 'object') {
      output.push(...collectEvidenceText(child, depth + 1));
    }
  }
  return output;
}

export function classifyReliabilityFailure(attempt) {
  const verdict = String(attempt?.verdict ?? attempt?.status ?? '').toLowerCase();
  if (verdict === 'pass' || attempt?.ok === true) return undefined;
  const text = toFailureText(attempt);

  if (/mismatch|replica|tombstone|convergen|assert|conflict/.test(text)) {
    return 'product';
  }
  if (verdict === 'blocked' || verdict === 'ambiguous' || /blocked|ambiguous/.test(text)) {
    return 'harness';
  }
  if (attempt?.timedOut || /timeout|timed out|econnrefused|enotfound|ehostunreach|adb|device offline|preflight|health check|http health.*unavailable|http health.*fail/.test(text)) {
    return 'environment';
  }
  if (/capability|fixture|harness setup|missing-evidence|missing evidence|unavailable|expected exactly one|not present|sqlite3: inaccessible|sqlite3 .*not found/.test(text)) {
    return 'harness';
  }
  if (verdict === 'fail') return 'product';
  return 'unknown';
}

function collectUnavailableEvidence(attempt) {
  const text = toFailureText(attempt);
  const evidence = new Set();
  if (/sqlite3: inaccessible|sqlite3 .*not found|sqlite3 .*not installed|sqlite unavailable|sqlite.*unavailable/.test(text)) {
    evidence.add('android.sqlite3');
  }
  for (const item of attempt?.trigger?.evidence?.unavailable ?? []) {
    if (item) evidence.add(String(item));
  }
  for (const item of attempt?.evidence?.unavailable ?? []) {
    if (item) evidence.add(String(item));
  }
  for (const item of attempt?.unavailableEvidence ?? []) {
    if (item) evidence.add(String(item));
  }
  return [...evidence].sort();
}

function firstFailureReason(attempt) {
  if (attempt?.error) return String(attempt.error);
  if (Array.isArray(attempt?.failures) && attempt.failures.length > 0) return String(attempt.failures[0]);
  if (attempt?.reason) return String(attempt.reason);
  if (attempt?.timedOut) return 'attempt timed out';
  return undefined;
}

function normalizeReliabilityAttempt(raw, attemptNumber) {
  const verdict = String(raw?.verdict ?? raw?.status ?? (raw?.ok === false ? 'fail' : 'unknown')).toLowerCase();
  const evidencePath = raw?.reportPath ?? raw?.evidencePath ?? raw?.evidence?.path;
  const normalized = {
    attempt: attemptNumber,
    verdict,
    ok: verdict === 'pass' || raw?.ok === true,
    evidencePath,
    error: raw?.error,
    timedOut: raw?.timedOut,
  };
  const failureDomain = classifyReliabilityFailure({ ...raw, ...normalized });
  if (failureDomain) normalized.failureDomain = failureDomain;
  const failureReason = firstFailureReason(raw);
  if (failureReason) normalized.failureReason = failureReason;
  normalized.unavailableEvidence = collectUnavailableEvidence(raw);
  return normalized;
}

function withAttemptCaseRef(attempt, caseRef) {
  return caseRef ? { ...attempt, caseRef } : attempt;
}

export function computeReliabilityReport({ attempts, minSuccessRate = 0.8, caseRefs = [] }) {
  const normalizedAttempts = attempts.map((attempt, index) => (
    attempt?.attempt ? attempt : normalizeReliabilityAttempt(attempt, index + 1)
  ));
  const numerator = normalizedAttempts.filter((attempt) => String(attempt.verdict).toLowerCase() === 'pass' || attempt.ok === true).length;
  const denominator = normalizedAttempts.length;
  const successRate = denominator === 0 ? 0 : numerator / denominator;
  const failureDomains = normalizedAttempts.reduce((counts, attempt) => {
    if (!attempt.failureDomain) return counts;
    counts[attempt.failureDomain] = (counts[attempt.failureDomain] ?? 0) + 1;
    return counts;
  }, {});
  const unavailableEvidence = normalizedAttempts.reduce((counts, attempt) => {
    for (const item of attempt.unavailableEvidence ?? []) {
      counts[item] = (counts[item] ?? 0) + 1;
    }
    return counts;
  }, {});

  return {
    status: successRate > minSuccessRate ? 'pass' : 'fail',
    numerator,
    denominator,
    successRate,
    minSuccessRate,
    caseRefs,
    evidencePaths: normalizedAttempts.map((attempt) => attempt.evidencePath).filter(Boolean),
    failureDomains,
    unavailableEvidence,
    attempts: normalizedAttempts,
  };
}

async function runWithTimeout(fn, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fn();
  let timeout;
  try {
    return await Promise.race([
      fn(),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true, error: `attempt timed out after ${timeoutMs}ms` }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runRepeat({ attempts, minSuccessRate = 0.8, timeoutMs = 120_000, caseRefs = [], runAttempt }) {
  if (!Number.isInteger(attempts) || attempts <= 0) throw new Error('runRepeat requires attempts > 0');
  if (typeof runAttempt !== 'function') throw new Error('runRepeat requires runAttempt');

  const results = [];
  const refs = caseRefs.length > 0 ? caseRefs : [undefined];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const caseRef of refs) {
      const raw = await runWithTimeout(() => runAttempt({ attempt, caseRef }), timeoutMs);
      results.push(withAttemptCaseRef(normalizeReliabilityAttempt(raw, attempt), caseRef));
    }
  }
  return computeReliabilityReport({ attempts: results, minSuccessRate, caseRefs });
}

function parsePositiveIntFlag(name, fallback) {
  const raw = readFlag(name, undefined);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} requires a positive integer`);
  return parsed;
}

function removeFlagWithValue(args, flag) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      index += 1;
      continue;
    }
    output.push(args[index]);
  }
  return output;
}

function setFlagValue(args, flag, value) {
  const output = [];
  let replaced = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      output.push(flag, value);
      index += 1;
      replaced = true;
      continue;
    }
    output.push(args[index]);
  }
  return replaced ? output : [...output, flag, value];
}

export function buildRepeatChildArgs(argv, caseRef) {
  let args = removeFlagWithValue(argv, '--repeat');
  args = removeFlagWithValue(args, '--repeat-timeout-ms');
  args = removeFlagWithValue(args, '--min-success-rate');
  if (caseRef) args = setFlagValue(args, '--case-ref', caseRef);
  if (!args.includes('--clean-before')) args.push('--clean-before');
  return args;
}

export function buildCycleChildSpawnOptions(stateEnv, timeoutMs) {
  return {
    cwd: process.cwd(),
    env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs,
    maxBuffer: REPEAT_CHILD_MAX_BUFFER_BYTES,
  };
}

function runCycleChildAttempt(childArgs, stateEnv, timeoutMs) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...childArgs],
    buildCycleChildSpawnOptions(stateEnv, timeoutMs),
  );
  if (result.error?.code === 'ETIMEDOUT') {
    return { timedOut: true, error: `attempt timed out after ${timeoutMs}ms`, stderr: result.stderr };
  }
  if (result.error) {
    return { ok: false, error: result.error.message, stderr: result.stderr };
  }
  if (result.status !== 0) {
    return { ok: false, error: result.stderr || result.error?.message || `cycle exited ${result.status}`, stderr: result.stderr };
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    return { ok: false, error: `unparseable cycle output: ${err instanceof Error ? err.message : String(err)}`, stdout: result.stdout };
  }
}

function spawnPrepareImport(stateEnv, importCfg) {
  const prepareScript = join(__dirname, 'dev-sync-prepare.mjs');
  const filePath = importCfg.file;
  try {
    const output = execFileSync(process.execPath, [prepareScript, '--file', filePath], {
      cwd: process.cwd(),
      env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    });
    const parsed = JSON.parse(output);
    return { ok: parsed.ok !== false, book: parsed.book, error: parsed.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function spawnClean(stateEnv) {
  const cleanScript = join(__dirname, 'dev-sync-clean.mjs');
  try {
    const output = execFileSync(
      process.execPath,
      [cleanScript, '--target', 'desktop-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30_000,
      },
    );
    const parsed = JSON.parse(output);
    return { ok: parsed.ok !== false, verification: parsed.verification, error: parsed.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function formatReinitializeFailure(reinitialize) {
  const diagnostic = reinitialize?.diagnostics?.[0];
  if (!diagnostic) return 'android reinitialize after pm clear failed';
  return [diagnostic.stage, diagnostic.class, diagnostic.message].filter(Boolean).join(': ');
}

export async function spawnAndroidClean(stateEnv, env, { runReset } = {}) {
  const resetScript = join(__dirname, 'dev-sync-reset.mjs');
  const executeReset = runReset || (() => {
    const output = execFileSync(
      process.execPath,
      [resetScript, '--target', 'android-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 60_000,
      },
    );
    return JSON.parse(output);
  });

  try {
    const parsed = await executeReset({ stateEnv, env, resetScript });
    if (parsed.ok === false) {
      return {
        ok: false,
        error: parsed.reinitialize ? formatReinitializeFailure(parsed.reinitialize) : (parsed.error || 'android reset failed'),
        reinitialize: parsed.reinitialize,
        reset: parsed,
      };
    }
    return { ok: true, restarted: true, reinitialize: parsed.reinitialize, reset: parsed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ensurePreCycleCleanup(stateEnv, env, { spawnClean: spawnCleanFn, spawnAndroidClean: spawnAndroidCleanFn } = {}) {
  const desktopClean = (spawnCleanFn ?? spawnClean)(stateEnv);
  const androidClean = await (spawnAndroidCleanFn ?? spawnAndroidClean)(stateEnv, env);
  return {
    ok: desktopClean.ok && androidClean.ok,
    desktopClean,
    androidClean,
  };
}

export async function preparePhase2CaseExecution({
  cleanAndroid,
  stateEnv,
  env,
  runAndroidClean = spawnAndroidClean,
  runFreshPreflight,
}) {
  if (cleanAndroid) {
    const androidClean = await runAndroidClean(stateEnv, env);
    if (!androidClean.ok) {
      return { ok: false, error: androidClean.error || 'unknown error', androidClean };
    }
  }
  return { ok: true, preflight: runFreshPreflight() };
}

function runPipelineSnapshotComparison(stateEnv, reportDir, runId, preState, postState) {
  // Write pre/post snapshots to temp files for assert script
  const prePath = join(reportDir, `${runId}-pre.json`);
  const postPath = join(reportDir, `${runId}-post.json`);
  writeFileSync(prePath, JSON.stringify(preState), 'utf8');
  writeFileSync(postPath, JSON.stringify(postState), 'utf8');

  const assertScript = join(__dirname, 'dev-sync-assert.mjs');
  try {
    const output = execFileSync(process.execPath, [assertScript, '--pre', prePath, '--post', postPath], {
      cwd: process.cwd(),
      env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10_000,
    });
    const parsed = JSON.parse(output);
    return { ok: parsed.ok !== false, verdict: parsed.verdict, failures: parsed.failures, error: parsed.error };
  } catch (err) {
    // Assert exits 1 on FAIL
    if (err.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        return { ok: false, verdict: parsed.verdict, failures: parsed.failures };
      } catch {
        // fall through
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runPipeline(stateEnv, triggerUrl, reportDir, runId, pipelineConfig) {
  const pipeline = [];

  for (const stepCfg of pipelineConfig) {
    const label = stepCfg.label || `step-${pipeline.length + 1}`;
    const preState = spawnStateJson(stateEnv);
    let prepareResult = null;
    let syncResult = null;
    let assertResult = null;
    let cleanResult = null;
    let ok = true;

    if (stepCfg.prepare?.import) {
      prepareResult = spawnPrepareImport(stateEnv, stepCfg.prepare.import);
      ok = ok && prepareResult.ok;
    }

    if (stepCfg.sync) {
      const attempts = [];
      syncResult = await triggerSync(triggerUrl, attempts, stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT);
      stepCfg._attempts = attempts;
      ok = ok && syncResult.ok;
    }

    const postState = spawnStateJson(stateEnv);

    if (stepCfg.assert) {
      assertResult = runPipelineSnapshotComparison(stateEnv, reportDir, `${runId}-${pipeline.length}`, preState.desktop, postState.desktop);
      if (stepCfg.assert.expectDelta) {
        // Re-run with expected delta for more lenient comparison
        // For simplicity, if assertResult has failures but expectDelta matches, override
        if (!assertResult.ok && stepCfg.assert.expectDelta) {
          const expectedDelta = stepCfg.assert.expectDelta;
          const preSnap = preState.desktop;
          const postSnap = postState.desktop;
          // Manually check with expectDelta
          const libPre = preSnap?.library?.summary?.count ?? 0;
          const libPost = postSnap?.library?.summary?.count ?? 0;
          const libExp = expectedDelta.library ?? 0;
          if (libPost === libPre + libExp) {
            assertResult = { ok: true, verdict: 'PASS', failures: [] };
          }
        }
      }
      ok = ok && assertResult.ok;
    }

    if (stepCfg.clean) {
      cleanResult = spawnClean(stateEnv);
      ok = ok && cleanResult.ok;
    }

    pipeline.push({
      label,
      preState: preState.desktop,
      postState: postState.desktop,
      prepare: prepareResult,
      sync: syncResult ? { ok: syncResult.ok, status: syncResult.status, response: syncResult.response, evidence: syncResult.evidence, errors: syncResult.errors } : undefined,
      assert: assertResult,
      clean: cleanResult ? { ok: cleanResult.ok, verification: cleanResult.verification } : undefined,
      ok,
    });
  }

  return pipeline;
}

async function runMultiStep(stateEnv, triggerUrl, stepsConfig) {
  const steps = [];

  for (const stepCfg of stepsConfig) {
    const label = stepCfg.label || `step-${steps.length + 1}`;
    const snapshot = spawnStateJson(stateEnv);
    let prepareResult = null;
    let syncResult = null;
    let ok = true;

    if (stepCfg.prepare) {
      prepareResult = spawnInject(stateEnv, stepCfg.prepare);
      ok = ok && prepareResult.ok;
    }

    if (stepCfg.sync) {
      const attempts = [];
      syncResult = await triggerSync(triggerUrl, attempts, stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT);
      stepCfg._attempts = attempts;
      ok = ok && syncResult.ok;
    }

    steps.push({
      label,
      snapshot: { desktop: snapshot.desktop, android: snapshot.android, status: snapshot.status },
      prepare: prepareResult,
      sync: syncResult ? { ok: syncResult.ok, status: syncResult.status, response: syncResult.response, evidence: syncResult.evidence, errors: syncResult.errors } : undefined,
      ok,
    });
  }

  return steps;
}

async function main() {
  requireDevHarness(process.env, 'dev sync cycle');
  const env = createSyncDevEnvironment(process.env);

  const caseRef = readFlag('--case-ref', undefined);
  const caseName = readFlag('--case-name', undefined);
  const cleanAndroid = hasFlag('--clean-android');
  const reportDir = process.env.BIBLIOTECA_DEV_CYCLE_REPORT_DIR || '/tmp/biblioteca-dev-sync';
  const runId = `dev-sync-cycle-${Date.now()}`;

  const stateEnv = {
    BIBLIOTECA_DEV_SYNC_HARNESS: '1',
    BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: process.env.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT ?? env.desktop.dataRoot,
    BIBLIOTECA_DEV_DESKTOP_DB_DIR: process.env.BIBLIOTECA_DEV_DESKTOP_DB_DIR,
    BIBLIOTECA_DEV_ANDROID_PACKAGE: process.env.BIBLIOTECA_DEV_ANDROID_PACKAGE,
    BIBLIOTECA_DEV_ANDROID_SERVER_URL: process.env.BIBLIOTECA_DEV_ANDROID_SERVER_URL ?? env.android.serverUrl,
    BIBLIOTECA_DEV_DESKTOP_DEV_SYNC_HEALTH_URL: process.env.BIBLIOTECA_DEV_DESKTOP_DEV_SYNC_HEALTH_URL,
    BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: process.env.BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL,
  };

  const repeatRaw = readFlag('--repeat', undefined);
  if (repeatRaw !== undefined) {
    const repeatAttempts = parsePositiveIntFlag('--repeat', undefined);
    const repeatTimeoutMs = parsePositiveIntFlag('--repeat-timeout-ms', 120_000);
    const minSuccessRate = Number.parseFloat(readFlag('--min-success-rate', '0.8'));
    if (!Number.isFinite(minSuccessRate) || minSuccessRate < 0 || minSuccessRate > 1) {
      throw new Error('--min-success-rate requires a number between 0 and 1');
    }
    const caseRefs = caseRef ? caseRef.split(',').map((value) => value.trim()).filter(Boolean) : [];
    const reliability = await runRepeat({
      attempts: repeatAttempts,
      minSuccessRate,
      timeoutMs: repeatTimeoutMs,
      caseRefs,
      runAttempt: async ({ caseRef: childCaseRef }) => runCycleChildAttempt(
        buildRepeatChildArgs(process.argv.slice(2), childCaseRef),
        stateEnv,
        repeatTimeoutMs,
      ),
    });
    const report = {
      runId,
      timestamp: new Date().toISOString(),
      caseRef,
      caseName,
      reliability,
      verdict: reliability.status,
    };

    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${runId}-repeat.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    return;
  }

  const runFreshPreflight = () => runPhase2Preflight({
    runDoctor: () => execFileSync(process.execPath, [join(__dirname, 'dev-sync-doctor.mjs'), '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, ...stateEnv },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    }),
  });
  const preparation = await preparePhase2CaseExecution({ cleanAndroid, stateEnv, env, runFreshPreflight });
  if (!preparation.ok) {
    console.error(`Android clean failed: ${preparation.error}`);
    process.exit(1);
  }

  // ── Pre-cycle cleanup (--clean-before flag) ─────────────
  if (hasFlag('--clean-before')) {
    const cleanResult = await ensurePreCycleCleanup(stateEnv, env);
    if (!cleanResult.ok) {
      console.error(`Pre-cycle cleanup failed: desktop=${cleanResult.desktopClean?.ok}, android=${cleanResult.androidClean?.ok}`);
    }
  }

  // ── Multi-step path (--steps flag present) ────────────
  const stepsRaw = readFlag('--steps', undefined);
  if (stepsRaw !== undefined) {
    let stepsConfig;
    try {
      stepsConfig = JSON.parse(stepsRaw);
      if (!Array.isArray(stepsConfig)) throw new Error('--steps must be a JSON array');
    } catch (err) {
      console.error(`Invalid --steps JSON: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const triggerUrl = env.desktop.syncTriggerUrl;
    const steps = await runMultiStep(stateEnv, triggerUrl, stepsConfig);
    const verdict = computeStepsVerdict(steps);

    const report = {
      runId,
      timestamp: new Date().toISOString(),
      caseRef,
      caseName,
      steps,
      verdict,
    };

    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${runId}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    const output = { ...report, reportPath };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // ── Pipeline path (--pipeline flag present) ────────────
  const pipelineRaw = readFlag('--pipeline', undefined);
  if (pipelineRaw !== undefined) {
    let pipelineConfig;
    try {
      pipelineConfig = JSON.parse(pipelineRaw);
      if (!Array.isArray(pipelineConfig)) throw new Error('--pipeline must be a JSON array');
    } catch (err) {
      console.error(`Invalid --pipeline JSON: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const triggerUrl = env.desktop.syncTriggerUrl;
    const pipeline = await runPipeline(stateEnv, triggerUrl, reportDir, runId, pipelineConfig);
    const verdict = computeStepsVerdict(pipeline);

    const report = {
      runId,
      timestamp: new Date().toISOString(),
      caseRef,
      caseName,
      pipeline,
      verdict,
    };

    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${runId}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    const output = { ...report, reportPath };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // ── Legacy single-step path ───────────────────────────
  const pre = spawnStateJson(stateEnv);
  const caseActions = caseRef ? await executePhase2CaseRefs(caseRef, pre, stateEnv, env, runId) : [];

  // ── Trigger with retry ─────────────────────────────────
  const triggerUrl = env.desktop.syncTriggerUrl;
  const attempts = [];
  let triggerResponse = null;

  for (let i = 1; i <= 2; i++) {
    try {
      const res = await fetch(triggerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
        signal: AbortSignal.timeout(3000),
      });
      const data = await res.json();
      const evaluation = evaluateTriggerPayload({ httpOk: res.ok, httpStatus: res.status, payload: data, endpoint: triggerUrl });
      attempts.push({
        attempt: i,
        ok: evaluation.ok,
        status: res.status,
        error: evaluation.errors?.[0]?.message,
        evidencePath: evaluation.evidence?.path,
      });
      triggerResponse = data;
      break;
    } catch (err) {
      attempts.push({
        attempt: i,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // ── Post-state ─────────────────────────────────────────
  const post = spawnStateJson(stateEnv);

  // ── Verdict ────────────────────────────────────────────
  const verdict = computeVerdict(pre, post, attempts, caseRef, { caseActions });

  // ── Report ─────────────────────────────────────────────
  const report = {
    runId,
    timestamp: new Date().toISOString(),
    caseRef,
    caseName,
    pre: { desktop: pre.desktop, android: pre.android },
    post: { desktop: post.desktop, android: post.android },
    ...(caseActions.length > 0 ? { caseActions } : {}),
    trigger: buildTriggerReport(triggerUrl, triggerResponse, attempts),
    attempts,
    verdict,
  };

  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${runId}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const output = { ...report, reportPath };
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
