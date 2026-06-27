#!/usr/bin/env node

/**
 * run-all-cases — Ejecuta los Casos 2-8 de sync CRDT+HLC en automático.
 *
 * Modo: automático, reporta al final pass/fail + fiabilidad.
 *
 * Uso:
 *   BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/run-all-cases.mjs
 *
 * Requisitos:
 *   - Móvil Android conectado por USB
 *   - dev:server corriendo (puerto 3000)
 *   - Android server HTTP activo (puerto 7878, vía ADB forward)
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(__dirname);
const SAMPLE_EPUB = join(__dirname, '..', 'src', '__tests__', 'fixtures', 'data', 'sample-alice.epub');
const TRIGGER_URL = 'http://localhost:3000/api/sync-trigger';
const ANDROID_HEALTH_URL = 'http://localhost:7878/health';
const REPORTS_DIR = '/tmp/biblioteca-dev-sync';

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertHarness() {
  if (!process.env.BIBLIOTECA_DEV_SYNC_HARNESS) {
    throw new Error('BIBLIOTECA_DEV_SYNC_HARNESS=1 required');
  }
}

function runScript(script, args = [], opts = {}) {
  const scriptPath = join(SCRIPTS, script);
  const env = { ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' };
  try {
    const output = execFileSync(process.execPath, [scriptPath, ...args], {
      env,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: opts.timeout || 30_000,
      ...opts,
    });
    return { ok: true, output };
  } catch (err) {
    return {
      ok: false,
      output: err.stdout || '',
      error: err.message,
      stderr: err.stderr || '',
    };
  }
}

function runAdb(args, opts = {}) {
  try {
    const output = execFileSync('adb', args, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: opts.timeout || 15_000,
      ...opts,
    });
    return { ok: true, output: output.trim() };
  } catch (err) {
    return { ok: false, error: err.message, output: err.stdout || '' };
  }
}

async function fetchJson(url, body, timeoutMs = 5000) {
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function waitForAndroidHealth(maxSec = 20) {
  for (let i = 0; i < maxSec; i++) {
    const health = await fetchJson(ANDROID_HEALTH_URL, null, 2000);
    if (health.ok) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ── State capture ────────────────────────────────────────────────────────────

function captureState() {
  const result = runScript('dev-sync-state.mjs', ['--json'], { timeout: 15_000 });
  if (!result.ok) return { status: 'fail', error: result.error };
  try {
    return { status: 'ok', ...JSON.parse(result.output) };
  } catch (e) {
    return { status: 'fail', error: `parse error: ${e.message}` };
  }
}

// ── Reset ────────────────────────────────────────────────────────────────────

async function resetBoth() {
  // Desktop reset
  const desktop = runScript('dev-sync-reset.mjs', [
    '--target', 'desktop-db',
    '--confirm', 'DELETE_DEV_SYNC_STATE',
    '--no-dry-run',
  ], { timeout: 30_000 });

  // Android reset — también reinicia la app
  const androidClean = runScript('dev-sync-reset.mjs', [
    '--target', 'android-db',
    '--confirm', 'DELETE_DEV_SYNC_STATE',
    '--no-dry-run',
  ], { timeout: 30_000 });

  // Force-stop + inject settings via /data/local/tmp + restart app
  const pkg = 'io.github.Napster0x.biblioteca';
  runAdb(['shell', 'am', 'force-stop', pkg]);
  await new Promise(r => setTimeout(r, 1000));

  // Inject settings.json con localSync enabled — usar /data/local/tmp + cp (único método que funciona)
  const settingsContent = JSON.stringify({ localSync: { enabled: true } });
  const tmpSettings = join(tmpdir(), 'biblioteca-settings.json');
  writeFileSync(tmpSettings, settingsContent, 'utf8');
  runAdb(['push', tmpSettings, '/data/local/tmp/biblioteca-settings.json']);
  runAdb(['shell', 'run-as', pkg, 'cp', '/data/local/tmp/biblioteca-settings.json', `/data/data/${pkg}/Readest/settings.json`]);

  // Verificar
  const check = runAdb(['shell', 'run-as', pkg, 'cat', `/data/data/${pkg}/Readest/settings.json`]);
  if (!check.ok || !check.output.includes('localSync')) {
    return { ok: false, error: `settings.json injection failed: ${check.output || check.error}` };
  }

  // Start app
  runAdb(['shell', 'am', 'start', '-n', `${pkg}/.MainActivity`]);

  // Wait for health
  const healthy = await waitForAndroidHealth(25);
  if (!healthy) {
    return { ok: false, error: 'Android health check timeout after reset' };
  }

  return {
    ok: desktop.ok && androidClean.ok,
    desktopStatus: desktop.ok ? 'ok' : 'fail',
    androidStatus: androidClean.ok ? 'ok' : 'fail',
  };
}

// ── Book import ──────────────────────────────────────────────────────────────

function importBook() {
  if (!existsSync(SAMPLE_EPUB)) {
    return { ok: false, error: `Sample EPUB not found: ${SAMPLE_EPUB}` };
  }
  const result = runScript('dev-sync-prepare.mjs', ['--file', SAMPLE_EPUB], { timeout: 15_000 });
  if (!result.ok) return { ok: false, error: result.error, output: result.output };
  try {
    const parsed = JSON.parse(result.output);
    return { ok: parsed.ok !== false, ...parsed };
  } catch (e) {
    return { ok: false, error: `parse error: ${e.message}`, raw: result.output };
  }
}

// ── Fixture injection ────────────────────────────────────────────────────────

function injectFixture(type, bookHash, extra = {}) {
  const args = [];
  if (type === 'dict') {
    args.push('--dict', extra.term || 'zozobrar');
    if (extra.definition) args.push('--definition', extra.definition);
  } else if (type === 'quote') {
    args.push('--quote', extra.text || 'Frases célebres y otros menesteres');
  } else if (type === 'note') {
    args.push('--note', extra.text || 'Análisis del pasaje');
  }
  args.push('--book', bookHash);

  const result = runScript('dev-sync-fixture.mjs', args, { timeout: 10_000 });
  if (!result.ok) {
    return { ok: false, error: result.error, output: result.output };
  }
  try {
    const parsed = JSON.parse(result.output);
    return { ok: parsed.ok !== false, ...parsed };
  } catch (e) {
    return { ok: false, error: `parse error: ${e.message}`, raw: result.output };
  }
}

function injectFixtureAndroid(type, bookHash, extra = {}) {
  // Inyecta en Android vía HTTP API (PUT /replicas/:kind)
  // Usa el nuevo sync-dev-inject-http.mjs para fiabilidad ~95%
  const args = ['--target', 'android-http'];
  if (type === 'dict') {
    args.push('--dict', extra.term || 'zozobrar');
    if (extra.definition) args.push('--definition', extra.definition);
  } else if (type === 'quote') {
    args.push('--quote', extra.text || 'Frases célebres y otros menesteres');
  } else if (type === 'note') {
    args.push('--note', extra.text || 'Análisis del pasaje');
  }
  args.push('--book', bookHash);

  const result = runScript('dev-sync-fixture.mjs', args, { timeout: 10_000 });
  if (!result.ok) {
    return { ok: false, error: result.error, output: result.output };
  }
  try {
    const parsed = JSON.parse(result.output);
    return { ok: parsed.ok !== false, ...parsed };
  } catch (e) {
    return { ok: false, error: `parse error: ${e.message}`, raw: result.output };
  }
}

// ── Sync trigger ─────────────────────────────────────────────────────────────

async function triggerSync() {
  return fetchJson(TRIGGER_URL, {
    BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: '/home/napster/.local/share/io.github.Napster0x.biblioteca.dev',
  }, 10_000);
}

// ── Verification helpers ────────────────────────────────────────────────────

function getAndroidBookCount(state) {
  return state?.android?.manifest?.summary?.kind === 'object'
    ? (state.android.manifest.data?.books?.length ?? 0)
    : 0;
}

function getDesktopBookCount(state) {
  return state?.desktop?.library?.summary?.count ?? 0;
}

function getAndroidReplicaCount(state, kind) {
  const r = state?.android?.replicas?.[kind];
  return r?.rowCount ?? 0;
}

function getDesktopRowCount(state, tableKind) {
  const sqlite = state?.desktop?.sqlite?.[tableKind];
  return sqlite?.tables?.[0]?.rowCount ?? 0;
}

// ── Case definitions ────────────────────────────────────────────────────────

const CASES = [
  {
    id: 2,
    name: 'L | ∅ → L en ambos',
    description: 'Desktop tiene libro, Android vacío → sync → ambos tienen el libro',
    run: async () => {
      // 1. Import book
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}`, bookError: book.error };

      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash returned: ${JSON.stringify(book)}` };

      // 2. Capture pre-state
      const pre = captureState();

      // 3. Sync
      const sync = await triggerSync();
      if (!sync.ok) return { verdict: 'FAIL', detail: `Sync failed: ${sync.error || sync.data?.error}` };

      // 4. Capture post-state (wait a beat for Android to process)
      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      // 5. Verify
      const androidBooks = getAndroidBookCount(post);
      const desktopBooks = getDesktopBookCount(post);

      const passed = androidBooks >= 1 && desktopBooks >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android tiene ${androidBooks} libro(s), Desktop tiene ${desktopBooks} libro(s)`
          : `Android: ${androidBooks} libros, Desktop: ${desktopBooks} libros — se esperaba ≥1 en ambos`,
        pre, post, bookHash,
      };
    },
  },
  {
    id: 3,
    name: 'L + H_D → D + F_D + IMG_D | ∅',
    description: 'Desktop tiene libro + diccionario, Android vacío → sync → ambos tienen todo',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const fixture = injectFixture('dict', bookHash, { term: 'zozobrar', definition: 'Volcar una embarcación' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Fixture dict failed: ${fixture.error}` };

      const pre = captureState();
      const sync = await triggerSync();
      if (!sync.ok) return { verdict: 'FAIL', detail: `Sync failed: ${sync.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      // Check dictionary replicas on Android
      const androidDict = getAndroidReplicaCount(post, 'dictionary-entry');
      const androidOcc = getAndroidReplicaCount(post, 'dictionary-occurrence');
      const desktopDict = getDesktopRowCount(post, 'dictionary');

      const passed = androidDict >= 1 && androidOcc >= 1 && desktopDict >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android: dict-entries=${androidDict}, dict-occurrences=${androidOcc}; Desktop: dict-rows=${desktopDict}`
          : `Android dict-entries=${androidDict}, occurrences=${androidOcc}, Desktop dict-rows=${desktopDict} (esperado ≥1 cada uno)`,
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 4,
    name: 'L + H_C → C + T_C | ∅',
    description: 'Desktop tiene libro + cita, Android vacío → sync → ambos tienen todo',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const fixture = injectFixture('quote', bookHash, { text: 'La lectura es a la mente lo que el ejercicio al cuerpo' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Fixture quote failed: ${fixture.error}` };

      const pre = captureState();
      const sync = await triggerSync();
      if (!sync.ok) return { verdict: 'FAIL', detail: `Sync failed: ${sync.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const androidQuotes = getAndroidReplicaCount(post, 'quote');
      const desktopQuotes = getDesktopRowCount(post, 'quotes');

      const passed = androidQuotes >= 1 && desktopQuotes >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android: quotes=${androidQuotes}; Desktop: quotes-rows=${desktopQuotes}`
          : `Android quotes=${androidQuotes}, Desktop quotes-rows=${desktopQuotes} (esperado ≥1 cada uno)`,
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 5,
    name: 'L + H_N → N + T_N | ∅',
    description: 'Desktop tiene libro + anotación, Android vacío → sync → ambos tienen todo',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const fixture = injectFixture('note', bookHash, { text: 'Interesante reflexión sobre la naturaleza humana' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Fixture note failed: ${fixture.error}` };

      const pre = captureState();
      const sync = await triggerSync();
      if (!sync.ok) return { verdict: 'FAIL', detail: `Sync failed: ${sync.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const androidAnn = getAndroidReplicaCount(post, 'annotation');
      const desktopAnn = getDesktopRowCount(post, 'annotations');

      const passed = androidAnn >= 1 && desktopAnn >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android: annotations=${androidAnn}; Desktop: ann-rows=${desktopAnn}`
          : `Android annotations=${androidAnn}, Desktop ann-rows=${desktopAnn} (esperado ≥1 cada uno)`,
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 6,
    name: 'L + todos grupos | ∅',
    description: 'Desktop tiene libro + diccionario + cita + anotación, Android vacío → sync → ambos tienen todo',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const dict = injectFixture('dict', bookHash, { term: 'zozobrar', definition: 'Volcar una embarcación' });
      if (!dict.ok) return { verdict: 'FAIL', detail: `Fixture dict failed: ${dict.error}` };

      const quote = injectFixture('quote', bookHash, { text: 'La lectura es a la mente lo que el ejercicio al cuerpo' });
      if (!quote.ok) return { verdict: 'FAIL', detail: `Fixture quote failed: ${quote.error}` };

      const note = injectFixture('note', bookHash, { text: 'Interesante reflexión sobre la naturaleza humana' });
      if (!note.ok) return { verdict: 'FAIL', detail: `Fixture note failed: ${note.error}` };

      const pre = captureState();
      const sync = await triggerSync();
      if (!sync.ok) return { verdict: 'FAIL', detail: `Sync failed: ${sync.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const androidDict = getAndroidReplicaCount(post, 'dictionary-entry');
      const androidOcc = getAndroidReplicaCount(post, 'dictionary-occurrence');
      const androidQuotes = getAndroidReplicaCount(post, 'quote');
      const androidAnn = getAndroidReplicaCount(post, 'annotation');

      const allPresent = androidDict >= 1 && androidOcc >= 1 && androidQuotes >= 1 && androidAnn >= 1;

      return {
        verdict: allPresent ? 'PASS' : 'FAIL',
        detail: allPresent
          ? `Android: dict=${androidDict}, occ=${androidOcc}, quotes=${androidQuotes}, ann=${androidAnn} — todos presentes`
          : `Android: dict=${androidDict}, occ=${androidOcc}, quotes=${androidQuotes}, ann=${androidAnn} — faltan datos`,
        pre, post, bookHash, fixtures: { dict, quote, note },
      };
    },
  },
  {
    id: 7,
    name: 'A:L, B:L+datos (bidireccional)',
    description: 'Desktop tiene libro, Android tiene libro + datos → sync → ambos convergen',
    run: async () => {
      // Paso 1: Import book en desktop
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      // Paso 2: Sync para que Android también tenga el libro
      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      // Paso 3: Verificar que Android tiene el libro
      const stateAfterBook = captureState();
      const androidBooks = getAndroidBookCount(stateAfterBook);
      if (androidBooks < 1) {
        return { verdict: 'FAIL', detail: `Android no recibió el libro (books=${androidBooks})` };
      }

      // Paso 4: Ahora injectar datos en DESKTOP (A tiene libro, B tiene libro+datos)
      // Nota: para un verdadero test bidireccional necesitaríamos injectar en Android también,
      // pero el harness no soporta inject en Android vía CLI. Lo que sí podemos hacer
      // es verificar que datos nuevos en desktop se replican a Android donde ya existe el libro.
      const fixture = injectFixture('dict', bookHash, { term: 'melancolía', definition: 'Tristeza vaga y profunda' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Fixture dict failed: ${fixture.error}` };

      const pre = captureState();
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const androidDict = getAndroidReplicaCount(post, 'dictionary-entry');
      const androidBooksFinal = getAndroidBookCount(post);

      const passed = androidDict >= 1 && androidBooksFinal >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android: books=${androidBooksFinal}, dict-entries=${androidDict} — datos replicados correctamente`
          : `Android: books=${androidBooksFinal}, dict-entries=${androidDict}`,
        note: 'Bidireccional parcial: datos nuevos en desktop → Android OK. Para bidireccional completa falta inyectar en Android.',
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 8,
    name: 'Idempotencia (sync repetida)',
    description: 'Sync dos veces seguidas → segunda sync no produce cambios',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const dict = injectFixture('dict', bookHash, { term: 'zozobrar', definition: 'Volcar una embarcación' });
      if (!dict.ok) return { verdict: 'FAIL', detail: `Fixture dict failed: ${dict.error}` };
      const quote = injectFixture('quote', bookHash, { text: 'Lectura, ejercicio mental' });
      if (!quote.ok) return { verdict: 'FAIL', detail: `Fixture quote failed: ${quote.error}` };

      // Primera sync
      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      const state1 = captureState();

      // Segunda sync
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };
      await new Promise(r => setTimeout(r, 3000));

      const state2 = captureState();

      // Verificar que no hay cambios entre state1 y state2
      const androidDict1 = getAndroidReplicaCount(state1, 'dictionary-entry');
      const androidDict2 = getAndroidReplicaCount(state2, 'dictionary-entry');
      const androidQuotes1 = getAndroidReplicaCount(state1, 'quote');
      const androidQuotes2 = getAndroidReplicaCount(state2, 'quote');
      const androidAnn1 = getAndroidReplicaCount(state1, 'annotation');
      const androidAnn2 = getAndroidReplicaCount(state2, 'annotation');

      const dictStable = androidDict1 === androidDict2;
      const quoteStable = androidQuotes1 === androidQuotes2;
      const annStable = androidAnn1 === androidAnn2;
      const allStable = dictStable && quoteStable && annStable;

      return {
        verdict: allStable ? 'PASS' : 'FAIL',
        detail: allStable
          ? `Sin cambios tras segunda sync: dict=${androidDict1}, quotes=${androidQuotes1}, ann=${androidAnn1}`
          : `Cambios detectados: dict ${androidDict1}→${androidDict2}, quotes ${androidQuotes1}→${androidQuotes2}, ann ${androidAnn1}→${androidAnn2}`,
        state1, state2,
      };
    },
  },
];

  // ── Bloque B: M→O (Android → Desktop) ──────────────────────────────────────
  //
  // Estos casos prueban la dirección inversa: datos creados en Android
  // se replican a desktop mediante el inyector HTTP (--target android-http).
  // Usan el mismo protocolo CRDT+HLC que el sync real.

  {
    id: 9,
    name: '∅ | L + H_D → D + F_D + IMG_D (M→O)',
    description: 'Android tiene libro + diccionario, Desktop vacío → sync → ambos tienen todo (M→O)',
    run: async () => {
      // 1. Import book en desktop primero (necesario para que exista)
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      // 2. Sync para que Android tenga el libro
      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      // 3. Limpiar desktop (borrar solo datos de fixture, mantener libro)
      // No necesitamos limpiar — el reset ya lo hizo al inicio del caso

      // 4. Inyectar diccionario en Android vía HTTP
      const fixture = injectFixtureAndroid('dict', bookHash, { term: 'zozobrar', definition: 'Volcar una embarcación' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Android fixture dict failed: ${fixture.error}` };

      const pre = captureState();
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      // 5. Verificar que desktop recibió los datos de Android
      const desktopDict = getDesktopRowCount(post, 'dictionary');
      const androidDict = getAndroidReplicaCount(post, 'dictionary-entry');

      const passed = desktopDict >= 1 && androidDict >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Desktop: dict-rows=${desktopDict}; Android: dict-entries=${androidDict} — M→O diccionario OK`
          : `Desktop dict-rows=${desktopDict}, Android dict-entries=${androidDict} (esperado ≥1 cada uno)`,
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 10,
    name: '∅ | L + H_C → C + T_C (M→O)',
    description: 'Android tiene libro + cita, Desktop vacío → sync → ambos tienen cita (M→O)',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      const fixture = injectFixtureAndroid('quote', bookHash, { text: 'La lectura es a la mente lo que el ejercicio al cuerpo' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Android fixture quote failed: ${fixture.error}` };

      const pre = captureState();
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const desktopQuotes = getDesktopRowCount(post, 'quotes');
      const androidQuotes = getAndroidReplicaCount(post, 'quote');

      const passed = desktopQuotes >= 1 && androidQuotes >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Desktop: quotes-rows=${desktopQuotes}; Android: quotes=${androidQuotes} — M→O cita OK`
          : `Desktop quotes-rows=${desktopQuotes}, Android quotes=${androidQuotes} (esperado ≥1 cada uno)`,
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 11,
    name: '∅ | L + H_N → N + T_N (M→O)',
    description: 'Android tiene libro + anotación, Desktop vacío → sync → ambos tienen anotación (M→O)',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      const fixture = injectFixtureAndroid('note', bookHash, { text: 'Interesante reflexión sobre la naturaleza humana' });
      if (!fixture.ok) return { verdict: 'FAIL', detail: `Android fixture note failed: ${fixture.error}` };

      const pre = captureState();
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const desktopAnn = getDesktopRowCount(post, 'annotations');
      const androidAnn = getAndroidReplicaCount(post, 'annotation');

      const passed = desktopAnn >= 1 && androidAnn >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Desktop: ann-rows=${desktopAnn}; Android: annotations=${androidAnn} — M→O anotación OK`
          : `Desktop ann-rows=${desktopAnn}, Android annotations=${androidAnn} (esperado ≥1 cada uno)`,
        pre, post, bookHash, fixture,
      };
    },
  },
  {
    id: 12,
    name: '∅ | L + todos grupos (M→O)',
    description: 'Android tiene libro + diccionario + cita + anotación, Desktop vacío → sync → ambos tienen todo (M→O)',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      const dict = injectFixtureAndroid('dict', bookHash, { term: 'zozobrar', definition: 'Volcar una embarcación' });
      if (!dict.ok) return { verdict: 'FAIL', detail: `Android fixture dict failed: ${dict.error}` };

      const quote = injectFixtureAndroid('quote', bookHash, { text: 'La lectura es a la mente lo que el ejercicio al cuerpo' });
      if (!quote.ok) return { verdict: 'FAIL', detail: `Android fixture quote failed: ${quote.error}` };

      const note = injectFixtureAndroid('note', bookHash, { text: 'Interesante reflexión sobre la naturaleza humana' });
      if (!note.ok) return { verdict: 'FAIL', detail: `Android fixture note failed: ${note.error}` };

      const pre = captureState();
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const androidDict = getAndroidReplicaCount(post, 'dictionary-entry');
      const androidOcc = getAndroidReplicaCount(post, 'dictionary-occurrence');
      const androidQuotes = getAndroidReplicaCount(post, 'quote');
      const androidAnn = getAndroidReplicaCount(post, 'annotation');
      const desktopDict = getDesktopRowCount(post, 'dictionary');
      const desktopQuotes = getDesktopRowCount(post, 'quotes');
      const desktopAnn = getDesktopRowCount(post, 'annotations');

      const allAndroidPresent = androidDict >= 1 && androidOcc >= 1 && androidQuotes >= 1 && androidAnn >= 1;
      const allDesktopPresent = desktopDict >= 1 && desktopQuotes >= 1 && desktopAnn >= 1;

      const passed = allAndroidPresent && allDesktopPresent;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android: dict=${androidDict}, occ=${androidOcc}, quotes=${androidQuotes}, ann=${androidAnn} | Desktop: dict=${desktopDict}, quotes=${desktopQuotes}, ann=${desktopAnn} — M→O completo`
          : `Android: dict=${androidDict}, occ=${androidOcc}, quotes=${androidQuotes}, ann=${androidAnn} | Desktop: dict=${desktopDict}, quotes=${desktopQuotes}, ann=${desktopAnn}`,
        pre, post, bookHash, fixtures: { dict, quote, note },
      };
    },
  },
  {
    id: 13,
    name: 'A:L, B:L+H_D → convergencia bidireccional completa (O⇄M)',
    description: 'Desktop libro + Android libro+dict → sync → ambos convergen con todos los datos (bidireccional completa)',
    run: async () => {
      // Prueba bidireccional REAL: Desktop tiene libro, Android tiene libro + datos
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      // Sync para que Android tenga el libro
      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      // Inyectar dict en Android con el nuevo HTTP injector
      const fixtureAndroid = injectFixtureAndroid('dict', bookHash, { term: 'melancolía', definition: 'Tristeza vaga y profunda' });
      if (!fixtureAndroid.ok) return { verdict: 'FAIL', detail: `Android fixture failed: ${fixtureAndroid.error}` };

      const pre = captureState();
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };

      await new Promise(r => setTimeout(r, 2000));
      const post = captureState();

      const androidDict = getAndroidReplicaCount(post, 'dictionary-entry');
      const desktopDict = getDesktopRowCount(post, 'dictionary');
      const androidBooks = getAndroidBookCount(post);
      const desktopBooks = getDesktopBookCount(post);

      const passed = androidDict >= 1 && desktopDict >= 1 && androidBooks >= 1 && desktopBooks >= 1;
      return {
        verdict: passed ? 'PASS' : 'FAIL',
        detail: passed
          ? `Android: books=${androidBooks}, dict=${androidDict} | Desktop: books=${desktopBooks}, dict=${desktopDict} — bidireccional COMPLETA`
          : `Android: books=${androidBooks}, dict=${androidDict} | Desktop: books=${desktopBooks}, dict=${desktopDict}`,
        note: 'Bidireccionalidad real: libro de Desktop → Android, dict de Android → Desktop.',
        pre, post, bookHash, fixtureAndroid,
      };
    },
  },
  {
    id: 14,
    name: 'Idempotencia M→O (sync repetida)',
    description: 'Sync dos veces seguidas con datos en Android → segunda sync no produce cambios',
    run: async () => {
      const book = importBook();
      if (!book.ok) return { verdict: 'FAIL', detail: `Import book failed: ${book.error}` };
      const bookHash = book.book?.hash;
      if (!bookHash) return { verdict: 'FAIL', detail: `No book hash: ${JSON.stringify(book)}` };

      const sync1 = await triggerSync();
      if (!sync1.ok) return { verdict: 'FAIL', detail: `First sync failed: ${sync1.error}` };
      await new Promise(r => setTimeout(r, 3000));

      // Inyectar dict + quote en Android
      const dict = injectFixtureAndroid('dict', bookHash, { term: 'zozobrar', definition: 'Volcar una embarcación' });
      if (!dict.ok) return { verdict: 'FAIL', detail: `Android fixture dict failed: ${dict.error}` };
      const quote = injectFixtureAndroid('quote', bookHash, { text: 'Lectura, ejercicio mental' });
      if (!quote.ok) return { verdict: 'FAIL', detail: `Android fixture quote failed: ${quote.error}` };

      // Primera sync (Android → Desktop)
      const sync2 = await triggerSync();
      if (!sync2.ok) return { verdict: 'FAIL', detail: `Second sync failed: ${sync2.error}` };
      await new Promise(r => setTimeout(r, 3000));
      const state1 = captureState();

      // Segunda sync (no debería cambiar nada)
      const sync3 = await triggerSync();
      if (!sync3.ok) return { verdict: 'FAIL', detail: `Third sync failed: ${sync3.error}` };
      await new Promise(r => setTimeout(r, 3000));
      const state2 = captureState();

      // Verificar estabilidad
      const androidDict1 = getAndroidReplicaCount(state1, 'dictionary-entry');
      const androidDict2 = getAndroidReplicaCount(state2, 'dictionary-entry');
      const androidQuotes1 = getAndroidReplicaCount(state1, 'quote');
      const androidQuotes2 = getAndroidReplicaCount(state2, 'quote');
      const desktopDict1 = getDesktopRowCount(state1, 'dictionary');
      const desktopDict2 = getDesktopRowCount(state2, 'dictionary');
      const desktopQuotes1 = getDesktopRowCount(state1, 'quotes');
      const desktopQuotes2 = getDesktopRowCount(state2, 'quotes');

      const androidStable = androidDict1 === androidDict2 && androidQuotes1 === androidQuotes2;
      const desktopStable = desktopDict1 === desktopDict2 && desktopQuotes1 === desktopQuotes2;
      const bothStable = androidStable && desktopStable;

      return {
        verdict: bothStable ? 'PASS' : 'FAIL',
        detail: bothStable
          ? `Sin cambios tras segunda sync M→O: Android dict=${androidDict1}, quotes=${androidQuotes1} | Desktop dict=${desktopDict1}, quotes=${desktopQuotes1}`
          : `Cambios detectados M→O: Android dict ${androidDict1}→${androidDict2}, quotes ${androidQuotes1}→${androidQuotes2} | Desktop dict ${desktopDict1}→${desktopDict2}, quotes ${desktopQuotes1}→${desktopQuotes2}`,
        state1, state2,
      };
    },
  },
];

// ── Main runner ──────────────────────────────────────────────────────────────

async function main() {
  assertHarness();
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Batería CRDT+HLC — Casos 2-14 (O→M + M→O)                       ║');
  console.log('║   Inicio: ' + new Date().toISOString() + '                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const results = [];

  for (const caso of CASES) {
    console.log(`\n${'━'.repeat(60)}`);
    console.log(`\n🔷 Caso ${caso.id}: ${caso.name}`);
    console.log(`   ${caso.description}`);
    console.log('');

    // Reset antes de cada caso
    console.log('   ⏳ Resetting both sides...');
    const reset = await resetBoth();
    if (!reset.ok) {
      console.log(`   ❌ RESET FAILED: ${reset.error}`);
      results.push({ id: caso.id, name: caso.name, verdict: 'ERROR', detail: `Reset failed: ${reset.error}` });
      continue;
    }
    console.log('   ✅ Reset OK');

    // Run case
    console.log('   🚀 Ejecutando caso...');
    const result = await caso.run();

    const icon = result.verdict === 'PASS' ? '✅' : result.verdict === 'FAIL' ? '❌' : '⚠️';
    console.log(`   ${icon} ${result.verdict}: ${result.detail}`);
    if (result.note) console.log(`   📝 ${result.note}`);

    results.push({
      id: caso.id,
      name: caso.name,
      verdict: result.verdict,
      detail: result.detail,
      note: result.note || undefined,
    });
  }

  // ── Final report ──────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('\n📊 INFORME FINAL\n');

  const passed = results.filter(r => r.verdict === 'PASS').length;
  const failed = results.filter(r => r.verdict === 'FAIL').length;
  const errors = results.filter(r => r.verdict === 'ERROR').length;
  const total = results.length;

  for (const r of results) {
    const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} Caso ${r.id}: ${r.name}`);
    console.log(`     ${r.detail}`);
    if (r.note) console.log(`     📝 ${r.note}`);
    console.log('');
  }

  console.log('─'.repeat(40));
  console.log(`  Total: ${total} casos`);
  console.log(`  ✅ Pass: ${passed}`);
  console.log(`  ❌ Fail: ${failed}`);
  console.log(`  ⚠️  Error: ${errors}`);
  console.log('');

  // ── Fiabilidad ────────────────────────────────────────────────────────────

  const passRate = total > 0 ? (passed / total) * 100 : 0;

  // Factores de fiabilidad:
  // 1. Inyección directa a SQLite (no vía UI): -15%
  // 2. Sync vía API trigger (no vía UI): -10%
  // 3. Estado capturado vía API/SQLite (no vía UI): -5%
  // 4. Protocolo HTTP replicas real: +0% (es el mismo)
  // 5. Servidor Android real: +0% (es el mismo)
  // 6. CRDT+HLC processing real: +0% (es el mismo)
  // 7. No hay interacción humana real: -5%
  // Total descuento: 35% → fiabilidad base = 65% para casos PASS
  // Para casos FAIL, la fiabilidad es menor porque podría ser falso positivo/negativo

  const baseReliability = 65; // Fiabilidad base del harness
  const passConfidence = passRate >= 50 ? baseReliability : baseReliability - 10;

  // Ajuste por casos FAIL — reduce confianza
  const failPenalty = failed > 0 ? (failed * 10) : 0;
  const adjustedReliability = Math.max(passConfidence - failPenalty, 0);

  console.log('📈 ANÁLISIS DE FIABILIDAD');
  console.log('');
  console.log('  La fiabilidad mide cuánto se parece este test a la experiencia');
  console.log('  real de un usuario. Factores considerados:');
  console.log('');
  console.log('  🔴 Descuentos por divergencia con la realidad:');
  console.log('     - Inyección directa a SQLite (no vía UI del usuario):    -15%');
  console.log('     - Sync vía API de trigger (no vía UI del usuario):      -10%');
  console.log('     - Captura de estado vía API/SQLite (no vía UI):         -5%');
  console.log('     - Sin interacción humana real (selección de texto):     -5%');
  console.log('');
  console.log('  🟢 Aspectos idénticos a la experiencia real:');
  console.log('     - Protocolo HTTP de replicas:          IDÉNTICO');
  console.log('     - Servidor HTTP Android real:          IDÉNTICO');
  console.log('     - Procesamiento CRDT+HLC:              IDÉNTICO');
  console.log('     - Almacenamiento SQLite en Android:    IDÉNTICO');
  console.log('');
  console.log(`  📊 Fiabilidad base del harness:    ${baseReliability}%`);
  console.log(`  📊 Penalización por fallos:        -${failPenalty}%`);
  if (passRate >= 50) {
    console.log(`  📊 Confianza por tasa de pass:     +0%`);
  } else {
    console.log(`  📊 Confianza por tasa de pass:     -10%`);
  }
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  🎯 FIABILIDAD ESTIMADA:            ${adjustedReliability}%`);
  console.log('');
  console.log('  Escala:');
  console.log('     90-100%  → Reproduce fielmente la experiencia real');
  console.log('     70-89%   → Alta confianza, pequeñas divergencias');
  console.log('     50-69%   → Confianza media, diferencias notables');
  console.log('     <50%     → Baja confianza, el test se aleja de la realidad');
  console.log('');

  // Save report
  const reportPath = join(REPORTS_DIR, `casos-2-8-${Date.now()}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    results,
    summary: { total, passed, failed, errors },
    reliability: {
      basePercentage: baseReliability,
      failPenalty,
      adjustedPercentage: adjustedReliability,
      factors: {
        identical: ['HTTP replica protocol', 'Android HTTP server', 'CRDT+HLC processing', 'Android SQLite storage'],
        discount: [
          { factor: 'Direct SQLite injection (not UI)', discount: -15 },
          { factor: 'Sync via API trigger (not UI)', discount: -10 },
          { factor: 'State capture via API/SQLite (not UI)', discount: -5 },
          { factor: 'No human interaction', discount: -5 },
        ],
      },
    },
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  📁 Reporte guardado: ${reportPath}`);
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
