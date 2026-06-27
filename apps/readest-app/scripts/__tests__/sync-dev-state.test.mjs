#!/usr/bin/env node

/**
 * Test: captureAndroidState stores manifest.data alongside manifest.summary.
 *
 * Verifies that when fetchJson returns a successful manifest response,
 * the returned state includes manifest.data with the raw response data
 * (fixing the secondary bug where manifest.data was never stored).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { captureAndroidState } from '../sync-dev-state.mjs';

const PKG = 'io.github.Napster0x.biblioteca';

function mockRunAdb(args) {
  const cmd = args.join(' ');
  // For sqlite3 queries, return empty array JSON
  if (cmd.includes('sqlite3')) return { ok: true, stdout: '[]' };
  // For file existence checks, return ok
  if (cmd.includes('test -e ')) return { ok: true, stdout: '' };
  // For find, return empty listing
  if (cmd.includes('find ')) return { ok: true, stdout: '' };
  // For cat, return missing
  if (cmd.includes('cat ')) return { ok: false, stdout: '', message: 'File not found' };
  return { ok: true, stdout: '' };
}

function mockFetchJson(url) {
  if (url.endsWith('/books/manifest')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        books: [
          { hash: 'abc123', book: { title: 'Test Book', fileName: 'test.epub' } },
          { hash: 'def456', book: { title: 'Another Book', fileName: 'book.epub' } },
        ],
      },
    });
  }
  // Replica endpoints return empty arrays
  if (url.includes('/replicas/')) {
    return Promise.resolve({ ok: true, status: 200, data: [] });
  }
  return Promise.resolve({ ok: false, status: 404, error: 'not found' });
}

describe('captureAndroidState — manifest.data', () => {
  it('should store manifest.data with raw response when fetch succeeds', async () => {
    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: mockFetchJson,
    });

    // manifest should have status 'pass'
    assert.equal(state.manifest.status, 'pass');

    // manifest.data should contain the raw response
    assert.ok(state.manifest.data, 'manifest.data should be defined when fetch succeeds');
    assert.ok(Array.isArray(state.manifest.data.books), 'manifest.data.books should be an array');
    assert.equal(state.manifest.data.books.length, 2);
    assert.equal(state.manifest.data.books[0].hash, 'abc123');

    // manifest.summary should still be present
    assert.ok(state.manifest.summary, 'manifest.summary should still be defined');
    assert.equal(state.manifest.summary.kind, 'object');
  });

  it('should not have data field when manifest fetch fails', async () => {
    const failFetch = (url) => {
      if (url.endsWith('/books/manifest')) {
        return Promise.resolve({ ok: false, status: 500, error: 'server error' });
      }
      if (url.includes('/replicas/')) {
        return Promise.resolve({ ok: true, status: 200, data: [] });
      }
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: failFetch,
    });

    // When fetch fails, manifest.status should be 'warn'
    assert.equal(state.manifest.status, 'warn');
    // No data field on failure
    assert.equal(state.manifest.data, undefined);
    // Summary should reflect the failure
    assert.equal(state.manifest.summary.kind, 'missing');
  });

  it('should handle empty manifest (no books)', async () => {
    const emptyBooksFetch = (url) => {
      if (url.endsWith('/books/manifest')) {
        return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      }
      if (url.includes('/replicas/')) {
        return Promise.resolve({ ok: true, status: 200, data: [] });
      }
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: emptyBooksFetch,
    });

    assert.equal(state.manifest.status, 'pass');
    assert.ok(state.manifest.data, 'manifest.data should be defined');
    assert.ok(Array.isArray(state.manifest.data.books));
    assert.equal(state.manifest.data.books.length, 0);
    assert.equal(state.manifest.summary.kind, 'object');
  });
});
