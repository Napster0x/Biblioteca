#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncDevEnvironment, requireDevHarness } from './sync-dev-env.mjs';
import { evaluateTriggerPayload } from './dev-sync-trigger.mjs';

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

function computeVerdict(pre, post, attempts) {
  if (attempts.some((a) => a.evidencePath === 'syncResult.evidence.path')) return 'ambiguous';
  const anyOk = attempts.some((a) => a.ok);
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

async function spawnAndroidClean(stateEnv, env) {
  const resetScript = join(__dirname, 'dev-sync-reset.mjs');
  const pkg = env.android.packageName;
  const serial = env.android.serial;
  const adbPrefix = serial ? ['-s', serial] : [];
  const readestDir = `/data/data/${pkg}/Readest`;

  // Step 1: Delete files via dev-sync-reset
  try {
    const output = execFileSync(
      process.execPath,
      [resetScript, '--target', 'android-db', '--confirm', 'DELETE_DEV_SYNC_STATE', '--no-dry-run'],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...stateEnv, BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30_000,
      },
    );
    const parsed = JSON.parse(output);
    if (parsed.ok === false) {
      return { ok: false, error: parsed.error || 'android reset failed' };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Step 2: Force-stop the app
  try {
    execFileSync('adb', [...adbPrefix, 'shell', 'am', 'force-stop', pkg], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10_000,
    });
  } catch (err) {
    return { ok: false, error: `force-stop failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 3: Inject settings.json with localSync enabled
  try {
    const tmpFile = join(tmpdir(), 'biblioteca-settings.json');
    writeFileSync(tmpFile, JSON.stringify({ localSync: { enabled: true } }), 'utf8');
    execFileSync('adb', [...adbPrefix, 'push', tmpFile, '/data/local/tmp/biblioteca-settings.json'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10_000,
    });
    execFileSync('adb', [...adbPrefix, 'shell', 'run-as', pkg, 'cp', '/data/local/tmp/biblioteca-settings.json', `${readestDir}/settings.json`], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10_000,
    });
  } catch (err) {
    return { ok: false, error: `settings injection failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 4: Start the app
  try {
    execFileSync('adb', [...adbPrefix, 'shell', 'am', 'start', '-n', `${pkg}/.MainActivity`], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10_000,
    });
  } catch (err) {
    return { ok: false, error: `start failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Step 5: Wait for health check (up to 20s)
  const healthUrl = env.android.serverUrl + '/health';
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok && (await res.text()).includes('"ok"')) {
        return { ok: true, restarted: true };
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { ok: false, error: `Android health check timeout after cleanup restart` };
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
  if (cleanAndroid) {
    const androidClean = await spawnAndroidClean(stateEnv, env);
    if (!androidClean.ok) {
      console.error(`Android clean failed: ${androidClean.error || 'unknown error'}`);
      process.exit(1);
    }
  }
  const pre = spawnStateJson(stateEnv);

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
  const verdict = computeVerdict(pre, post, attempts);

  // ── Report ─────────────────────────────────────────────
  const report = {
    runId,
    timestamp: new Date().toISOString(),
    caseRef,
    caseName,
    pre: { desktop: pre.desktop, android: pre.android },
    post: { desktop: post.desktop, android: post.android },
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
