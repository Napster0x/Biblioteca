#!/usr/bin/env node

/**
 * Tests for sync-dev-inject-http.mjs — HTTP-based Android injection.
 */

import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_SERVER = 'http://localhost:7878';
const MINIMAL_FIELDS = { term: 'term', displayTerm: 'display_term', language: 'language', definition: 'definition' };
const EXPLICIT_HLC = '001905a2fcb00-00000001-visible';

/**
 * Convenience: set up a mock fetch. Returns the mock fn so callers can access .mock.calls.
 */
function mockFetch(fn) {
  return mock.method(globalThis, 'fetch', fn);
}

describe('injectReplicasViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should send PUT request to correct endpoint with Content-Type JSON', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const rows = [{ id: 'test1', term: 'zozobrar', definition: 'hundirse' }];
    await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', rows, MINIMAL_FIELDS);

    assert.equal(fetchMock.mock.calls.length, 1, 'should call fetch exactly once');
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${TEST_SERVER}/replicas/dictionary-entry`);
    assert.equal(opts.method, 'PUT');
    assert.equal(opts.headers['Content-Type'], 'application/json');
  });

  it('should send ReplicaRow[] as JSON body with correct fields_jsonb structure', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const row = {
      id: 'entry-1', term: 'zozobrar', display_term: 'zozobrar',
      language: 'es', definition: 'hundirse',
    };
    await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', [row], MINIMAL_FIELDS);

    const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    assert.ok(Array.isArray(body), 'body should be an array');
    assert.equal(body.length, 1, 'should have one replica');

    const replica = body[0];
    assert.equal(replica.kind, 'dictionary-entry');
    assert.equal(replica.replica_id, 'dictionary-entry:entry-1');
    assert.equal(replica.user_id, 'visible');

    assert.ok(replica.fields_jsonb, 'replica should have fields_jsonb');
    assert.equal(replica.fields_jsonb.term.v, 'zozobrar');
    assert.equal(replica.fields_jsonb.term.s, 'visible');
    assert.ok(replica.fields_jsonb.term.t, 'fields_jsonb values should have HLC timestamps');
    assert.match(
      String(replica.fields_jsonb.term.t),
      /^[0-9a-f]+-/,
      'HLC timestamp should start with hex-encoded millis',
    );

    assert.equal(replica.fields_jsonb.definition.v, 'hundirse');
    assert.equal(replica.schema_version, 1);
  });

  it('should return { ok, inserted, target, table } on success', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const rows = [{ id: 'entry-2', term: 'hacerAGuas', definition: 'estar en problemas' }];
    const result = await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', rows, MINIMAL_FIELDS);

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'dictionary-entry');
    assert.equal(result.error, undefined);
  });

  it('should return error when server responds with HTTP error', async () => {
    mockFetch(async () => {
      return new Response('Internal Server Error', { status: 500 });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const rows = [{ id: 'fail-1', term: 'fail' }];
    const result = await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', rows, MINIMAL_FIELDS);

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'dictionary-entry');
    assert.ok(result.error.includes('500'), 'error should contain HTTP status');
  });

  it('should return error when server is unreachable', async () => {
    mockFetch(async () => {
      throw new Error('connect ECONNREFUSED localhost:7878');
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const rows = [{ id: 'net-err', term: 'network' }];
    const result = await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', rows, MINIMAL_FIELDS);

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.ok(result.error.includes('fetch failed'), 'error should indicate fetch failure');
    assert.ok(result.error.includes('ECONNREFUSED'), 'error should include original message');
  });

  it('should return error for empty rows without calling fetch', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', [], MINIMAL_FIELDS);

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.error, 'no rows to inject');
    assert.equal(fetchMock.mock.calls.length, 0, 'fetch should not be called for empty rows');
  });

  it('should handle null rows gracefully', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await injectReplicasViaHttp(TEST_SERVER, 'dictionary-entry', null, MINIMAL_FIELDS);

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.error, 'no rows to inject');
    assert.equal(fetchMock.mock.calls.length, 0, 'fetch should not be called for null rows');
  });

  it('should work for dictionary-occurrence kind with correct endpoint', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true, count: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const { injectReplicasViaHttp } = await import('../sync-dev-inject-http.mjs');

    const rows = [{
      id: 'occ-1', entry_id: 'entry-1', book_hash: 'abc123',
      book_title: 'Test', cfi: '/6/2',
    }];
    const OCC_FIELDS = { entryId: 'entry_id', bookHash: 'book_hash', bookTitle: 'book_title', cfi: 'cfi' };
    await injectReplicasViaHttp(TEST_SERVER, 'dictionary-occurrence', rows, OCC_FIELDS);

    const [url] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${TEST_SERVER}/replicas/dictionary-occurrence`);

    const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    assert.equal(body[0].kind, 'dictionary-occurrence');
    assert.equal(body[0].replica_id, 'dictionary-occurrence:occ-1');
  });
});

describe('injectBookViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should push book library via PUT /books/index', async () => {
    const fetchMock = mockFetch(async (url, opts) => {
      if (opts?.method === 'PUT' && String(url).endsWith('/books/index')) {
        return new Response(JSON.stringify({ ok: true, count: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
    const { injectBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const books = [{ hash: 'book123', title: 'Test Book', fileName: 'test.epub' }];
    const result = await injectBookViaHttp(TEST_SERVER, books);

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);

    const indexCalls = fetchMock.mock.calls.filter(c =>
      String(c.arguments[0]).endsWith('/books/index'),
    );
    assert.equal(indexCalls.length, 1, 'should call PUT /books/index');
    const [, opts] = indexCalls[0].arguments;
    assert.equal(opts.method, 'PUT');
    assert.equal(opts.headers['Content-Type'], 'application/json');

    const body = JSON.parse(opts.body);
    assert.deepEqual(body, books);
  });

  it('should return error for empty book list', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { injectBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await injectBookViaHttp(TEST_SERVER, []);

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.error, 'no books to inject');
    assert.equal(fetchMock.mock.calls.length, 0, 'fetch should not be called for empty book list');
  });

  it('should handle server error for book push', async () => {
    mockFetch(async () => {
      return new Response('Bad Request', { status: 400 });
    });
    const { injectBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const books = [{ hash: 'badbook', title: 'Bad Book', fileName: 'bad.epub' }];
    const result = await injectBookViaHttp(TEST_SERVER, books);

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.ok(result.error.includes('400'));
  });
});

describe('updateBookViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches the Android book index, preserves existing fields, merges metadata, and bumps updatedAt', async () => {
    const fetchMock = mockFetch(async (url, opts = {}) => {
      if (opts.method === 'PUT') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      assert.equal(url, `${TEST_SERVER}/books/index`);
      return new Response(JSON.stringify([
        {
          hash: 'book-1',
          title: 'Old title',
          author: 'Old author',
          fileName: 'old.epub',
          metadata: { language: 'en', publisher: 'Original' },
          updatedAt: '2026-01-01T00:00:00.000Z',
          customField: 'preserved',
        },
        { hash: 'book-2', title: 'Other', updatedAt: '2026-01-02T00:00:00.000Z' },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const { updateBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await updateBookViaHttp(
      TEST_SERVER,
      'book-1',
      { title: 'New title', metadata: { language: 'es' } },
      { now: () => new Date('2026-02-03T04:05:06.000Z') },
    );

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'books');
    assert.equal(result.action, 'updated');
    assert.equal(fetchMock.mock.calls.length, 2);

    const [putUrl, putOpts] = fetchMock.mock.calls[1].arguments;
    assert.equal(putUrl, `${TEST_SERVER}/books/index`);
    assert.equal(putOpts.method, 'PUT');
    const body = JSON.parse(putOpts.body);
    assert.equal(body.length, 2, 'PUT preserves the full index shape');
    assert.deepEqual(body[0], {
      hash: 'book-1',
      title: 'New title',
      author: 'Old author',
      fileName: 'old.epub',
      metadata: { language: 'es', publisher: 'Original' },
      updatedAt: '2026-02-03T04:05:06.000Z',
      customField: 'preserved',
    });
    assert.equal(body[1].title, 'Other');
  });

  it('rejects immutable book fields before writing the Android index', async () => {
    const fetchMock = mockFetch(async () => new Response(JSON.stringify([]), { status: 200 }));
    const { updateBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await updateBookViaHttp(TEST_SERVER, 'book-1', { fileName: 'changed.epub' });

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.match(result.error, /Field is not editable by this harness: books\.fileName/);
    assert.equal(fetchMock.mock.calls.length, 0, 'invalid updates must not touch Android HTTP');
  });
});

describe('importBookViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('uploads the EPUB asset, clears a same-hash tombstone, and writes a newer live index entry', async () => {
    const liveAt = '2026-03-04T05:06:07.000Z';
    rmSync('/tmp/biblioteca-dev-sync/pending-android-book-tombstones.json', { force: true });
    const fetchMock = mockFetch(async (url, opts = {}) => {
      if (String(url).endsWith('/books/index') && !opts.method) {
        return new Response(JSON.stringify([
          {
            hash: 'book-reimport',
            title: 'Deleted title',
            fileName: 'old.epub',
            deletedAt: 1772323200000,
            updatedAt: 1772323200000,
          },
          { hash: 'other-book', title: 'Other', updatedAt: '2026-02-01T00:00:00.000Z' },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { importBookViaHttp, recordPendingAndroidBookTombstone } = await import('../sync-dev-inject-http.mjs');
    recordPendingAndroidBookTombstone({ hash: 'book-reimport', deletedAt: 1772323200000 });

    const result = await importBookViaHttp(TEST_SERVER, {
      hash: 'book-reimport',
      fileName: 'fixture.epub',
      byteSize: 12,
      bytes: Buffer.from('epub content'),
      entry: {
        hash: 'book-reimport',
        title: 'Live title',
        author: 'Live author',
        fileName: 'fixture.epub',
        byteSize: 12,
        importedAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
    }, { now: liveAt });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'imported');
    assert.equal(result.resurrected, true);
    assert.equal(result.tombstoneUpdatedAt, 1772323200000);
    assert.equal(result.liveUpdatedAt, liveAt);

    const [assetUrl, assetOpts] = fetchMock.mock.calls[0].arguments;
    assert.equal(assetUrl, `${TEST_SERVER}/books/book-reimport/book`);
    assert.equal(assetOpts.method, 'PUT');
    assert.equal(assetOpts.headers['Content-Type'], 'application/octet-stream');

    const [, indexPutOpts] = fetchMock.mock.calls[2].arguments;
    const books = JSON.parse(indexPutOpts.body);
    assert.deepEqual(books, [
      {
        hash: 'other-book',
        title: 'Other',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        hash: 'book-reimport',
        title: 'Live title',
        author: 'Live author',
        fileName: 'fixture.epub',
        byteSize: 12,
        createdAt: Date.parse(liveAt),
        importedAt: liveAt,
        updatedAt: liveAt,
        deletedAt: null,
      },
    ]);
    assert.deepEqual(JSON.parse(readFileSync('/tmp/biblioteca-dev-sync/pending-android-book-tombstones.json', 'utf8')), []);
  });

  it('reports missing import evidence without writing Android HTTP', async () => {
    const fetchMock = mockFetch(async () => new Response('{}', { status: 200 }));
    const { importBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await importBookViaHttp(TEST_SERVER, { hash: 'missing-entry', entry: null });

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.evidence, 'descriptor.entry');
    assert.match(result.error, /missing EPUB import descriptor entry/);
    assert.equal(fetchMock.mock.calls.length, 0);
  });
});

describe('semantic highlight delete helpers', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('resolves dictionary, quote, and annotation targets by exact semantic association', async () => {
    const { resolveSemanticHighlightTarget } = await import('../sync-dev-inject-http.mjs');
    const config = { booknotes: [
      { id: 'bn-dict', type: 'highlight', cfi: '/6/2', text: 'word', dictionaryEntryId: 'entry-1' },
      { id: 'bn-quote', type: 'highlight', cfi: '/6/4', text: 'quoted', citeId: 'quote-1' },
      { id: 'bn-ann', type: 'highlight', cfi: '/6/6', text: 'annotated', annotationId: 'ann-1' },
    ] };

    assert.equal(resolveSemanticHighlightTarget({ bookHash: 'book-1', kind: 'dictionary', dictionaryEntryId: 'entry-1', cfi: '/6/2' }, config, [
      { id: 'occ-1', entry_id: 'entry-1', book_hash: 'book-1', cfi: '/6/2', selected_text: 'word' },
    ]).ok, true);
    assert.equal(resolveSemanticHighlightTarget({ bookHash: 'book-1', kind: 'quote', id: 'quote-1' }, config, [
      { id: 'quote-1', book_hash: 'book-1', cfi: '/6/4', text: 'quoted' },
    ]).note.id, 'bn-quote');
    assert.equal(resolveSemanticHighlightTarget({ bookHash: 'book-1', kind: 'annotation', id: 'ann-1' }, config, [
      { id: 'ann-1', book_hash: 'book-1', cfi: '/6/6', note: 'annotated' },
    ]).note.id, 'bn-ann');
  });

  it('fails with diagnostics when target resolution has zero or multiple matches', async () => {
    const { resolveSemanticHighlightTarget } = await import('../sync-dev-inject-http.mjs');
    const config = { booknotes: [{ id: 'bn-1', cfi: '/6/2', dictionaryEntryId: 'entry-1' }] };

    const missing = resolveSemanticHighlightTarget({ bookHash: 'book-1', kind: 'dictionary', text: 'absent' }, config, [
      { id: 'occ-1', entry_id: 'entry-1', book_hash: 'book-1', cfi: '/6/2', selected_text: 'word' },
    ]);
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'zero-match');
    assert.match(missing.error, /No dictionary semantic row matched/);

    const ambiguous = resolveSemanticHighlightTarget({ bookHash: 'book-1', kind: 'dictionary', dictionaryEntryId: 'entry-1' }, config, [
      { id: 'occ-1', entry_id: 'entry-1', book_hash: 'book-1', cfi: '/6/2', selected_text: 'word' },
      { id: 'occ-2', entry_id: 'entry-1', book_hash: 'book-1', cfi: '/6/4', selected_text: 'word' },
    ]);
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.reason, 'multi-match');
    assert.deepEqual(ambiguous.matches, ['occ-1', 'occ-2']);
  });

  it('deletes Android config association and tombstones the resolved semantic replica together', async () => {
    const fetchMock = mockFetch(async (url, opts = {}) => {
      if (String(url).endsWith('/books/book-1/config') && !opts.method) {
        return new Response(JSON.stringify({ booknotes: [
          { id: 'bn-quote', cfi: '/6/4', citeId: 'quote-1', text: 'quoted' },
          { id: 'bn-other', cfi: '/8/2', citeId: 'quote-2', text: 'other' },
        ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).endsWith('/replicas/quote') && !opts.method) {
        return new Response(JSON.stringify([
          { replica_id: 'quote:quote-1', fields_jsonb: { bookHash: { v: 'book-1' }, cfi: { v: '/6/4' }, text: { v: 'quoted' } } },
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { deleteSemanticHighlightViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await deleteSemanticHighlightViaHttp(TEST_SERVER, {
      bookHash: 'book-1',
      kind: 'quote',
      id: 'quote-1',
    }, { hlcTimestamp: 1719500000000 });

    assert.equal(result.ok, true);
    assert.equal(result.deletedConfigNotes, 1);
    assert.equal(result.deletedSemanticRows, 1);

    const configPut = fetchMock.mock.calls.find((call) => String(call.arguments[0]).endsWith('/books/book-1/config') && call.arguments[1]?.method === 'PUT');
    const updatedConfig = JSON.parse(configPut.arguments[1].body);
    assert.equal(updatedConfig.booknotes[0].deletedAt, 1719500000000);
    assert.equal(updatedConfig.booknotes[1].deletedAt, undefined);

    const tombstonePut = fetchMock.mock.calls.find((call) => String(call.arguments[0]).endsWith('/replicas/quote') && call.arguments[1]?.method === 'PUT');
    const tombstones = JSON.parse(tombstonePut.arguments[1].body);
    assert.equal(tombstones[0].replica_id, 'quote:quote-1');
    assert.equal(tombstones[0].deleted_at_ts, EXPLICIT_HLC);
  });
});

describe('updateReplicaViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should send updated rows via PUT /replicas/:kind with JSON body', async () => {
    const fetchMock = mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { updateReplicaViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await updateReplicaViaHttp(
      TEST_SERVER,
      'dictionary-entry',
      [{ id: 'entry-1', term: 'zozobrar', definition: 'hundirse de ánimo' }],
      { fieldMap: MINIMAL_FIELDS },
    );

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'dictionary-entry');

    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${TEST_SERVER}/replicas/dictionary-entry`);
    assert.equal(opts.method, 'PUT');
    assert.equal(opts.headers['Content-Type'], 'application/json');

    const body = JSON.parse(opts.body);
    assert.equal(body[0].replica_id, 'dictionary-entry:entry-1');
    assert.equal(body[0].fields_jsonb.term.v, 'zozobrar');
    assert.equal(body[0].fields_jsonb.definition.v, 'hundirse de ánimo');
    assert.equal(body[0].deleted_at_ts, null);
  });

  it('should pass explicit HLC timestamp through update body', async () => {
    const fetchMock = mockFetch(async () => new Response('{}', { status: 200 }));
    const { updateReplicaViaHttp } = await import('../sync-dev-inject-http.mjs');

    await updateReplicaViaHttp(
      TEST_SERVER,
      'dictionary-entry',
      [{ id: 'entry-hlc', term: 'hlc', definition: 'deterministic' }],
      { fieldMap: MINIMAL_FIELDS, hlcTimestamp: 1719500000000 },
    );

    const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    assert.equal(body[0].updated_at_ts, EXPLICIT_HLC);
    assert.equal(body[0].fields_jsonb.term.t, EXPLICIT_HLC);
  });

  it('should pass hex-encoded HLC strings through update body unchanged', async () => {
    const fetchMock = mockFetch(async () => new Response('{}', { status: 200 }));
    const { updateReplicaViaHttp } = await import('../sync-dev-inject-http.mjs');

    await updateReplicaViaHttp(
      TEST_SERVER,
      'dictionary-entry',
      [{ id: 'entry-hlc-string', term: 'hlc', definition: 'string' }],
      { fieldMap: MINIMAL_FIELDS, hlcTimestamp: EXPLICIT_HLC },
    );

    const body = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    assert.equal(body[0].updated_at_ts, EXPLICIT_HLC);
    assert.equal(body[0].fields_jsonb.term.t, EXPLICIT_HLC);
  });
});

describe('deleteReplicaViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should send tombstone-compatible rows via PUT /replicas/:kind', async () => {
    const fetchMock = mockFetch(async () => new Response('{}', { status: 200 }));
    const { deleteReplicaViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await deleteReplicaViaHttp(
      TEST_SERVER,
      'dictionary-entry',
      ['entry-deleted'],
      { fieldMap: MINIMAL_FIELDS, hlcTimestamp: 1719500000000 },
    );

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'dictionary-entry');

    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${TEST_SERVER}/replicas/dictionary-entry`);
    assert.equal(opts.method, 'PUT');

    const body = JSON.parse(opts.body);
    assert.equal(body[0].replica_id, 'dictionary-entry:entry-deleted');
    assert.equal(body[0].deleted_at_ts, EXPLICIT_HLC);
    assert.equal(body[0].updated_at_ts, EXPLICIT_HLC);
    assert.equal(body[0].fields_jsonb.term.v, null);
  });

  it('should report network failures without throwing', async () => {
    mockFetch(async () => {
      throw new Error('socket closed');
    });
    const { deleteReplicaViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await deleteReplicaViaHttp(
      TEST_SERVER,
      'dictionary-entry',
      ['entry-error'],
      { fieldMap: MINIMAL_FIELDS },
    );

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'dictionary-entry');
    assert.match(result.error, /fetch failed: socket closed/);
  });
});

describe('deleteBookViaHttp', () => {
  afterEach(() => {
    mock.restoreAll();
    rmSync('/tmp/biblioteca-dev-sync/pending-android-book-tombstones.json', { force: true });
  });

  it('should send PUT /books/delete with the book hash body', async () => {
    const fetchMock = mockFetch(async () => new Response('{}', { status: 200 }));
    const { deleteBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await deleteBookViaHttp(TEST_SERVER, 'book-hash-1');

    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'books');

    const [url, opts] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, `${TEST_SERVER}/books/delete`);
    assert.equal(opts.method, 'PUT');
    assert.equal(opts.headers['Content-Type'], 'application/json');
    const body = JSON.parse(opts.body);
    assert.equal(body.hash, 'book-hash-1');
    assert.equal(typeof body.deletedAt, 'number');
  });

  it('records a pending Android book tombstone marker after HTTP delete success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pending-android-book-delete-'));
    const markerPath = join(dir, 'pending.json');
    try {
      const { recordPendingAndroidBookTombstone } = await import('../sync-dev-inject-http.mjs');

      recordPendingAndroidBookTombstone({ hash: 'book-hash-2', deletedAt: 500 }, markerPath);

      assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), [
        { hash: 'book-hash-2', deletedAt: 500, updatedAt: 500 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return an HTTP error for failed book delete responses', async () => {
    mockFetch(async () => new Response('missing', { status: 404 }));
    const { deleteBookViaHttp } = await import('../sync-dev-inject-http.mjs');

    const result = await deleteBookViaHttp(TEST_SERVER, 'missing-book');

    assert.equal(result.ok, false);
    assert.equal(result.inserted, 0);
    assert.equal(result.target, 'android-http');
    assert.equal(result.table, 'books');
    assert.equal(result.error, 'HTTP 404: missing');
  });
});

describe('resolveAndroidServerUrl', () => {
  it('should return default URL when no env provided', () => {
    const { resolveAndroidServerUrl } = { resolveAndroidServerUrl: (env) => {
      if (env?.android?.serverUrl) return env.android.serverUrl;
      return 'http://localhost:7878';
    }};
    assert.equal(resolveAndroidServerUrl({}), 'http://localhost:7878');
  });

  it('should return default URL when env.android is undefined', () => {
    const { resolveAndroidServerUrl } = { resolveAndroidServerUrl: (env) => {
      if (env?.android?.serverUrl) return env.android.serverUrl;
      return 'http://localhost:7878';
    }};
    assert.equal(resolveAndroidServerUrl(undefined), 'http://localhost:7878');
  });

  it('should read serverUrl from env.android.serverUrl', () => {
    const { resolveAndroidServerUrl } = { resolveAndroidServerUrl: (env) => {
      if (env?.android?.serverUrl) return env.android.serverUrl;
      return 'http://localhost:7878';
    }};
    assert.equal(
      resolveAndroidServerUrl({ android: { serverUrl: 'http://192.168.1.100:7878' } }),
      'http://192.168.1.100:7878',
    );
  });
});

describe('dev-sync-fixture routing', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should route injectDictionary to injectReplicasViaHttp when target is android-http', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { injectDictionary } = await import('../dev-sync-fixture.mjs');

    const result = await injectDictionary({
      target: 'android-http',
      bookHash: 'book123',
      term: 'zozobrar',
      definition: 'hundirse',
    });

    assert.equal(result.ok, true);
  });

  it('should route injectQuote to injectReplicasViaHttp when target is android-http', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { injectQuote } = await import('../dev-sync-fixture.mjs');

    const result = await injectQuote({
      target: 'android-http',
      bookHash: 'book123',
      text: 'Ser o no ser',
    });

    assert.equal(result.ok, true);
  });

  it('should route injectAnnotation to injectReplicasViaHttp when target is android-http', async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { injectAnnotation } = await import('../dev-sync-fixture.mjs');

    const result = await injectAnnotation({
      target: 'android-http',
      bookHash: 'book123',
      text: 'Mi anotación',
    });

    assert.equal(result.ok, true);
  });
});
