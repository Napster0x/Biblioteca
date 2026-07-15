import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const REPLICA_KINDS = Object.freeze([
  'annotation',
  'quote',
  'dictionary-entry',
  'dictionary-occurrence',
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 1_000;
const DEVICE_SETTINGS_PATH = '/data/local/tmp/biblioteca-settings.json';

function defaultRunAdb(args) {
  return execFileSync('adb', args, { encoding: 'utf8', stdio: 'pipe', timeout: 10_000 });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serialArgs(env) {
  return env?.android?.serial ? ['-s', env.android.serial] : [];
}

function maxAttempts(timeoutMs, intervalMs) {
  return Math.max(1, Math.ceil(timeoutMs / Math.max(1, intervalMs)) + 1);
}

function failure(stage, failureClass, error, evidence = {}) {
  const message = error instanceof Error ? error.message : String(error ?? failureClass);
  return {
    ok: false,
    stage: { name: stage, ok: false, class: failureClass },
    diagnostic: { stage, class: failureClass, message, ...evidence },
  };
}

async function runStage({ stages, diagnostics, name, failureClass, action }) {
  try {
    const value = await action();
    stages.push({ name, ok: true });
    return { ok: true, value };
  } catch (error) {
    const result = failure(name, failureClass, error);
    stages.push(result.stage);
    diagnostics.push(result.diagnostic);
    return result;
  }
}

async function waitForProcess({ env, runAdb, sleep, timeoutMs, intervalMs, stages, diagnostics }) {
  const pkg = env.android.packageName;
  const prefix = serialArgs(env);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts(timeoutMs, intervalMs); attempt++) {
    try {
      const stdout = await runAdb([...prefix, 'shell', 'pidof', pkg]);
      const pid = typeof stdout === 'string' ? stdout.trim().split(/\s+/).filter(Boolean)[0] : null;
      if (pid) {
        stages.push({ name: 'android.process', ok: true });
        return { ok: true, value: { pid } };
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts(timeoutMs, intervalMs)) await sleep(intervalMs);
  }

  const result = failure('android.process', 'process-absent', lastError ?? 'Android app process is not running');
  stages.push(result.stage);
  diagnostics.push(result.diagnostic);
  return result;
}

async function responseText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function waitForHttp({ fetch, sleep, timeoutMs, intervalMs, url, stage, failureClass, emptyClass, stages, diagnostics }) {
  let lastError = null;
  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts(timeoutMs, intervalMs); attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 5_000))) });
      const body = await responseText(response);
      lastStatus = response.status;
      if (response.ok && body.trim()) {
        stages.push({ name: stage, ok: true });
        return { ok: true, value: { url, status: response.status, body } };
      }
      if (response.ok && !body.trim() && emptyClass) {
        const result = failure(stage, emptyClass, 'empty response body', { url, status: response.status });
        stages.push(result.stage);
        diagnostics.push(result.diagnostic);
        return result;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts(timeoutMs, intervalMs)) await sleep(intervalMs);
  }

  const result = failure(stage, failureClass, lastError, { url, status: lastStatus });
  stages.push(result.stage);
  diagnostics.push(result.diagnostic);
  return result;
}

function writeSettingsFile(path, settingsJson) {
  writeFileSync(path, JSON.stringify(settingsJson), 'utf8');
}

export async function reinitializeAndroidAfterClean({
  env,
  runAdb = defaultRunAdb,
  fetch: fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  settingsJson = { localSync: { enabled: true, port: 7878 } },
  tempSettingsPath = join(tmpdir(), 'biblioteca-settings.json'),
} = {}) {
  if (!env?.android?.packageName) throw new Error('android packageName is required');
  if (!env?.android?.serverUrl) throw new Error('android serverUrl is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  const stages = [];
  const diagnostics = [];
  const ready = { process: null, health: null, manifest: null, replicas: {} };
  const prefix = serialArgs(env);
  const pkg = env.android.packageName;
  const readestDir = env.android.readestDir || `/data/data/${pkg}/Readest`;

  const forward = await runStage({
    stages,
    diagnostics,
    name: 'adb.forward',
    failureClass: 'adb-forward-unavailable',
    action: () => runAdb([...prefix, 'forward', 'tcp:7878', 'tcp:7878']),
  });
  if (!forward.ok) return { ok: false, stages, diagnostics, ready };

  const settings = await runStage({
    stages,
    diagnostics,
    name: 'settings.inject',
    failureClass: 'settings-injection-failed',
    action: async () => {
      writeSettingsFile(tempSettingsPath, settingsJson);
      await runAdb([...prefix, 'push', tempSettingsPath, DEVICE_SETTINGS_PATH]);
      await runAdb([...prefix, 'shell', 'run-as', pkg, 'mkdir', '-p', readestDir]);
      await runAdb([...prefix, 'shell', 'run-as', pkg, 'cp', DEVICE_SETTINGS_PATH, `${readestDir}/settings.json`]);
    },
  });
  if (!settings.ok) return { ok: false, stages, diagnostics, ready };

  const start = await runStage({
    stages,
    diagnostics,
    name: 'android.start',
    failureClass: 'start-failed',
    action: () => runAdb([...prefix, 'shell', 'am', 'start', '-n', `${pkg}/.MainActivity`]),
  });
  if (!start.ok) return { ok: false, stages, diagnostics, ready };

  const process = await waitForProcess({ env, runAdb, sleep, timeoutMs, intervalMs, stages, diagnostics });
  if (!process.ok) return { ok: false, stages, diagnostics, ready };
  ready.process = process.value;

  const health = await waitForHttp({
    fetch: fetchImpl,
    sleep,
    timeoutMs,
    intervalMs,
    url: `${env.android.serverUrl}/health`,
    stage: 'android.health',
    failureClass: 'health-unreachable',
    emptyClass: 'health-empty-reply',
    stages,
    diagnostics,
  });
  if (!health.ok) return { ok: false, stages, diagnostics, ready };
  ready.health = health.value;

  const manifest = await waitForHttp({
    fetch: fetchImpl,
    sleep,
    timeoutMs,
    intervalMs,
    url: `${env.android.serverUrl}/books/manifest`,
    stage: 'android.manifest',
    failureClass: 'manifest-unreachable',
    stages,
    diagnostics,
  });
  if (!manifest.ok) return { ok: false, stages, diagnostics, ready };
  ready.manifest = manifest.value;

  for (const kind of REPLICA_KINDS) {
    const replica = await waitForHttp({
      fetch: fetchImpl,
      sleep,
      timeoutMs,
      intervalMs,
      url: `${env.android.serverUrl}/replicas/${kind}`,
      stage: `android.replica.${kind}`,
      failureClass: 'replica-api-unavailable',
      stages,
      diagnostics,
    });
    if (!replica.ok) return { ok: false, stages, diagnostics, ready };
    ready.replicas[kind] = replica.value;
  }

  return { ok: true, stages, diagnostics, ready };
}
