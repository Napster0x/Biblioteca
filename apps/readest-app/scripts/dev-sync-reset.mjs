#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { reinitializeAndroidAfterClean } from './android-clean-reinit.mjs';
import {
  CONFIRM_TOKEN,
  DESKTOP_DEV_MARKER_FILE,
  DEV_SCOPE_MARKER,
  createSyncDevEnvironment,
  requireDevHarness,
} from './sync-dev-env.mjs';

const SYNC_ENV = createSyncDevEnvironment();

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

// ── targetRoot: resolve the root path per target ──────────

function targetRoot(target) {
  if (target === 'tmp') {
    return resolve(process.env.BIBLIOTECA_DEV_SYNC_TMP_DIR || join(tmpdir(), DEV_SCOPE_MARKER));
  }
  if (target === 'desktop-db') {
    return SYNC_ENV.desktop.dataRoot;
  }
  if (target === 'android-db') {
    // android-db has no filesystem root; operations are done via ADB.
    // Return a sentinel string for logging.
    return `adb://${SYNC_ENV.android.packageName}`;
  }
  throw new Error(`unknown dev sync reset target: ${target}`);
}

// ── path guards ───────────────────────────────────────────

function assertDevScoped(path) {
  const normalized = resolve(path);
  if (!normalized.includes(DEV_SCOPE_MARKER)) {
    throw new Error(`target path is not dev-sync scoped: ${normalized}`);
  }
  if (normalized === '/' || normalized === tmpdir() || normalized === process.env.HOME) {
    throw new Error(`refusing unsafe reset path: ${normalized}`);
  }
  return normalized;
}

function assertDesktopDbRoot(root) {
  const normalized = resolve(root);
  if (normalized === '/' || normalized === tmpdir() || normalized === process.env.HOME) {
    throw new Error(`refusing unsafe reset path: ${normalized}`);
  }

  // Must contain the dev marker file
  const markerPath = join(normalized, DESKTOP_DEV_MARKER_FILE);
  if (!existsSync(markerPath)) {
    throw new Error(
      `dev marker missing: ${markerPath} — place a ${DESKTOP_DEV_MARKER_FILE} file in the dev app data directory`,
    );
  }

  return normalized;
}

// ── declared paths per target ─────────────────────────────

function declaredPaths(root, target) {
  if (target === 'tmp') {
    return [join(root, 'biblioteca-dev-sync-counter.txt')];
  }
  if (target === 'desktop-db') {
    const readestDir = join(root, 'Readest');
    const readestBooksDir = join(readestDir, 'Books');
    const rootBooksDir = join(root, 'Books');
    const dbNames = ['annotations.db', 'citas.db', 'dictionary.db'];
    const dbPaths = dbNames.flatMap((name) => [
      join(readestDir, name),
      join(readestDir, `${name}-wal`),
      join(readestDir, `${name}-shm`),
    ]);
    const bookDirs = [rootBooksDir, readestBooksDir].flatMap((dir) =>
      existsSync(dir)
        ? readdirSync(dir)
            .map((name) => join(dir, name))
            .filter((path) => {
              try {
                return statSync(path).isDirectory();
              } catch {
                return false;
              }
            })
        : [],
    );

    return [
      ...dbPaths,
      join(root, 'library.json'),
      join(root, 'library.json.bak'),
      join(readestBooksDir, 'library.json'),
      join(readestBooksDir, 'library.json.bak'),
      join(root, 'settings.json'),
      join(root, 'settings.json.bak'),
      join(readestDir, 'settings.json'),
      join(readestDir, 'settings.json.bak'),
      join(root, 'local-sync', 'replicas'),   // entire replicas dir
      ...bookDirs,
    ];
  }
  return [];
}

function undeclaredExistingPaths(root, declared) {
  if (!existsSync(root)) return [];
  const declaredSet = new Set(declared);
  const preserved = [];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (declaredSet.has(full)) continue;
      preserved.push(full);
      try {
        if (statSync(full).isDirectory()) walk(full);
      } catch {
        // broken symlink / permission error — still list it
      }
    }
  }

  walk(root);
  return preserved;
}

// ── file cleanup helpers ──────────────────────────────────

function cleanFileSystem({ root, candidates, dryRun }) {
  const deleted = [];
  const errors = [];
  const preserved = undeclaredExistingPaths(root, candidates);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    if (dryRun) {
      preserved.push(path);
    } else {
      try {
        rmSync(path, { recursive: true, force: true });
        deleted.push(path);
      } catch (error) {
        errors.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const remaining = candidates.filter((path) => existsSync(path)).length;
  return { root, deleted, preserved, errors, counts: { requested: candidates.length, deleted: deleted.length, remaining } };
}

// ── android-db helpers ────────────────────────────────────

function defaultRunAdb(args) {
  return execFileSync('adb', args, { stdio: 'pipe', encoding: 'utf8', timeout: 10_000 });
}

async function adbAvailable(runAdb = defaultRunAdb) {
  try {
    await runAdb(['version']);
    return true;
  } catch {
    return false;
  }
}

async function clearAndroidRuntimeState({ dryRun }) {
  const endpoint = '/__dev/reset';
  const runtimeReset = {
    attempted: !dryRun,
    ok: dryRun,
    endpoint,
    url: `${SYNC_ENV.android.serverUrl}${endpoint}`,
    status: dryRun ? 0 : undefined,
    restartRequired: false,
  };

  if (dryRun) return runtimeReset;

  try {
    const response = await fetch(runtimeReset.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Biblioteca-Dev-Sync-Harness': CONFIRM_TOKEN,
      },
      body: JSON.stringify({ target: 'android-db' }),
      signal: AbortSignal.timeout(2_000),
    });
    const body = await response.text();
    runtimeReset.status = response.status;
    runtimeReset.ok = response.ok;
    runtimeReset.body = body;
    runtimeReset.restartRequired = !response.ok;
    return runtimeReset;
  } catch (error) {
    runtimeReset.ok = false;
    runtimeReset.status = 0;
    runtimeReset.error = error instanceof Error ? error.message : String(error);
    runtimeReset.restartRequired = true;
    return runtimeReset;
  }
}

export async function cleanAndroid({
  dryRun,
  env = SYNC_ENV,
  runAdb = defaultRunAdb,
  fetch: fetchImpl = globalThis.fetch,
  sleep,
  reinitializeTimeoutMs = Number(process.env.BIBLIOTECA_ANDROID_REINIT_TIMEOUT_MS || 30_000),
  reinitializeIntervalMs = Number(process.env.BIBLIOTECA_ANDROID_REINIT_INTERVAL_MS || 1_000),
} = {}) {
  const androidPackage = env.android.packageName;
  const readestDir = env.android.readestDir;
  const serialArgs = env.android.serial ? ['-s', env.android.serial] : [];
  const targets = [
    'annotations.db',
    'annotations.db-wal',
    'annotations.db-shm',
    'citas.db',
    'citas.db-wal',
    'citas.db-shm',
    'dictionary.db',
    'dictionary.db-wal',
    'dictionary.db-shm',
    'library.json',
    'library.json.bak',
    'settings.json',
    'settings.json.bak',
  ].map((name) => `${readestDir}/${name}`);
  targets.push(`/data/data/${androidPackage}/settings.json`, `/data/data/${androidPackage}/settings.json.bak`);
  targets.push(`${readestDir}/Books/*`, `/data/data/${androidPackage}/Books/*`);

  const result = {
    target: 'android-db',
    root: `adb://${androidPackage}`,
    androidPackage,
    deleted: [],
    preserved: [],
    errors: [],
    counts: { requested: targets.length, deleted: 0, remaining: 0 },
    adbAvailable: await adbAvailable(runAdb),
    pmClearDone: false,
    reinitialize: { attempted: false, ok: dryRun, diagnostics: [], stages: [] },
    runtimeReset: { attempted: false, ok: dryRun, endpoint: '/__dev/reset', status: dryRun ? 0 : undefined, restartRequired: false },
  };

  if (dryRun) {
    result.preserved = [
      `adb shell pm clear ${androidPackage}`,
      ...targets.map((path) => `adb shell run-as ${androidPackage} rm -rf ${path}`),
    ];
    return result;
  }

  if (!result.adbAvailable) {
    throw new Error('ADB is not available — cannot clean android-db. Install Android SDK platform-tools.');
  }

  // Primary: adb shell pm clear <package> — nuclear clean that purges all app data
  try {
    await runAdb([...serialArgs, 'shell', 'pm', 'clear', androidPackage]);
    result.pmClearDone = true;
    result.deleted.push(`pm clear ${androidPackage}`);
    result.reinitialize = {
      attempted: true,
      ...(await reinitializeAndroidAfterClean({
        env,
        runAdb,
        fetch: fetchImpl,
        sleep,
        timeoutMs: reinitializeTimeoutMs,
        intervalMs: reinitializeIntervalMs,
      })),
    };
    if (!result.reinitialize.ok) {
      const diagnostic = result.reinitialize.diagnostics?.[0] || {};
      result.errors.push({
        command: 'android reinitialize after pm clear',
        stage: diagnostic.stage,
        class: diagnostic.class,
        message: diagnostic.message || 'Android did not become ready after pm clear',
      });
    }
    result.counts.deleted = result.deleted.length;
    result.counts.remaining = result.errors.length;
    return result;
  } catch (err) {
    result.errors.push({
      command: `pm clear ${androidPackage}`,
      message: err instanceof Error ? err.message : String(err),
    });
    // pm clear failed — fall through to file-by-file cleanup
  }

  // Fallback: file-by-file cleanup via run-as rm -rf for each target
  const commands = targets.map((path) => `run-as ${androidPackage} rm -rf ${path}`);

  for (const cmd of commands) {
    try {
      await runAdb([...serialArgs, 'shell', cmd]);
      result.deleted.push(cmd);
    } catch (err) {
      // If run-as fails, the app might not be installed or is a release build
      result.errors.push({ command: cmd, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Runtime reset only needed in fallback path (pm clear already nuked in-memory state)
  result.runtimeReset = await clearAndroidRuntimeState({ dryRun });
  if (!result.runtimeReset.ok) {
    result.errors.push({
      command: `POST ${result.runtimeReset.endpoint}`,
      message: `Android runtime reset endpoint unavailable or failed; restart/redeploy the app so local sync in-memory state is cleared before rerunning Caso 3`,
      status: result.runtimeReset.status,
    });
  }
  result.counts.deleted = result.deleted.length;
  result.counts.remaining = result.errors.length;

  return result;
}

// ── single-target run ─────────────────────────────────────

async function runTarget(target, dryRun) {
  if (target === 'android-db') {
    return cleanAndroid({ dryRun });
  }

  const rawRoot = targetRoot(target);
  const root = target === 'desktop-db' ? assertDesktopDbRoot(rawRoot) : assertDevScoped(rawRoot);
  const candidates = declaredPaths(root, target);
  const { deleted, preserved, errors, counts } = cleanFileSystem({ root, candidates, dryRun });
  return { target, root, deleted, preserved, errors, counts };
}

// ── main ──────────────────────────────────────────────────

async function main() {
  requireDevHarness(process.env, 'dev sync reset');
  const target = readFlag('--target', 'tmp');
  const dryRun = !hasFlag('--no-dry-run');
  const confirm = readFlag('--confirm', '');

  if (!dryRun && confirm !== CONFIRM_TOKEN) {
    throw new Error(`destructive dev sync reset requires --confirm ${CONFIRM_TOKEN}`);
  }

  // Ensure tmpdir exists for tmp target
  if (target === 'tmp') {
    const dir = targetRoot('tmp');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  if (target === 'all') {
    const targets = ['tmp', 'desktop-db', 'android-db'];
    const results = await Promise.all(targets.map((t) => runTarget(t, dryRun)));
    const ok = results.every((item) => item.errors.length === 0);
    console.log(
      JSON.stringify({ ok, target: 'all', dryRun, targets: results }, null, 2),
    );
    if (!ok) process.exitCode = 1;
    return;
  }

  const result = await runTarget(target, dryRun);
  const ok = result.errors.length === 0;
  console.log(JSON.stringify({ ok, dryRun, ...result }, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
