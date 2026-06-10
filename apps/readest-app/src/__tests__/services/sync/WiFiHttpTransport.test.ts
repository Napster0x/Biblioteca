import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplicaRow, Hlc, FieldsObject } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

let mockFetchResponse: Response;
let fetchCalls: { url: string; init?: RequestInit }[] = [];

function createMockResponse(
  body: unknown,
  status: number = 200,
  headers: Record<string, string> = {},
  binaryBody?: ArrayBuffer,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob(),
    arrayBuffer: async () => binaryBody ?? new ArrayBuffer(0),
    formData: async () => new FormData(),
    clone() {
      return this;
    },
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
  } as Response;
}

const mockFetch = vi.fn((url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  fetchCalls.push({ url: url.toString(), init });
  return Promise.resolve(mockFetchResponse);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HLC_A = '0000000000001-00000001-test-dev' as Hlc;
const HLC_B = '0000000000002-00000001-test-dev' as Hlc;
const HLC_C = '0000000000003-00000001-test-dev' as Hlc;

function makeRow(id: string, hlc: Hlc, kind: string = 'annotation'): ReplicaRow {
  const fields: FieldsObject = {
    text: { v: `text-${id}`, t: hlc, s: 'dev' },
  };
  return {
    user_id: '',
    kind,
    replica_id: `${kind}:${id}`,
    fields_jsonb: fields,
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    updated_at_ts: hlc,
    schema_version: 1,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

describe('WiFiHttpTransport', () => {
  let WiFiHttpTransport: typeof import('@/services/sync/WiFiHttpTransport').WiFiHttpTransport;

  beforeAll(async () => {
    vi.stubGlobal('fetch', mockFetch);
    const mod = await import('@/services/sync/WiFiHttpTransport');
    WiFiHttpTransport = mod.WiFiHttpTransport;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    mockFetchResponse = createMockResponse([]);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('stores host and port, exposes kind as "wifi"', () => {
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      expect(t.kind).toBe('wifi');
    });

    it('accepts any valid IP or hostname', () => {
      const t1 = new WiFiHttpTransport('10.0.0.1', 8080);
      expect(t1.kind).toBe('wifi');

      const t2 = new WiFiHttpTransport('living-room.local', 7878);
      expect(t2.kind).toBe('wifi');
    });
  });

  // -------------------------------------------------------------------------
  // pull
  // -------------------------------------------------------------------------

  describe('pull', () => {
    it('constructs the correct URL for a given kind', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.pull('annotation' as SyncCategory);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://192.168.1.10:7878/replicas/annotation');
    });

    it('includes the since query parameter when a cursor is provided', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new WiFiHttpTransport('10.0.0.5', 9090);

      await t.pull('quote' as SyncCategory, HLC_A);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toContain('?since=');
      expect(fetchCalls[0]!.url).toContain(encodeURIComponent(HLC_A));
    });

    it('uses a different port for each transport instance', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new WiFiHttpTransport('localhost', 9999);

      await t.pull('dictionary-entry' as SyncCategory);

      expect(fetchCalls[0]!.url).toBe('http://localhost:9999/replicas/dictionary-entry');
    });

    it('returns parsed ReplicaRow array on successful fetch', async () => {
      const row = makeRow('annot-1', HLC_A, 'annotation');
      mockFetchResponse = createMockResponse([row]);

      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toHaveLength(1);
      expect(result[0]!.replica_id).toBe('annotation:annot-1');
      expect(result[0]!.schema_version).toBe(1);
    });

    it('returns only rows with schema_version === 1', async () => {
      const rowV1 = makeRow('annot-1', HLC_A);
      const rowV2 = { ...makeRow('annot-2', HLC_B), schema_version: 2 };
      mockFetchResponse = createMockResponse([rowV1, rowV2]);

      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toHaveLength(1);
      expect(result[0]!.schema_version).toBe(1);
      expect(result[0]!.replica_id).toBe('annotation:annot-1');
    });

    it('returns empty array when response is not a JSON array', async () => {
      mockFetchResponse = createMockResponse({ not: 'an array' });

      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toEqual([]);
    });

    it('returns empty array on HTTP error status (4xx, 5xx)', async () => {
      mockFetchResponse = createMockResponse('Not Found', 404);

      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toEqual([]);
    });

    it('returns empty array on connection refused (fetch throws)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toEqual([]);
    });

    it('returns empty array on network timeout', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toEqual([]);
    });

    it('passes an AbortController signal to fetch (5s timeout)', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.pull('annotation' as SyncCategory);

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -------------------------------------------------------------------------
  // push
  // -------------------------------------------------------------------------

  describe('push', () => {
    it('does nothing when rows array is empty', async () => {
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.push('annotation' as SyncCategory, []);

      expect(fetchCalls).toHaveLength(0);
    });

    it('PUTs rows as JSON to the correct URL', async () => {
      mockFetchResponse = createMockResponse({ merged: 1 });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const rows = [makeRow('annot-1', HLC_A)];

      await t.push('annotation' as SyncCategory, rows);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://192.168.1.10:7878/replicas/annotation');
      expect(fetchCalls[0]!.init?.method).toBe('PUT');
      expect(fetchCalls[0]!.init?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );
    });

    it('serializes the rows array as JSON body', async () => {
      mockFetchResponse = createMockResponse({ merged: 1 });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const rowA = makeRow('annot-1', HLC_A);
      const rowB = makeRow('annot-2', HLC_B);

      await t.push('annotation' as SyncCategory, [rowA, rowB]);

      const body = JSON.parse(fetchCalls[0]!.init!.body as string);
      expect(body).toHaveLength(2);
      expect(body[0].replica_id).toBe('annotation:annot-1');
      expect(body[1].replica_id).toBe('annotation:annot-2');
    });

    it('uses correct URL for different kinds', async () => {
      mockFetchResponse = createMockResponse({ merged: 0 });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.push('quote' as SyncCategory, [makeRow('q-1', HLC_A, 'quote')]);

      expect(fetchCalls[0]!.url).toBe('http://192.168.1.10:7878/replicas/quote');
    });

    it('silently fails on network error (push is best-effort)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      // Should not throw
      await expect(
        t.push('annotation' as SyncCategory, [makeRow('annot-1', HLC_A)]),
      ).resolves.toBeUndefined();
    });

    it('passes AbortController signal for timeout protection', async () => {
      mockFetchResponse = createMockResponse({ merged: 1 });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.push('annotation' as SyncCategory, [makeRow('annot-1', HLC_A)]);

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -------------------------------------------------------------------------
  // isReachable
  // -------------------------------------------------------------------------

  describe('isReachable', () => {
    it('returns true when /health responds with 200', async () => {
      mockFetchResponse = createMockResponse({ status: 'ok', deviceName: 'test' });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.isReachable!();

      expect(result).toBe(true);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://192.168.1.10:7878/health');
    });

    it('returns false when /health responds with non-200 status', async () => {
      mockFetchResponse = createMockResponse('Internal Server Error', 500);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.isReachable!();

      expect(result).toBe(false);
    });

    it('returns false when connection is refused (fetch throws)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.isReachable!();

      expect(result).toBe(false);
    });

    it('returns false on timeout', async () => {
      mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.isReachable!();

      expect(result).toBe(false);
    });

    it('uses AbortController with 5s timeout', async () => {
      mockFetchResponse = createMockResponse({ status: 'ok' });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.isReachable!();

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('reports different hosts independently', async () => {
      // Host A is reachable
      mockFetchResponse = createMockResponse({ status: 'ok' });
      const tA = new WiFiHttpTransport('192.168.1.10', 7878);
      const resultA = await tA.isReachable!();
      expect(resultA).toBe(true);

      // Host B is not reachable
      mockFetch.mockRejectedValueOnce(new TypeError('Connection refused'));
      const tB = new WiFiHttpTransport('192.168.1.20', 7878);
      const resultB = await tB.isReachable!();
      expect(resultB).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // pullDictionaryImage — binary image sync
  // -------------------------------------------------------------------------

  describe('pullDictionaryImage', () => {
    it('constructs URL to fetch dictionary image by entryId', async () => {
      mockFetchResponse = createMockResponse('', 200, {}, new ArrayBuffer(8));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.pullDictionaryImage!('entry-abc');

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://192.168.1.10:7878/dictionary-images/entry-abc');
    });

    it('returns ArrayBuffer bytes on successful fetch', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
      mockFetchResponse = createMockResponse('', 200, {}, bytes);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.pullDictionaryImage!('entry-1');

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('returns null when server responds with 404', async () => {
      mockFetchResponse = createMockResponse('Not Found', 404);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.pullDictionaryImage!('missing-entry');

      expect(result).toBeNull();
    });

    it('returns null on connection refused (fetch throws)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      const result = await t.pullDictionaryImage!('any-entry');

      expect(result).toBeNull();
    });

    it('uses AbortController signal for timeout', async () => {
      mockFetchResponse = createMockResponse('', 200, {}, new ArrayBuffer(4));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.pullDictionaryImage!('entry-x');

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses different entryIds to target different files', async () => {
      mockFetchResponse = createMockResponse('', 200, {}, new ArrayBuffer(4));
      const t = new WiFiHttpTransport('10.0.0.1', 9090);

      await t.pullDictionaryImage!('dict-entry-42');

      expect(fetchCalls[0]!.url).toBe('http://10.0.0.1:9090/dictionary-images/dict-entry-42');
    });
  });

  // -------------------------------------------------------------------------
  // pushDictionaryImage — binary image upload
  // -------------------------------------------------------------------------

  describe('pushDictionaryImage', () => {
    it('PUTs image bytes to the correct URL', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const bytes = new Uint8Array([1, 2, 3]).buffer;

      const result = await t.pushDictionaryImage!('entry-1', bytes);

      expect(result.uploaded).toBe(true);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://192.168.1.10:7878/dictionary-images/entry-1');
      expect(fetchCalls[0]!.init?.method).toBe('PUT');
      expect(fetchCalls[0]!.init?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'image/png' }),
      );
    });

    it('sends the raw binary body', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const bytes = new Uint8Array([10, 20, 30, 40]).buffer;

      await t.pushDictionaryImage!('entry-x', bytes);

      expect(fetchCalls[0]!.init!.body).toBe(bytes);
    });

    it('returns uploaded: false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const bytes = new Uint8Array([1]).buffer;

      const result = await t.pushDictionaryImage!('entry-1', bytes);

      expect(result.uploaded).toBe(false);
    });

    it('returns uploaded: false on non-2xx response', async () => {
      mockFetchResponse = createMockResponse('Internal Error', 500);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const bytes = new Uint8Array([1]).buffer;

      const result = await t.pushDictionaryImage!('entry-1', bytes);

      expect(result.uploaded).toBe(false);
    });

    it('uses AbortController signal for timeout', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);

      await t.pushDictionaryImage!('entry-1', new Uint8Array([1]).buffer);

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -------------------------------------------------------------------------
  // Interface contract — implements SyncTransport
  // -------------------------------------------------------------------------

  describe('implements SyncTransport', () => {
    it('has kind = "wifi"', () => {
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      expect(t.kind).toBe('wifi');
    });

    it('pull and push accept SyncCategory and ReplicaRow types', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const row = makeRow('test', HLC_A);

      // Should compile and run without type errors
      const pullResult: ReplicaRow[] = await t.pull('annotation' as SyncCategory);
      expect(pullResult).toEqual([]);

      await t.push('annotation' as SyncCategory, [row]);
    });

    it('isReachable is callable and returns boolean', async () => {
      mockFetchResponse = createMockResponse({ status: 'ok' });
      const t = new WiFiHttpTransport('192.168.1.10', 7878);
      const reachable: boolean = await t.isReachable!();
      expect(typeof reachable).toBe('boolean');
    });
  });
});
