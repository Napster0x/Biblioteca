import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function doctorScriptPath() {
  const url = new URL('./dev-sync-doctor.mjs', import.meta.url);
  return url.protocol === 'file:' ? fileURLToPath(url) : url.pathname;
}

function parseDoctorPayload(stdout) {
  try {
    return JSON.parse(stdout || '{}');
  } catch (error) {
    throw new Error(`Phase 2 preflight blocked: doctor returned invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function formatFailure(failure) {
  return [failure.name, failure.status, failure.failureClass].filter(Boolean).join(':');
}

function describeBlockedGate(gate) {
  const failures = Array.isArray(gate.failures) && gate.failures.length > 0
    ? ` (${gate.failures.map(formatFailure).join(', ')})`
    : '';
  return `${gate.message || 'phase2.preflight did not pass'}${failures}`;
}

export function assertPhase2Preflight(payload) {
  const gate = Array.isArray(payload?.checks)
    ? payload.checks.find((item) => item?.name === 'phase2.preflight')
    : null;

  if (!gate) {
    throw new Error('Phase 2 preflight blocked: phase2.preflight did not run');
  }
  if (gate.status !== 'pass') {
    throw new Error(`Phase 2 preflight blocked: ${describeBlockedGate(gate)}`);
  }
  return gate;
}

export function runPhase2Preflight({
  runDoctor = () => execFileSync(process.execPath, [doctorScriptPath(), '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  }),
} = {}) {
  let stdout;
  try {
    stdout = runDoctor();
  } catch (error) {
    stdout = error?.stdout;
    if (!stdout) {
      throw new Error(`Phase 2 preflight blocked: doctor failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const payload = parseDoctorPayload(stdout);
  return assertPhase2Preflight(payload);
}
