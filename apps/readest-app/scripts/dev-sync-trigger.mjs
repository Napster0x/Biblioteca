#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

const DEFAULT_KINDS = ['annotation', 'quote', 'dictionary-entry', 'dictionary-occurrence'];

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requireDevHarness() {
  if (process.env.BIBLIOTECA_DEV_SYNC_HARNESS !== '1' && process.env.NODE_ENV !== 'development') {
    throw new Error('dev sync trigger requires BIBLIOTECA_DEV_SYNC_HARNESS=1 or NODE_ENV=development');
  }
}

function createEvidence({ dryRun, peer, port, endpoint, response }) {
  const count = typeof response?.count === 'number' ? response.count : 0;
  return {
    ok: true,
    status: 'pass',
    command: 'dev:sync:trigger',
    dryRun,
    runId: response?.runId ?? `dev-sync-trigger-${Date.now()}`,
    timestamp: new Date().toISOString(),
    peer,
    port,
    endpoint,
    direction: 'bidirectional-local-usb',
    kinds: DEFAULT_KINDS,
    cursors: dryRun
      ? { before: 'not-read-in-dry-run', after: 'not-written-in-dry-run' }
      : { before: 'requested-from-debug-trigger', after: `counter:${count}` },
    hlc: dryRun ? { summary: 'not-touched-in-dry-run' } : { summary: 'reported-by-debug-sync-console' },
    outcome: dryRun ? 'dry-run' : 'trigger-requested',
  };
}

function nestedFailure(response) {
  if (response?.ok === false) return response.error ?? 'sync trigger reported ok:false';
  if (response?.syncResult?.ok === false) return response.syncResult.error ?? 'nested sync execution failed';
  if (response?.syncResult?.error) return response.syncResult.error;
  return '';
}

function nestedEvidencePath(response) {
  if (response?.ok === false) return 'response';
  if (response?.syncResult?.ok === false || response?.syncResult?.error) return 'syncResult';
  return '';
}

function hasCompleteSyncEvidence(response) {
  return Boolean(
    response?.syncResult?.evidence?.path
      || response?.syncResult?.evidencePath
      || response?.evidence?.syncResult
      || response?.evidence?.path,
  );
}

export function evaluateTriggerPayload({ httpOk, httpStatus, payload, endpoint, peer, port }) {
  if (!httpOk) {
    return createFailure({
      peer,
      port,
      endpoint,
      response: payload,
      message: `sync trigger failed: ${JSON.stringify(payload)}`,
    });
  }

  const failure = nestedFailure(payload);
  if (failure) {
    const path = nestedEvidencePath(payload) || 'response';
    return {
      ...createFailure({ peer, port, endpoint, response: payload?.syncResult ?? payload, message: failure }),
      httpStatus,
      evidence: { path, nested: payload?.syncResult ?? payload },
    };
  }

  if (!hasCompleteSyncEvidence(payload)) {
    return {
      ...createFailure({
        peer,
        port,
        endpoint,
        response: payload,
        message: 'missing trigger evidence: syncResult.evidence.path',
      }),
      httpStatus,
      evidence: {
        path: 'syncResult.evidence.path',
        nested: payload?.syncResult ?? payload,
        unavailable: ['syncResult.evidence.path'],
      },
    };
  }

  return { ok: true, status: 'pass', evidence: { path: payload.syncResult?.evidence?.path ?? payload.evidence?.path } };
}

function createFailure({ peer, port, endpoint, response, message }) {
  return {
    ok: false,
    status: 'fail',
    command: 'dev:sync:trigger',
    peer,
    port,
    endpoint,
    evidence: { nested: response },
    errors: [{ message }],
  };
}

async function main() {
  requireDevHarness();
  const dryRun = hasFlag('--dry-run');
  const port = Number.parseInt(readFlag('--port', '3000'), 10);
  const host = readFlag('--host', 'localhost');
  const peer = readFlag('--peer', 'usb:localhost:7878');
  const endpoint = `http://${host}:${port}/api/sync-trigger`;

  if (dryRun) {
    console.log(JSON.stringify(createEvidence({ dryRun, peer, port, endpoint }), null, 2));
    return;
  }

  let result;
  let response;
  try {
    result = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(3000) });
    response = await result.json();
  } catch (error) {
    console.log(JSON.stringify(createFailure({
      peer,
      port,
      endpoint,
      response: null,
      message: error instanceof Error ? error.message : String(error),
    }), null, 2));
    process.exit(1);
  }
  const evaluation = evaluateTriggerPayload({ httpOk: result.ok, httpStatus: result.status, payload: response, endpoint, peer, port });
  if (!evaluation.ok) {
    console.log(JSON.stringify(evaluation, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(createEvidence({ dryRun, peer, port, endpoint, response }), null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
