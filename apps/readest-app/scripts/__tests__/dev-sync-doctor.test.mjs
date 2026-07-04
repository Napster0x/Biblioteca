#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  classifyAndroidHealthFailure,
  parseAdbForwardList,
  parsePidofOutput,
  resolveAndroidPackageTarget,
} from '../sync-dev-env.mjs';

import {
  buildPhase2PreflightGate,
  normalizeDiagnosticAction,
} from '../dev-sync-doctor.mjs';

describe('dev sync doctor diagnostics helpers', () => {
  it('prefers an explicit Android package override and reports visible candidates', () => {
    const target = resolveAndroidPackageTarget({
      env: { BIBLIOTECA_DEV_ANDROID_PACKAGE: 'io.github.Napster0x.biblioteca.dev' },
      installedPackages: ['io.github.Napster0x.biblioteca', 'io.github.Napster0x.biblioteca.dev'],
    });

    assert.deepEqual(target, {
      status: 'pass',
      packageName: 'io.github.Napster0x.biblioteca.dev',
      source: 'env',
      candidates: ['io.github.Napster0x.biblioteca.dev'],
      installedCandidates: ['io.github.Napster0x.biblioteca', 'io.github.Napster0x.biblioteca.dev'],
      message: 'using Android package override io.github.Napster0x.biblioteca.dev',
    });
  });

  it('selects an installed known package and fails when no package candidate is visible', () => {
    const selected = resolveAndroidPackageTarget({
      env: {},
      installedPackages: ['io.github.Napster0x.biblioteca.dev'],
    });
    assert.equal(selected.status, 'pass');
    assert.equal(selected.packageName, 'io.github.Napster0x.biblioteca.dev');
    assert.equal(selected.source, 'installed-candidate');
    assert.deepEqual(selected.installedCandidates, ['io.github.Napster0x.biblioteca.dev']);

    const missing = resolveAndroidPackageTarget({ env: {}, installedPackages: [] });
    assert.equal(missing.status, 'fail');
    assert.equal(missing.packageName, null);
    assert.match(missing.message, /No supported Android package/);
  });

  it('parses PID output and marks an absent app process distinctly', () => {
    assert.deepEqual(parsePidofOutput(' 12345\n'), {
      status: 'pass',
      pid: '12345',
      failureClass: null,
      message: 'Android app process is running with PID 12345',
    });

    assert.deepEqual(parsePidofOutput('\n'), {
      status: 'fail',
      pid: null,
      failureClass: 'app-process-absent',
      message: 'Android app process is not running',
    });
  });

  it('parses serial-scoped adb forward output for matching and mismatched tunnels', () => {
    const parsed = parseAdbForwardList(
      'emulator-5554 tcp:7878 tcp:7878\nZX1 tcp:9999 tcp:7878\n',
      'tcp:7878',
      'tcp:7878',
      'emulator-5554',
    );

    assert.equal(parsed.found, true);
    assert.deepEqual(parsed.tunnelForSerial, {
      serial: 'emulator-5554',
      local: 'tcp:7878',
      remote: 'tcp:7878',
    });
    assert.equal(parsed.tunnels.length, 2);

    const wrongSerial = parseAdbForwardList('ZX1 tcp:7878 tcp:7878\n', 'tcp:7878', 'tcp:7878', 'emulator-5554');
    assert.equal(wrongSerial.found, false);
    assert.equal(wrongSerial.tunnelForSerial, null);
    assert.equal(wrongSerial.tunnels.length, 1);
  });

  it('classifies refused and timeout health failures without collapsing them to unknown', () => {
    assert.deepEqual(classifyAndroidHealthFailure(new Error('connect ECONNREFUSED 127.0.0.1:7878')), {
      status: 'fail',
      failureClass: 'port-refused',
      message: 'Android /health port refused',
    });

    assert.deepEqual(classifyAndroidHealthFailure(new DOMException('The operation was aborted', 'TimeoutError')), {
      status: 'fail',
      failureClass: 'timeout',
      message: 'Android /health timed out',
    });
  });

  it('classifies HTTP status failures separately from transport failures', () => {
    assert.deepEqual(classifyAndroidHealthFailure({ status: 503 }), {
      status: 'fail',
      failureClass: 'http-error',
      message: 'Android /health returned HTTP 503',
    });
  });
});

describe('dev sync doctor Phase 2 preflight gate', () => {
  const passingChecks = [
    { name: 'android.package', status: 'pass', packageName: 'io.github.Napster0x.biblioteca.dev', serial: 'device-1' },
    { name: 'android.process', status: 'pass', packageName: 'io.github.Napster0x.biblioteca.dev', pid: '12345' },
    { name: 'adb.forward', status: 'pass', tunnels: [{ serial: 'device-1', local: 'tcp:7878', remote: 'tcp:7878' }] },
    { name: 'android.health', status: 'pass' },
    { name: 'android.manifest', status: 'pass' },
    { name: 'desktop.devSyncHealth', status: 'pass' },
  ];

  it('passes only when every required Android and desktop readiness check is pass', () => {
    assert.deepEqual(buildPhase2PreflightGate(passingChecks), {
      name: 'phase2.preflight',
      status: 'pass',
      message: 'Phase 2 preflight passed; case execution may start',
      requiredChecks: [
        'android.package',
        'android.process',
        'adb.forward',
        'android.health',
        'android.manifest',
        'desktop.devSyncHealth',
      ],
      failures: [],
    });
  });

  it('blocks Phase 2 and preserves absent-process evidence', () => {
    const gate = buildPhase2PreflightGate([
      passingChecks[0],
      {
        name: 'android.process',
        status: 'fail',
        packageName: 'io.github.Napster0x.biblioteca.dev',
        pid: null,
        failureClass: 'app-process-absent',
        message: 'Android app process is not running',
      },
      ...passingChecks.slice(2),
    ]);

    assert.equal(gate.status, 'fail');
    assert.deepEqual(gate.failures, [
      {
        name: 'android.process',
        status: 'fail',
        failureClass: 'app-process-absent',
        message: 'Android app process is not running',
      },
    ]);
  });

  it('normalizes recovery actions without collapsing refused and timeout failures', () => {
    assert.equal(
      normalizeDiagnosticAction({ name: 'android.process', failureClass: 'app-process-absent', packageName: 'io.github.Napster0x.biblioteca.dev' }),
      'Start io.github.Napster0x.biblioteca.dev on the Android device before rerunning Phase 2.',
    );
    assert.equal(
      normalizeDiagnosticAction({ name: 'android.health', failureClass: 'port-refused' }),
      'Android /health refused the forwarded port; verify the app is rebuilt/redeployed, running, and listening on tcp:7878.',
    );
    assert.equal(
      normalizeDiagnosticAction({ name: 'android.health', failureClass: 'timeout' }),
      'Android /health timed out; verify USB stability, device wake state, and the serial-scoped adb forward before rerunning.',
    );
  });
});
