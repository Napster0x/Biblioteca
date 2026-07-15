#!/usr/bin/env node

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  REPLICA_KINDS,
  reinitializeAndroidAfterClean,
} from '../android-clean-reinit.mjs';

function createEnv(overrides = {}) {
  return {
    android: {
      packageName: 'io.github.Napster0x.biblioteca.dev',
      serial: 'device-1',
      readestDir: '/data/data/io.github.Napster0x.biblioteca.dev/Readest',
      serverUrl: 'http://localhost:7878',
      ...overrides.android,
    },
  };
}

function adbRecorder({ pid = '12345\n', failAt = null } = {}) {
  const calls = [];
  const runAdb = async (args) => {
    calls.push(args);
    const command = args.join(' ');
    if (failAt && command.includes(failAt)) {
      throw new Error(`failed ${failAt}`);
    }
    if (command.includes('pidof')) return pid;
    return '';
  };
  return { calls, runAdb };
}

function fetchRouter(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) return { ok: false, status: 404, text: async () => 'missing' };
    return {
      ok: route.ok ?? true,
      status: route.status ?? 200,
      text: async () => route.body ?? '{"ok":true}',
    };
  };
  return { calls, fetch };
}

describe('android clean reinitialize helper', () => {
  it('runs the post-clean command sequence before readiness probes', async () => {
    const adb = adbRecorder();
    const http = fetchRouter({
      'http://localhost:7878/health': { body: '{"ok":true}' },
      'http://localhost:7878/books/manifest': { body: '{"books":[]}' },
      ...Object.fromEntries(REPLICA_KINDS.map((kind) => [`http://localhost:7878/replicas/${kind}`, { body: '{"ok":true}' }])),
    });

    const result = await reinitializeAndroidAfterClean({
      env: createEnv(),
      runAdb: adb.runAdb,
      fetch: http.fetch,
      sleep: async () => {},
      settingsJson: { localSync: { enabled: true, port: 7878 } },
      tempSettingsPath: '/tmp/settings.json',
      timeoutMs: 100,
      intervalMs: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(adb.calls.slice(0, 6), [
      ['-s', 'device-1', 'forward', 'tcp:7878', 'tcp:7878'],
      ['-s', 'device-1', 'push', '/tmp/settings.json', '/data/local/tmp/biblioteca-settings.json'],
      ['-s', 'device-1', 'shell', 'run-as', 'io.github.Napster0x.biblioteca.dev', 'mkdir', '-p', '/data/data/io.github.Napster0x.biblioteca.dev/Readest'],
      ['-s', 'device-1', 'shell', 'run-as', 'io.github.Napster0x.biblioteca.dev', 'cp', '/data/local/tmp/biblioteca-settings.json', '/data/data/io.github.Napster0x.biblioteca.dev/Readest/settings.json'],
      ['-s', 'device-1', 'shell', 'am', 'start', '-n', 'io.github.Napster0x.biblioteca.dev/.MainActivity'],
      ['-s', 'device-1', 'shell', 'pidof', 'io.github.Napster0x.biblioteca.dev'],
    ]);
    assert.deepEqual(http.calls, [
      'http://localhost:7878/health',
      'http://localhost:7878/books/manifest',
      'http://localhost:7878/replicas/annotation',
      'http://localhost:7878/replicas/quote',
      'http://localhost:7878/replicas/dictionary-entry',
      'http://localhost:7878/replicas/dictionary-occurrence',
    ]);
    assert.equal(result.ready.process.pid, '12345');
  });

  it('returns bounded diagnostics when forwarding fails before settings injection', async () => {
    const adb = adbRecorder({ failAt: 'forward tcp:7878 tcp:7878' });

    const result = await reinitializeAndroidAfterClean({
      env: createEnv(),
      runAdb: adb.runAdb,
      fetch: async () => { throw new Error('fetch should not run'); },
      sleep: async () => {},
      tempSettingsPath: '/tmp/settings.json',
      timeoutMs: 100,
      intervalMs: 1,
    });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].class, 'adb-forward-unavailable');
    assert.deepEqual(result.stages, [{ name: 'adb.forward', ok: false, class: 'adb-forward-unavailable' }]);
    assert.equal(adb.calls.length, 1);
  });

  it('classifies settings, process, health, manifest, and replica readiness failures', async () => {
    const cases = [
      {
        name: 'settings injection',
        adb: adbRecorder({ failAt: 'push /tmp/settings.json' }),
        fetch: async () => { throw new Error('fetch should not run'); },
        expected: 'settings-injection-failed',
      },
      {
        name: 'missing process',
        adb: adbRecorder({ pid: '\n' }),
        fetch: async () => { throw new Error('fetch should not run'); },
        expected: 'process-absent',
      },
      {
        name: 'empty health',
        adb: adbRecorder(),
        fetch: fetchRouter({ 'http://localhost:7878/health': { body: '' } }).fetch,
        expected: 'health-empty-reply',
      },
      {
        name: 'unreachable manifest',
        adb: adbRecorder(),
        fetch: fetchRouter({
          'http://localhost:7878/health': { body: '{"ok":true}' },
          'http://localhost:7878/books/manifest': new Error('manifest down'),
        }).fetch,
        expected: 'manifest-unreachable',
      },
      {
        name: 'replica unavailable',
        adb: adbRecorder(),
        fetch: fetchRouter({
          'http://localhost:7878/health': { body: '{"ok":true}' },
          'http://localhost:7878/books/manifest': { body: '{"books":[]}' },
          'http://localhost:7878/replicas/annotation': { body: '{"ok":true}' },
          'http://localhost:7878/replicas/quote': { ok: false, status: 503, body: 'unavailable' },
        }).fetch,
        expected: 'replica-api-unavailable',
      },
    ];

    for (const item of cases) {
      const result = await reinitializeAndroidAfterClean({
        env: createEnv(),
        runAdb: item.adb.runAdb,
        fetch: item.fetch,
        sleep: async () => {},
        tempSettingsPath: '/tmp/settings.json',
        timeoutMs: 10,
        intervalMs: 1,
      });

      assert.equal(result.ok, false, item.name);
      assert.equal(result.diagnostics.at(-1).class, item.expected, item.name);
    }
  });
});
