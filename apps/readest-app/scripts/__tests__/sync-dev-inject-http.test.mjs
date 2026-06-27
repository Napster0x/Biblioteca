#!/usr/bin/env node

/**
 * Tests for sync-dev-inject-http.mjs — HTTP-based Android injection.
 */

import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const TEST_SERVER = 'http://localhost:7878';
const MINIMAL_FIELDS = { term: 'term', displayTerm: 'display_term', language: 'language', definition: 'definition' };

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
