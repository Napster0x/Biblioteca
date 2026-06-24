#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncDevEnvironment, parseHealthVersion, parseAdbForwardList, parseToggleState, detectToggleContradiction, REPLICA_KINDS } from './sync-dev-env.mjs';

function hasFlag(name) {
  return process.argv.includes(name);
}

function check(name, status, message, details = {}) {
  return { name, status, message, ...details };
}

function run(command, args) {
  try {
    return { ok: true, stdout: execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (error) {
    return { ok: false, stdout: '', message: error instanceof Error ? error.message : String(error) };
  }
}

function desktopSqlite3Check() {
  const result = run('sqlite3', ['--version']);
  return check(
    'desktop.sqlite3Cli',
    result.ok ? 'pass' : 'warn',
    result.ok ? `sqlite3 CLI available: ${result.stdout.trim().split('\n')[0]}` : 'sqlite3 CLI not found in PATH; row-level DB capture unavailable',
  );
}

function androidSqlite3Check(env) {
  // Check if adb is available first
  const adbCheck = run('adb', ['version']);
  if (!adbCheck.ok) {
    return check('android.sqlite3Cli', 'warn', 'cannot check sqlite3 on device: adb unavailable');
  }

  const target = process.env.BIBLIOTECA_DEV_ANDROID_SERIAL || '';
  const serialArgs = target ? ['-s', target] : [];
  const result = run('adb', [...serialArgs, 'shell', 'run-as', env.android.packageName, 'which', 'sqlite3']);
  return check(
    'android.sqlite3Cli',
    result.ok ? 'pass' : 'warn',
    result.ok ? 'sqlite3 found on Android device' : `sqlite3 not found on device for ${env.android.packageName}; row-level capture will be unavailable on Android`,
  );
}

async function androidReplicasApiCheck(serverUrl) {
  let reachableCount = 0;
  let errorCount = 0;

  for (const kind of REPLICA_KINDS) {
    try {
      const response = await fetch(`${serverUrl}/replicas/${kind}`, { signal: AbortSignal.timeout(750) });
      if (response.ok) {
        reachableCount++;
      } else {
        errorCount++;
      }
    } catch {
      errorCount++;
    }
  }

  if (reachableCount === REPLICA_KINDS.length) {
    return check('android.replicasApi', 'pass', `all ${REPLICA_KINDS.length} replica endpoints reachable`);
  }
  if (reachableCount > 0) {
    return check('android.replicasApi', 'warn', `${reachableCount}/${REPLICA_KINDS.length} replica endpoints reachable`);
  }
  return check('android.replicasApi', 'warn', `replica API unreachable at ${serverUrl}; replica inspection unavailable`);
}

function adbChecks(env) {
  const checks = [];
  const version = run('adb', ['version']);
  checks.push(
    check(
      'adb.available',
      version.ok ? 'pass' : 'fail',
      version.ok ? 'adb is available' : 'adb unavailable; install Android SDK platform-tools',
    ),
  );

  if (!version.ok) {
    checks.push(check('android.device', 'fail', 'cannot inspect devices because adb is unavailable'));
    checks.push(check('android.runAs', 'fail', `cannot verify run-as ${env.android.packageName}`));
    checks.push(check('android.readestDir', 'fail', `cannot verify ${env.android.readestDir}`));
    return checks;
  }

  const devices = run('adb', ['devices']);
  const ids = devices.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map((parts) => parts[0]);
  const target = process.env.BIBLIOTECA_DEV_ANDROID_SERIAL || ids[0] || '';
  const deviceStatus = ids.length === 1 || target ? 'pass' : 'fail';
  checks.push(
    check(
      'android.device',
      deviceStatus,
      ids.length === 0
        ? 'no connected Android device detected'
        : `connected devices: ${ids.length}; target: ${target || 'unselected'}`,
      { count: ids.length, target },
    ),
  );

  const serialArgs = target ? ['-s', target] : [];
  const runAs = run('adb', [...serialArgs, 'shell', 'run-as', env.android.packageName, 'pwd']);
  checks.push(
    check(
      'android.runAs',
      runAs.ok ? 'pass' : 'fail',
      runAs.ok ? `run-as works for ${env.android.packageName}` : `run-as failed for ${env.android.packageName}`,
    ),
  );
  const readest = run('adb', [...serialArgs, 'shell', 'run-as', env.android.packageName, 'test', '-d', env.android.readestDir]);
  checks.push(
    check(
      'android.readestDir',
      readest.ok ? 'pass' : 'fail',
      readest.ok ? `${env.android.readestDir} exists` : `${env.android.readestDir} is missing or inaccessible`,
    ),
  );
  return checks;
}

async function endpointCheck(name, url, failWhenDown) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(750) });
    return check(name, response.ok ? 'pass' : failWhenDown ? 'fail' : 'warn', `${url} returned ${response.status}`);
  } catch (error) {
    return check(
      name,
      failWhenDown ? 'fail' : 'warn',
      `${url} unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function androidHealthCheck(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(750) });
    if (!response.ok) {
      return check('android.health', 'fail', `/health returned ${response.status}`);
    }
    const body = await response.json().catch(() => null);
    const version = parseHealthVersion(body);
    if (version.found) {
      const label = [version.serverVersion, version.commit].filter(Boolean).join('/') || 'unknown';
      return check('android.health', 'pass', `/health OK — runtime ${label}`, { version });
    }
    return check('android.health', 'warn', '/health OK but response lacks serverVersion, commit, or startedAt', {
      version,
    });
  } catch (error) {
    return check(
      'android.health',
      'fail',
      `/health unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function adbForwardCheck(env) {
  const version = run('adb', ['version']);
  if (!version.ok) {
    return check('adb.forward', 'warn', 'cannot check ADB forward: adb unavailable');
  }

  const serial = process.env.BIBLIOTECA_DEV_ANDROID_SERIAL || '';
  const serialArgs = serial ? ['-s', serial] : [];
  const result = run('adb', [...serialArgs, 'forward', '--list']);
  if (!result.ok) {
    return check('adb.forward', 'warn', 'adb forward --list failed', { error: result.message });
  }

  const parsed = parseAdbForwardList(result.stdout, 'tcp:7878', 'tcp:7878', serial || null);
  if (parsed.found) {
    const tunnelInfo = serial
      ? `tunnel on ${serial}: tcp:7878 → tcp:7878`
      : `${parsed.tunnelForSerial ? parsed.tunnelForSerial.serial + ' ' : ''}tcp:7878 → tcp:7878`;
    return check('adb.forward', 'pass', `USB tunnel active — ${tunnelInfo}`, { tunnels: parsed.tunnels });
  }
  if (parsed.tunnels.length > 0) {
    return check('adb.forward', 'warn', 'ADB tunnels exist but none match expected tcp:7878 → tcp:7878', {
      tunnels: parsed.tunnels,
    });
  }
  return check('adb.forward', 'warn', 'No ADB port forwarding rules found');
}

async function toggleContradictionCheck(env) {
  // Read desktop settings.json for toggle state
  const settingsPath = join(env.desktop.readestDir, 'settings.json');
  let desktopToggle = { enabled: false, port: null };
  if (existsSync(settingsPath)) {
    try {
      const content = readFileSync(settingsPath, 'utf8');
      desktopToggle = parseToggleState(content);
    } catch {
      // settings unreadable — toggle defaults to off
    }
  }

  // Health status from previously collected checks is not available here,
  // so we re-check the endpoints for the contradiction check.
  let desktopOk = false;
  let androidOk = false;
  try {
    const dResp = await fetch(env.desktop.devSyncHealthUrl, { signal: AbortSignal.timeout(750) });
    desktopOk = dResp.ok;
  } catch {
    // desktop unreachable
  }
  try {
    const aResp = await fetch(`${env.android.serverUrl}/health`, { signal: AbortSignal.timeout(750) });
    androidOk = aResp.ok;
  } catch {
    // android unreachable
  }

  const contradiction = detectToggleContradiction(desktopToggle, { desktopOk, androidOk });
  if (contradiction.hasContradiction) {
    return check('discovery.toggle', 'warn', contradiction.detail, {
      toggle: desktopToggle,
      desktopOk,
      androidOk,
    });
  }
  return check('discovery.toggle', 'pass', desktopToggle.enabled
    ? 'Toggle ON and both devices reachable — no contradiction'
    : 'Toggle OFF — no contradiction expected',
  { toggle: desktopToggle });
}

async function main() {
  const env = createSyncDevEnvironment();
  const checks = [...adbChecks(env)];

  checks.push(await androidHealthCheck(env.android.serverUrl));
  checks.push(await endpointCheck('android.manifest', `${env.android.serverUrl}/books/manifest`, true));
  checks.push(
    check(
      'desktop.dataRoot',
      existsSync(env.desktop.dataRoot) ? 'pass' : 'fail',
      existsSync(env.desktop.dataRoot) ? `${env.desktop.dataRoot} exists` : `${env.desktop.dataRoot} is missing`,
    ),
  );
  checks.push(
    check(
      'desktop.readestDir',
      existsSync(env.desktop.readestDir) ? 'pass' : 'fail',
      existsSync(env.desktop.readestDir) ? `${env.desktop.readestDir} exists` : `${env.desktop.readestDir} is missing`,
    ),
  );
  checks.push(await endpointCheck('desktop.devSyncHealth', env.desktop.devSyncHealthUrl, false));
  checks.push(await endpointCheck('desktop.syncTrigger', env.desktop.syncTriggerUrl, false));

  // ── Extended checks ──────────────────────────────────
  checks.push(desktopSqlite3Check());
  checks.push(androidSqlite3Check(env));
  checks.push(await androidReplicasApiCheck(env.android.serverUrl));
  checks.push(adbForwardCheck(env));
  checks.push(await toggleContradictionCheck(env));

  const status = checks.some((item) => item.status === 'fail')
    ? 'fail'
    : checks.some((item) => item.status === 'warn')
      ? 'warn'
      : 'pass';
  const payload = {
    ok: status === 'pass',
    status,
    environment: env,
    checks,
    actions: checks.filter((item) => item.status !== 'pass').map((item) => item.message),
  };

  if (hasFlag('--json') || !process.stdout.isTTY) {
    console.log(JSON.stringify(payload, null, 2));
    if (status === 'fail') process.exitCode = 1;
    return;
  }

  for (const item of checks) console.log(`${item.status.toUpperCase()} ${item.name}: ${item.message}`);
  if (status === 'fail') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
