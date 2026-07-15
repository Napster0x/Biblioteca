import { join, resolve } from 'node:path';

export const CONFIRM_TOKEN = 'DELETE_DEV_SYNC_STATE';
export const DEV_SCOPE_MARKER = 'biblioteca-dev-sync';
export const DESKTOP_DEV_MARKER_FILE = '.biblioteca-dev-sync';

const DEFAULT_DESKTOP_DATA_ROOT = '/home/napster/.local/share/io.github.Napster0x.biblioteca.dev';
const DEFAULT_ANDROID_PACKAGE = 'io.github.Napster0x.biblioteca';
export const DEFAULT_ANDROID_PACKAGE_CANDIDATES = Object.freeze([
  'io.github.Napster0x.biblioteca',
  'io.github.Napster0x.biblioteca.dev',
]);
const DEFAULT_ANDROID_SERVER_URL = 'http://localhost:7878';
const DEFAULT_DESKTOP_SYNC_TRIGGER_URL = 'http://localhost:3000/api/sync-trigger';
const DEFAULT_DESKTOP_DEV_SYNC_HEALTH_URL = 'http://localhost:3000/api/dev-sync/health';

export function createSyncDevEnvironment(env = process.env) {
  const desktopDataRoot = resolve(
    env.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT || env.BIBLIOTECA_DEV_DESKTOP_DB_DIR || DEFAULT_DESKTOP_DATA_ROOT,
  );
  const androidPackage = env.BIBLIOTECA_DEV_ANDROID_PACKAGE || DEFAULT_ANDROID_PACKAGE;
  const androidSerial = env.BIBLIOTECA_DEV_ANDROID_SERIAL || '';
  const adbSerialArgs = androidSerial ? ['-s', androidSerial] : [];

  return {
    desktop: {
      dataRoot: desktopDataRoot,
      readestDir: join(desktopDataRoot, 'Readest'),
      devSyncHealthUrl: env.BIBLIOTECA_DEV_DESKTOP_DEV_SYNC_HEALTH_URL || DEFAULT_DESKTOP_DEV_SYNC_HEALTH_URL,
      syncTriggerUrl: env.BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL || DEFAULT_DESKTOP_SYNC_TRIGGER_URL,
    },
    android: {
      packageName: androidPackage,
      packageCandidates: env.BIBLIOTECA_DEV_ANDROID_PACKAGE
        ? [env.BIBLIOTECA_DEV_ANDROID_PACKAGE]
        : [...DEFAULT_ANDROID_PACKAGE_CANDIDATES],
      serial: androidSerial || null,
      readestDir: `/data/data/${androidPackage}/Readest`,
      serverUrl: env.BIBLIOTECA_DEV_ANDROID_SERVER_URL || DEFAULT_ANDROID_SERVER_URL,
      usbTunnel: {
        command: 'adb',
        args: [...adbSerialArgs, 'forward', 'tcp:7878', 'tcp:7878'],
        direction: 'host-to-android',
      },
    },
  };
}

export function resolveAndroidPackageTarget({ env = process.env, installedPackages = [] } = {}) {
  const override = env.BIBLIOTECA_DEV_ANDROID_PACKAGE || '';
  const candidates = override ? [override] : [...DEFAULT_ANDROID_PACKAGE_CANDIDATES];
  const knownCandidates = override && !DEFAULT_ANDROID_PACKAGE_CANDIDATES.includes(override)
    ? [override, ...DEFAULT_ANDROID_PACKAGE_CANDIDATES]
    : [...DEFAULT_ANDROID_PACKAGE_CANDIDATES];
  const installedCandidates = knownCandidates.filter((candidate) => installedPackages.includes(candidate));

  if (override) {
    return {
      status: 'pass',
      packageName: override,
      source: 'env',
      candidates,
      installedCandidates,
      message: `using Android package override ${override}`,
    };
  }

  if (installedCandidates.length > 0) {
    const packageName = installedCandidates[0];
    return {
      status: 'pass',
      packageName,
      source: 'installed-candidate',
      candidates,
      installedCandidates,
      message: `selected installed Android package ${packageName}`,
    };
  }

  return {
    status: 'fail',
    packageName: null,
    source: 'installed-candidate',
    candidates,
    installedCandidates,
    message: `No supported Android package found. Checked: ${candidates.join(', ')}`,
  };
}

export function parsePidofOutput(stdout) {
  const pid = typeof stdout === 'string' ? stdout.trim().split(/\s+/).filter(Boolean)[0] : null;
  if (pid) {
    return {
      status: 'pass',
      pid,
      failureClass: null,
      message: `Android app process is running with PID ${pid}`,
    };
  }
  return {
    status: 'fail',
    pid: null,
    failureClass: 'app-process-absent',
    message: 'Android app process is not running',
  };
}

export function classifyAndroidHealthFailure(failure) {
  if (failure && typeof failure === 'object' && typeof failure.status === 'number') {
    return {
      status: 'fail',
      failureClass: 'http-error',
      message: `Android /health returned HTTP ${failure.status}`,
    };
  }

  const name = failure && typeof failure === 'object' && 'name' in failure ? String(failure.name) : '';
  const message = failure instanceof Error ? failure.message : String(failure ?? 'unknown error');
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('econnrefused') || lowerMessage.includes('connection refused')) {
    return {
      status: 'fail',
      failureClass: 'port-refused',
      message: 'Android /health port refused',
    };
  }

  if (name === 'TimeoutError' || name === 'AbortError' || lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return {
      status: 'fail',
      failureClass: 'timeout',
      message: 'Android /health timed out',
    };
  }

  return {
    status: 'fail',
    failureClass: 'unknown',
    message: `Android /health failed: ${message}`,
  };
}

export function requireDevHarness(env = process.env, action = 'dev sync operation') {
  if (env.BIBLIOTECA_DEV_SYNC_HARNESS !== '1' && env.NODE_ENV !== 'development') {
    throw new Error(`${action} requires BIBLIOTECA_DEV_SYNC_HARNESS=1 or NODE_ENV=development`);
  }
}

/**
 * Parse version metadata from an Android `/health` response body.
 *
 * Reports which of `serverVersion`, `commit`, and `startedAt` are present.
 * Returns `found: false` when the body is missing, not an object, or contains
 * none of those fields — the caller can use this to decide whether to warn.
 *
 * This function is PURE. It only reads the body argument and returns a
 * deterministic result without side effects.
 */
export function parseHealthVersion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return EMPTY_VERSION;
  const fields = [];
  if (body.serverVersion !== undefined) fields.push('serverVersion');
  if (body.commit !== undefined) fields.push('commit');
  if (body.startedAt !== undefined) fields.push('startedAt');
  return {
    found: fields.length > 0,
    fields,
    serverVersion: body.serverVersion ?? null,
    commit: body.commit ?? null,
    startedAt: body.startedAt ?? null,
  };
}

const EMPTY_VERSION = Object.freeze({
  found: false,
  fields: [],
  serverVersion: null,
  commit: null,
  startedAt: null,
});

/**
 * Parse the output of `adb forward --list` to find USB tunnels.
 *
 * Returns structured result with:
 * - found: whether at least one tunnel matches expectedLocal/expectedRemote
 * - tunnels: all parsed tunnel entries
 * - tunnelForSerial: the matching tunnel for the given serial (or null)
 *
 * This function is PURE. It only reads the stdout string and returns a
 * deterministic result without side effects.
 */
export function parseAdbForwardList(stdout, expectedLocal = 'tcp:7878', expectedRemote = 'tcp:7878', serial = null) {
  const tunnels = [];
  if (!stdout || typeof stdout !== 'string') {
    return { found: false, tunnels: [], tunnelForSerial: null };
  }
  for (const line of stdout.trim().split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3) {
      tunnels.push({
        serial: parts[0],
        local: parts[parts.length - 2],
        remote: parts[parts.length - 1],
      });
    }
  }
  const matching = tunnels.filter((t) => t.local === expectedLocal && t.remote === expectedRemote);
  const serialMatch = serial
    ? matching.filter((t) => t.serial === serial)
    : matching;
  const tunnelForSerial = serial ? (serialMatch[0] ?? null) : (matching[0] ?? null);
  return {
    found: serialMatch.length > 0,
    tunnels,
    tunnelForSerial,
  };
}

/**
 * Parse settings.json content for localSync toggle state.
 *
 * Returns { enabled, port } where enabled is boolean and port is number or null.
 * This function is PURE — it only reads the content string.
 */
export function parseToggleState(content) {
  if (!content || typeof content !== 'string') {
    return { enabled: false, port: null };
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.localSync && typeof parsed.localSync === 'object') {
      return {
        enabled: parsed.localSync.enabled === true,
        port: typeof parsed.localSync.port === 'number' ? parsed.localSync.port : null,
      };
    }
    return { enabled: false, port: null };
  } catch {
    return { enabled: false, port: null };
  }
}

/**
 * Check for contradictions between toggle state and device health.
 *
 * If toggle says enabled but one or both devices are unreachable,
 * the verdict is AMBIGUOUS — the operator intended sync but the
 * environment is not ready.
 *
 * This function is PURE — deterministic result from inputs.
 */
export function detectToggleContradiction(toggle, health) {
  if (!toggle.enabled) {
    return { hasContradiction: false, verdict: 'clean', detail: '' };
  }
  if (health.desktopOk && health.androidOk) {
    return { hasContradiction: false, verdict: 'clean', detail: 'Toggle ON and both devices reachable' };
  }
  const components = [];
  if (!health.desktopOk) components.push('desktop');
  if (!health.androidOk) components.push('android');
  return {
    hasContradiction: true,
    verdict: 'AMBIGUOUS',
    detail: `Toggle is ON but ${components.join(' and ')} health check${components.length > 1 ? 's' : ''} failed`,
  };
}

/**
 * File paths for SQLite DB files on desktop.
 * Keys match the kind names used in state capture sqlite section.
 */
export const DB_FILES = ['annotations.db', 'citas.db', 'dictionary.db'];

/**
 * Replica kinds exposed by the Android /replicas/:kind API.
 */
export const REPLICA_KINDS = ['annotation', 'quote', 'dictionary-entry', 'dictionary-occurrence'];

/**
 * Map state-capture sqlite key to the corresponding DB filename.
 */
export const DB_KIND_MAP = {
  annotations: 'annotations.db',
  quotes: 'citas.db',
  dictionary: 'dictionary.db',
};
