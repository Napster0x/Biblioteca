import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reinitializeAndroidAfterClean } from './android-clean-reinit.mjs';
import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';

const env = createSyncDevEnvironment();
const DESKTOP_HEALTH = env.desktop.devSyncHealthUrl;

async function fetchOk(url, timeout = 3000) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (resp.ok) return await resp.json().catch(() => ({}));
  } catch {}
  return null;
}

async function waitFor(url, label, maxSec = 45) {
  for (let i = 0; i < maxSec / 3; i++) {
    const body = await fetchOk(url);
    if (body) {
      console.log(`  ✅ ${label}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`  ❌ ${label}`);
  return false;
}

function writeDesktopToggle() {
  const dir = join(env.desktop.dataRoot, 'Readest');
  const path = join(dir, 'settings.json');
  mkdirSync(dir, { recursive: true });
  let s = {};
  if (existsSync(path)) { try { s = JSON.parse(readFileSync(path, 'utf8')); } catch {} }
  s.localSync = { ...(s.localSync || {}), enabled: true, port: 7878 };
  writeFileSync(path, JSON.stringify(s, null, 2));
  console.log(`✅ Desktop toggle ON`);
}

export async function prepareAndroidForSync({
  env: syncEnv = env,
  reinitialize = reinitializeAndroidAfterClean,
} = {}) {
  const result = await reinitialize({ env: syncEnv });
  return {
    ok: result.ok === true,
    diagnostics: result.diagnostics || [],
    stages: result.stages || [],
    ready: result.ready,
  };
}

async function main() {
  requireDevHarness(process.env, 'dev-sync-up');
  console.log('=== dev:sync:up ===\n');

  try { execSync('adb reverse tcp:7878 tcp:7878', { stdio: 'pipe' }); console.log('✅ adb reverse'); }
  catch { console.log('❌ adb reverse'); process.exit(1); }

  writeDesktopToggle();

  const dOk = await fetchOk(DESKTOP_HEALTH, 2000);
  if (!dOk) {
    console.log('⏳ Starting dev:server...');
    const { spawn } = await import('node:child_process');
    spawn('pnpm', ['dev:server'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore', detached: true }).unref();
  }
  await waitFor(DESKTOP_HEALTH, 'Desktop (:3000)');

  console.log('');
  const androidReady = await prepareAndroidForSync({ env });
  if (androidReady.ok) console.log('📱 Android launched and ready');
  else console.log(`❌ Android readiness failed: ${androidReady.diagnostics[0]?.message || 'unknown error'}`);

  const dReady = (await fetchOk(DESKTOP_HEALTH)) !== null;
  const aReady = androidReady.ok;
  console.log(`\nDesktop: ${dReady ? '✅' : '❌'}  Android: ${aReady ? '✅' : '❌'}`);
  if (dReady && aReady) { console.log('\n🚀 Ready. pnpm dev:sync:doctor'); process.exit(0); }
  else { process.exit(1); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
