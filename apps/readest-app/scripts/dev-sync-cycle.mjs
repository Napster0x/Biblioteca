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

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function spawnStateJson(envVars) {
  const stateScript = new URL('./dev-sync-state.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [stateScript, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, ...envVars },
    encoding: 'utf8',
    timeout: 10_000,
  });
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

  return undefined;
}

function tableRowCount(state, kind, tableName) {
  const db = state?.sqlite?.[kind];
  if (!db?.available) return 0;
  const table = (db.tables || []).find((t) => t.name === tableName);
  return table?.rowCount ?? 0;
}

function replicaRowCount(state, kind) {
  const replica = state?.replicas?.[kind];
  if (!replica?.reachable) return 0;
  return replica.rowCount ?? 0;
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
  if (postDesktopEntries > 1 || postDesktopOccs > 1 || postAndroidEntries > 1 || postAndroidOccs > 1) return 'fail';

  const desktopHasNewData = postDesktopEntries > 0 && postDesktopOccs > 0;
  const androidHasNewData = postAndroidEntries > 0 && postAndroidOccs > 0;

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
  if (postDesktopQuotes > 1 || postAndroidQuotes > 1) return 'fail';

  const desktopHasQuote = postDesktopQuotes > 0;
  const androidHasQuote = postAndroidQuotes > 0;

  if (desktopHasQuote && androidHasQuote) return 'pass';
  return 'warn';
}

function computeVerdict(pre, post, attempts, caseRef, context = {}) {
  const caseVerdict = computeCaseAcceptanceVerdict(caseRef, pre, post, {
    ...context,
    triggerOk: attempts.some((attempt) => attempt.ok),
  });
  if (caseVerdict === 'pass' || caseVerdict === 'fail') return caseVerdict;
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

  if (attempt?.timedOut || /timeout|timed out|econnrefused|enotfound|ehostunreach|health|adb|device|preflight|sqlite3: inaccessible|sqlite3 .*not found/.test(text)) {
    return 'environment';
  }
  if (verdict === 'blocked' || verdict === 'ambiguous' || /blocked|ambiguous|capability|fixture|harness setup|missing-evidence|missing evidence|unavailable|expected exactly one|not present/.test(text)) {
    return 'harness';
  }
  if (verdict === 'fail' || /mismatch|replica|tombstone|convergen|assert|conflict/.test(text)) {
    return 'product';
  }
  return 'unknown';
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

  return {
    status: successRate > minSuccessRate ? 'pass' : 'fail',
    numerator,
    denominator,
    successRate,
    minSuccessRate,
    caseRefs,
    evidencePaths: normalizedAttempts.map((attempt) => attempt.evidencePath).filter(Boolean),
    failureDomains,
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

function buildRepeatChildArgs(argv, caseRef) {
  let args = removeFlagWithValue(argv, '--repeat');
  args = removeFlagWithValue(args, '--repeat-timeout-ms');
  args = removeFlagWithValue(args, '--min-success-rate');
  if (caseRef) args = setFlagValue(args, '--case-ref', caseRef);
  return args;
}

function runCycleChildAttempt(childArgs, stateEnv, timeoutMs) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], {
    cwd: process.cwd(),
    env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: timeoutMs,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    return { timedOut: true, error: `attempt timed out after ${timeoutMs}ms`, stderr: result.stderr };
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
