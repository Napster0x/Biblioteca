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
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureAndroidState, captureDesktopState } from '../sync-dev-state.mjs';

const PKG = 'io.github.Napster0x.biblioteca';

function withTempDesktopRoot(fn) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'biblioteca-sync-state-'));
  try {
    const readestDir = join(dataRoot, 'Readest');
    const booksDir = join(readestDir, 'Books');
    mkdirSync(booksDir, { recursive: true });
    writeFileSync(join(booksDir, 'library.json'), '[]');
    writeFileSync(join(readestDir, 'settings.json'), '{}');
    return fn(dataRoot, readestDir);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

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
  if (url.endsWith('/books/index')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: [
        { hash: 'abc123', title: 'Edited Android Book', updatedAt: '2026-02-03T04:05:06.000Z' },
        { hash: 'def456', title: 'Another Book', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: 1770000000000 },
      ],
    });
  }
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
  it('captures Android BookConfig booknotes evidence for a target book', async () => {
    const bookConfigFetch = (url) => {
      if (url.endsWith('/books/index')) return Promise.resolve({ ok: true, status: 200, data: [{ hash: 'book-1', title: 'Book' }] });
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.endsWith('/books/book-1/config')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { booknotes: [{ id: 'note-1', cfi: '/6/4', dictionaryEntryId: 'dict-1' }] },
        });
      }
      if (url.includes('/replicas/')) return Promise.resolve({ ok: true, status: 200, data: [] });
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: bookConfigFetch,
      bookHash: 'book-1',
    });

    assert.deepEqual(state.bookConfig, {
      path: '/books/book-1/config',
      status: 'pass',
      httpStatus: 200,
      bookHash: 'book-1',
      booknoteCount: 1,
      booknotes: [{ id: 'note-1', cfi: '/6/4', dictionaryEntryId: 'dict-1' }],
    });
  });

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

  it('captures Android book index facts for 9Ma before/after evidence', async () => {
    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: mockFetchJson,
    });

    assert.equal(state.bookIndex.status, 'pass');
    assert.equal(state.bookIndex.rowCount, 2);
    assert.deepEqual(state.bookIndex.facts, [
      { hash: 'abc123', title: 'Edited Android Book', author: undefined, updatedAt: '2026-02-03T04:05:06.000Z', deletedAt: undefined },
      { hash: 'def456', title: 'Another Book', author: undefined, updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: 1770000000000 },
    ]);
  });

  it('captures 13Ma same-hash tombstone/live ordering evidence for a target book', async () => {
    const importFetch = (url) => {
      if (url.endsWith('/books/index')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [
            { hash: 'abc123', title: 'Deleted copy', deletedAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' },
            { hash: 'abc123', title: 'Live copy', updatedAt: '2026-03-04T05:06:07.000Z' },
          ],
        });
      }
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.includes('/replicas/')) return Promise.resolve({ ok: true, status: 200, data: [] });
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: importFetch,
      bookHash: 'abc123',
    });

    assert.deepEqual(state.bookIndex.importEvidence, {
      hash: 'abc123',
      status: 'pass',
      liveCount: 1,
      tombstoneCount: 1,
      liveUpdatedAt: '2026-03-04T05:06:07.000Z',
      tombstoneUpdatedAt: '2026-03-01T00:00:00.000Z',
      liveWins: true,
    });
  });

  it('reports missing 13Ma book evidence instead of inferring import from counts', async () => {
    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: mockFetchJson,
      bookHash: 'missing-hash',
    });

    assert.deepEqual(state.bookIndex.importEvidence, {
      hash: 'missing-hash',
      status: 'missing-evidence',
      evidence: 'book-index.hash',
      reason: 'target book hash not present in Android /books/index',
    });
  });

  it('reports FAIL when a BookNote association is deleted but the semantic quote row remains live', async () => {
    const semanticFetch = (url) => {
      if (url.endsWith('/books/index')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.endsWith('/books/book-1/config')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { booknotes: [{ id: 'bn-quote', citeId: 'quote-1', cfi: '/6/4', text: 'quoted', deletedAt: 1719500000000 }] },
        });
      }
      if (url.endsWith('/replicas/quote')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [{ replica_id: 'quote:quote-1', fields_jsonb: { bookHash: { v: 'book-1' }, cfi: { v: '/6/4' }, text: { v: 'quoted' } } }],
        });
      }
      if (url.includes('/replicas/')) return Promise.resolve({ ok: true, status: 200, data: [] });
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: semanticFetch,
      bookHash: 'book-1',
      semanticDeleteTarget: { kind: 'quote', id: 'quote-1' },
    });

    assert.deepEqual(state.semanticDeleteEvidence, {
      status: 'fail',
      kind: 'quote',
      bookHash: 'book-1',
      semanticRowId: 'quote-1',
      booknoteId: 'bn-quote',
      associationDeleted: true,
      semanticDeleted: false,
      reason: 'BookNote association is deleted but quote semantic row remains live',
    });
  });

  it('reports PASS when semantic delete evidence has a tombstone row and deleted BookNote association', async () => {
    const semanticFetch = (url) => {
      if (url.endsWith('/books/index')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.endsWith('/books/book-1/config')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { booknotes: [{ id: 'bn-dict', dictionaryEntryId: 'entry-1', cfi: '/6/4', text: 'term', deletedAt: 1783041008896 }] },
        });
      }
      if (url.endsWith('/replicas/dictionary-occurrence')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [{ replica_id: 'dictionary-occurrence:occ-1', deleted_at_ts: '0019f25860c00-00000001-visible' }],
        });
      }
      if (url.includes('/replicas/')) return Promise.resolve({ ok: true, status: 200, data: [] });
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: semanticFetch,
      bookHash: 'book-1',
      semanticDeleteTarget: { kind: 'dictionary', id: 'entry-1', semanticRowId: 'occ-1', noteId: 'bn-dict' },
    });

    assert.deepEqual(state.semanticDeleteEvidence, {
      status: 'pass',
      kind: 'dictionary',
      bookHash: 'book-1',
      semanticRowId: 'occ-1',
      booknoteId: 'bn-dict',
      associationDeleted: true,
      semanticDeleted: true,
    });
  });

  it('keeps missing semantic evidence as missing when no live or tombstone semantic row exists', async () => {
    const semanticFetch = (url) => {
      if (url.endsWith('/books/index')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.endsWith('/books/book-1/config')) {
        return Promise.resolve({ ok: true, status: 200, data: { booknotes: [{ id: 'bn-quote', citeId: 'quote-1', deletedAt: 1783041008896 }] } });
      }
      if (url.endsWith('/replicas/quote')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.includes('/replicas/')) return Promise.resolve({ ok: true, status: 200, data: [] });
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: semanticFetch,
      bookHash: 'book-1',
      semanticDeleteTarget: { kind: 'quote', id: 'quote-1', noteId: 'bn-quote' },
    });

    assert.deepEqual(state.semanticDeleteEvidence, {
      status: 'missing-evidence',
      kind: 'quote',
      bookHash: 'book-1',
      reason: 'expected exactly one semantic row, found 0',
    });
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

  it('defaults empty replica tombstoneCount values to zero', async () => {
    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: mockRunAdb,
      fetchJson: mockFetchJson,
    });

    assert.equal(state.replicas['dictionary-entry'].reachable, true);
    assert.equal(state.replicas['dictionary-entry'].rowCount, 0);
    assert.equal(state.replicas['dictionary-entry'].tombstoneCount, 0);
  });

  it('counts non-zero Android replica tombstones', async () => {
    const tombstoneFetch = (url) => {
      if (url.endsWith('/books/manifest')) {
        return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      }
      if (url.endsWith('/replicas/dictionary-entry')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          data: [
            { replica_id: 'dictionary-entry:deleted-1', deleted_at_ts: '001905a2fcb00-00000001-visible' },
            { replica_id: 'dictionary-entry:live-1', deleted_at_ts: null },
            { replica_id: 'dictionary-entry:deleted-2', deleted: true },
          ],
        });
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
      fetchJson: tombstoneFetch,
    });

    assert.equal(state.replicas['dictionary-entry'].rowCount, 3);
    assert.equal(state.replicas['dictionary-entry'].tombstoneCount, 2);
    assert.equal(state.replicas.quote.tombstoneCount, 0);
  });

  it('uses HTTP replica evidence for Android row-level capture when sqlite3 is unavailable', async () => {
    const sqliteUnavailableRunAdb = (args) => {
      const cmd = args.join(' ');
      if (cmd.includes('sqlite3')) return { ok: false, stdout: '', message: 'sqlite3: inaccessible or not found' };
      if (cmd.includes('test -e ')) return { ok: true, stdout: '' };
      if (cmd.includes('find ')) return { ok: true, stdout: 'book-1\n' };
      if (cmd.includes('cat ')) return { ok: true, stdout: '{}' };
      return { ok: true, stdout: '' };
    };
    const replicaFetch = (url) => {
      if (url.endsWith('/books/index')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.endsWith('/replicas/dictionary-entry')) {
        return Promise.resolve({ ok: true, status: 200, data: [{ replica_id: 'dictionary-entry:entry-1', hlc: 'T100' }] });
      }
      if (url.endsWith('/replicas/dictionary-occurrence')) {
        return Promise.resolve({ ok: true, status: 200, data: [{ replica_id: 'dictionary-occurrence:occ-1', deleted_at_ts: 'T200' }] });
      }
      if (url.endsWith('/replicas/annotation')) {
        return Promise.resolve({ ok: true, status: 200, data: [{ replica_id: 'annotation:ann-1' }] });
      }
      if (url.endsWith('/replicas/quote')) {
        return Promise.resolve({ ok: true, status: 200, data: [{ replica_id: 'quote:quote-1' }] });
      }
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: sqliteUnavailableRunAdb,
      fetchJson: replicaFetch,
    });

    assert.equal(state.status, 'pass');
    assert.equal(state.sqlite.dictionary.available, true);
    assert.equal(state.sqlite.dictionary.source, 'http-replica-fallback');
    assert.deepEqual(state.sqlite.dictionary.tables.map((table) => [table.name, table.rowCount, table.deletedCount]), [
      ['dictionary-entry', 1, 0],
      ['dictionary-occurrence', 1, 1],
    ]);
    assert.equal(state.sqlite.annotations.available, true);
    assert.equal(state.sqlite.annotations.source, 'http-replica-fallback');
    assert.equal(state.sqlite.quotes.available, true);
    assert.equal(state.sqlite.quotes.source, 'http-replica-fallback');
  });

  it('keeps Android row-level capture as WARN when sqlite3 and required HTTP replica evidence are unavailable', async () => {
    const sqliteUnavailableRunAdb = (args) => {
      const cmd = args.join(' ');
      if (cmd.includes('sqlite3')) return { ok: false, stdout: '', message: 'sqlite3: inaccessible or not found' };
      if (cmd.includes('test -e ')) return { ok: true, stdout: '' };
      if (cmd.includes('find ')) return { ok: true, stdout: 'book-1\n' };
      if (cmd.includes('cat ')) return { ok: true, stdout: '{}' };
      return { ok: true, stdout: '' };
    };
    const missingReplicaFetch = (url) => {
      if (url.endsWith('/books/index')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.endsWith('/books/manifest')) return Promise.resolve({ ok: true, status: 200, data: { books: [] } });
      if (url.endsWith('/replicas/dictionary-entry')) return Promise.resolve({ ok: true, status: 200, data: [] });
      if (url.includes('/replicas/')) return Promise.resolve({ ok: false, status: 503, error: 'replica endpoint unavailable' });
      return Promise.resolve({ ok: false, status: 404, error: 'not found' });
    };

    const state = await captureAndroidState({
      packageName: PKG,
      serverUrl: 'http://localhost:7878',
      runAdb: sqliteUnavailableRunAdb,
      fetchJson: missingReplicaFetch,
    });

    assert.equal(state.status, 'warn');
    assert.equal(state.sqlite.dictionary.available, false);
    assert.equal(state.sqlite.dictionary.status, 'warn');
    assert.match(state.sqlite.dictionary.error, /sqlite3: inaccessible or not found/);
    assert.equal(state.replicas['dictionary-occurrence'].reachable, false);
  });
});

describe('captureDesktopState — sqlite deletedCount', () => {
  it('captures desktop BookConfig booknotes evidence for a target book', async () => {
    await withTempDesktopRoot(async (dataRoot, readestDir) => {
      mkdirSync(join(readestDir, 'Books', 'book-1'), { recursive: true });
      writeFileSync(join(readestDir, 'Books', 'book-1', 'config.json'), JSON.stringify({
        booknotes: [{ id: 'note-1', cfi: '/6/4', citeId: 'quote-1' }],
      }));

      const state = await captureDesktopState({ dataRoot, bookHash: 'book-1' });

      assert.deepEqual(state.bookConfig, {
        path: join(readestDir, 'Books', 'book-1', 'config.json'),
        status: 'pass',
        bookHash: 'book-1',
        booknoteCount: 1,
        booknotes: [{ id: 'note-1', cfi: '/6/4', citeId: 'quote-1' }],
      });
    });
  });

  it('captures desktop library book facts for 9Ma convergence evidence', async () => {
    await withTempDesktopRoot(async (dataRoot, readestDir) => {
      writeFileSync(join(readestDir, 'Books', 'library.json'), JSON.stringify([
        { hash: 'abc123', title: 'Edited Desktop Book', author: 'Author', updatedAt: '2026-02-03T04:05:06.000Z' },
      ]));

      const state = await captureDesktopState({ dataRoot });

      assert.deepEqual(state.library.facts, [
        { hash: 'abc123', title: 'Edited Desktop Book', author: 'Author', updatedAt: '2026-02-03T04:05:06.000Z', deletedAt: undefined },
      ]);
    });
  });

  it('defaults desktop deletedCount to zero when a SQLite table has no tombstones', async () => {
    await withTempDesktopRoot(async (dataRoot, readestDir) => {
      execFileSync('sqlite3', [join(readestDir, 'dictionary.db'), `
        CREATE TABLE dictionary_entries (
          id TEXT PRIMARY KEY,
          definition TEXT,
          updated_at INTEGER,
          deleted_at INTEGER,
          replica_timestamps TEXT
        );
        INSERT INTO dictionary_entries (id, definition, updated_at, deleted_at, replica_timestamps)
        VALUES ('entry-live', 'definition', 100, NULL, '{"updated":"T100"}');
      `], { encoding: 'utf8', stdio: 'pipe' });

      const state = await captureDesktopState({ dataRoot });
      const table = state.sqlite.dictionary.tables.find((candidate) => candidate.name === 'dictionary_entries');

      assert.equal(table.rowCount, 1);
      assert.equal(table.deletedCount, 0);
    });
  });

  it('reports non-zero desktop deletedCount for soft-deleted SQLite rows', async () => {
    await withTempDesktopRoot(async (dataRoot, readestDir) => {
      execFileSync('sqlite3', [join(readestDir, 'dictionary.db'), `
        CREATE TABLE dictionary_entries (
          id TEXT PRIMARY KEY,
          definition TEXT,
          updated_at INTEGER,
          deleted_at INTEGER,
          replica_timestamps TEXT
        );
        INSERT INTO dictionary_entries (id, definition, updated_at, deleted_at, replica_timestamps)
        VALUES
          ('entry-live', 'definition', 100, NULL, '{"updated":"T100"}'),
          ('entry-deleted', 'old definition', 200, 200, '{"deleted":"T200"}');
      `], { encoding: 'utf8', stdio: 'pipe' });

      const state = await captureDesktopState({ dataRoot });
      const table = state.sqlite.dictionary.tables.find((candidate) => candidate.name === 'dictionary_entries');

      assert.equal(table.rowCount, 2);
      assert.equal(table.deletedCount, 1);
    });
  });
});
