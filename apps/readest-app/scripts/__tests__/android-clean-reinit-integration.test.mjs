#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { cleanAndroid } from '../dev-sync-reset.mjs';
import { preparePhase2CaseExecution, spawnAndroidClean } from '../dev-sync-cycle.mjs';
import { prepareAndroidForSync } from '../dev-sync-up.mjs';

function createEnv() {
  return {
    android: {
      packageName: 'io.github.Napster0x.biblioteca.dev',
      serial: 'device-1',
      readestDir: '/data/data/io.github.Napster0x.biblioteca.dev/Readest',
      serverUrl: 'http://localhost:7878',
    },
  };
}

describe('Android clean reinitialize integration', () => {
  it('reset reports android-db not ready when post-pm-clear reinitialize fails', async () => {
    const adbCalls = [];
    const result = await cleanAndroid({
      dryRun: false,
      env: createEnv(),
      runAdb: async (args) => {
        adbCalls.push(args);
        if (args.includes('pidof')) return '';
        return 'ok\n';
      },
      fetch: async () => { throw new Error('health unreachable'); },
      sleep: async () => {},
      reinitializeTimeoutMs: 10,
      reinitializeIntervalMs: 1,
    });

    assert.equal(result.pmClearDone, true);
    assert.equal(result.reinitialize.ok, false);
    assert.equal(result.errors.at(-1).command, 'android reinitialize after pm clear');
    assert.equal(result.errors.at(-1).stage, 'android.process');
    assert.equal(result.counts.remaining, result.errors.length);
    assert.deepEqual(adbCalls.slice(0, 2), [
      ['version'],
      ['-s', 'device-1', 'shell', 'pm', 'clear', 'io.github.Napster0x.biblioteca.dev'],
    ]);
  });

  it('cycle clean-android fails from reset reinitialize diagnostics before case execution', async () => {
    const result = await spawnAndroidClean(
      { BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      createEnv(),
      {
        runReset: async () => ({
          ok: false,
          reinitialize: {
            ok: false,
            diagnostics: [{ stage: 'android.manifest', class: 'manifest-unreachable', message: 'manifest down' }],
          },
          errors: [{ command: 'android reinitialize after pm clear', stage: 'android.manifest', message: 'manifest down' }],
        }),
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.reinitialize.diagnostics[0].class, 'manifest-unreachable');
    assert.match(result.error, /android\.manifest.*manifest-unreachable/);
  });

  it('cycle clean-android success requires fresh preflight before case execution starts', async () => {
    const events = [];
    const result = await preparePhase2CaseExecution({
      cleanAndroid: true,
      stateEnv: { BIBLIOTECA_DEV_SYNC_HARNESS: '1' },
      env: createEnv(),
      runAndroidClean: async () => {
        events.push('clean-reinitialize');
        return { ok: true, reinitialize: { ok: true } };
      },
      runFreshPreflight: () => {
        events.push('fresh-preflight-pass');
        return { name: 'phase2.preflight', status: 'pass' };
      },
    });
    events.push('case-branch-start');

    assert.equal(result.ok, true);
    assert.deepEqual(events, ['clean-reinitialize', 'fresh-preflight-pass', 'case-branch-start']);
  });

  it('up reports Android not ready when the shared readiness helper fails', async () => {
    const result = await prepareAndroidForSync({
      env: createEnv(),
      reinitialize: async () => ({
        ok: false,
        diagnostics: [{ stage: 'android.replica.quote', class: 'replica-api-unavailable', message: 'quote API down' }],
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].class, 'replica-api-unavailable');
  });
});
