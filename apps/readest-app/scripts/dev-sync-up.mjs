import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';

const env = createSyncDevEnvironment();
const DESKTOP_HEALTH = env.desktop.devSyncHealthUrl;
const ANDROID_HEALTH = `${env.android.serverUrl}/health`;
const ANDROID_PKG = env.android.packageName;
const ANDROID_READEST = env.android.readestDir;

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

function writeAndroidToggle() {
  const json = JSON.stringify({ localSync: { enabled: true, port: 7878 } });
  execSync(`adb shell 'echo '"'"'${json}'"'"' | run-as ${ANDROID_PKG} sh -c '"'"'mkdir -p ${ANDROID_READEST} && cat > ${ANDROID_READEST}/settings.json'"'"''`, { stdio: 'pipe' });
  console.log(`✅ Android toggle ON`);
}

async function main() {
  requireDevHarness(process.env, 'dev-sync-up');
  console.log('=== dev:sync:up ===\n');

  try { execSync('adb reverse tcp:7878 tcp:7878', { stdio: 'pipe' }); console.log('✅ adb reverse'); }
  catch { console.log('❌ adb reverse'); process.exit(1); }

  writeDesktopToggle();
  try { writeAndroidToggle(); } catch { console.log('⚠️ Android settings write failed'); }

  const dOk = await fetchOk(DESKTOP_HEALTH, 2000);
  if (!dOk) {
    console.log('⏳ Starting dev:server...');
    const { spawn } = await import('node:child_process');
    spawn('pnpm', ['dev:server'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore', detached: true }).unref();
  }
  await waitFor(DESKTOP_HEALTH, 'Desktop (:3000)');

  console.log('');
  execSync(`adb shell am start -n ${ANDROID_PKG}/.MainActivity`, { stdio: 'pipe' });
  console.log('📱 Android launched');
  await waitFor(ANDROID_HEALTH, 'Android (:7878)', 60);

  const dReady = (await fetchOk(DESKTOP_HEALTH)) !== null;
  const aReady = (await fetchOk(ANDROID_HEALTH)) !== null;
  console.log(`\nDesktop: ${dReady ? '✅' : '❌'}  Android: ${aReady ? '✅' : '❌'}`);
  if (dReady && aReady) { console.log('\n🚀 Ready. pnpm dev:sync:doctor'); process.exit(0); }
  else { process.exit(1); }
}

main().catch(err => { console.error(err.message); process.exit(1); });
