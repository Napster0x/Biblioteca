import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsbBookManifest } from '@/services/sync/SyncTransport';
import type { ReplicaRow, Hlc, FieldsObject, SyncError } from '@/types/replica';
import type { SyncCategory } from '@/types/settings';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

let mockFetchResponse: Response;
let fetchCalls: { url: string; init?: RequestInit }[] = [];

function createMockResponse(
  body: unknown,
  status: number = 200,
  binaryBody?: ArrayBuffer,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
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

// Mock child_process.exec for adb calls
const mockExec = vi.fn();
vi.mock('child_process', () => ({
  exec: mockExec,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HLC_A = '0000000000001-00000001-test-dev' as Hlc;
const HLC_B = '0000000000002-00000001-test-dev' as Hlc;

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
// Tests
// ---------------------------------------------------------------------------

describe('USBHttpTransport', () => {
  let USBHttpTransport: typeof import('@/services/sync/USBHttpTransport').USBHttpTransport;

  beforeAll(async () => {
    vi.stubGlobal('fetch', mockFetch);
    const mod = await import('@/services/sync/USBHttpTransport');
    USBHttpTransport = mod.USBHttpTransport;
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
    it('stores port and exposes kind as "usb"', () => {
      const t = new USBHttpTransport(7878);
      expect(t.kind).toBe('usb');
    });

    it('accepts any valid port number', () => {
      const t1 = new USBHttpTransport(8080);
      expect(t1.kind).toBe('usb');

      const t2 = new USBHttpTransport(9999);
      expect(t2.kind).toBe('usb');
    });
  });

  // -------------------------------------------------------------------------
  // pull — targets localhost
  // -------------------------------------------------------------------------

  describe('pull', () => {
    it('constructs URL using localhost and configured port', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new USBHttpTransport(7878);

      await t.pull('annotation' as SyncCategory);

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/replicas/annotation');
    });

    it('uses a different port when configured', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new USBHttpTransport(9090);

      await t.pull('quote' as SyncCategory);

      expect(fetchCalls[0]!.url).toBe('http://localhost:9090/replicas/quote');
    });

    it('includes since query parameter when cursor is provided', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new USBHttpTransport(7878);

      await t.pull('annotation' as SyncCategory, HLC_A);

      expect(fetchCalls[0]!.url).toContain('?since=');
      expect(fetchCalls[0]!.url).toContain(encodeURIComponent(HLC_A));
    });

    it('returns rows with schema_version === 1', async () => {
      const rowV1 = makeRow('annot-1', HLC_A);
      const rowV2 = { ...makeRow('annot-2', HLC_B), schema_version: 2 };
      mockFetchResponse = createMockResponse([rowV1, rowV2]);

      const t = new USBHttpTransport(7878);
      const result = await t.pull('annotation' as SyncCategory);

      expect(result).toHaveLength(1);
      expect(result[0]!.replica_id).toBe('annotation:annot-1');
    });

    it('throws SyncError on HTTP error', async () => {
      mockFetchResponse = createMockResponse('Not Found', 404);
      const t = new USBHttpTransport(7878);

      await expect(t.pull('annotation' as SyncCategory)).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'annotation',
        message: expect.stringContaining('404'),
      } as SyncError);
    });

    it('throws SyncError on connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Connection refused'));
      const t = new USBHttpTransport(7878);

      await expect(t.pull('annotation' as SyncCategory)).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'annotation',
        message: 'Connection refused',
      } as SyncError);
    });

    it('uses AbortController signal for timeout', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new USBHttpTransport(7878);

      await t.pull('annotation' as SyncCategory);

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -------------------------------------------------------------------------
  // push — targets localhost
  // -------------------------------------------------------------------------

  describe('push', () => {
    it('does nothing when rows array is empty', async () => {
      const t = new USBHttpTransport(7878);

      await t.push('annotation' as SyncCategory, []);

      expect(fetchCalls).toHaveLength(0);
    });

    it('PUTs JSON to localhost URL', async () => {
      mockFetchResponse = createMockResponse({ merged: 1 });
      const t = new USBHttpTransport(7878);
      const rows = [makeRow('annot-1', HLC_A)];

      await t.push('annotation' as SyncCategory, rows);

      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/replicas/annotation');
      expect(fetchCalls[0]!.init?.method).toBe('PUT');
      expect(fetchCalls[0]!.init?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );
    });

    it('serializes rows as JSON body', async () => {
      mockFetchResponse = createMockResponse({ merged: 1 });
      const t = new USBHttpTransport(7878);
      const rowA = makeRow('annot-1', HLC_A);
      const rowB = makeRow('annot-2', HLC_B);

      await t.push('annotation' as SyncCategory, [rowA, rowB]);

      const body = JSON.parse(fetchCalls[0]!.init!.body as string);
      expect(body).toHaveLength(2);
    });

    it('throws SyncError on connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const t = new USBHttpTransport(7878);

      await expect(
        t.push('annotation' as SyncCategory, [makeRow('annot-1', HLC_A)]),
      ).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'annotation',
        message: 'Connection refused',
      } as SyncError);
    });

    it('throws SyncError on HTTP 500 error', async () => {
      mockFetchResponse = createMockResponse('Internal Server Error', 500);
      const t = new USBHttpTransport(7878);

      await expect(
        t.push('annotation' as SyncCategory, [makeRow('annot-1', HLC_A)]),
      ).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'annotation',
        message: expect.stringContaining('500'),
      } as SyncError);
    });
  });

  // -------------------------------------------------------------------------
  // isReachable — probes localhost /health
  // -------------------------------------------------------------------------

  describe('isReachable', () => {
    it('returns true when localhost /health responds 200', async () => {
      mockFetchResponse = createMockResponse({ status: 'ok', deviceName: 'test' });
      const t = new USBHttpTransport(7878);

      const result = await t.isReachable!();

      expect(result).toBe(true);
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/health');
    });

    it('returns false when /health responds non-200', async () => {
      mockFetchResponse = createMockResponse('Error', 503);
      const t = new USBHttpTransport(7878);

      const result = await t.isReachable!();

      expect(result).toBe(false);
    });

    it('returns false on connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Connection refused'));
      const t = new USBHttpTransport(7878);

      const result = await t.isReachable!();

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // pullDictionaryImage — binary image sync via localhost
  // -------------------------------------------------------------------------

  describe('pullDictionaryImage', () => {
    it('constructs URL using localhost and configured port', async () => {
      mockFetchResponse = createMockResponse('', 200, new ArrayBuffer(8));
      const t = new USBHttpTransport(7878);

      await t.pullDictionaryImage!('entry-abc');

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/dictionary-images/entry-abc');
    });

    it('returns ArrayBuffer bytes on success', async () => {
      const bytes = new Uint8Array([10, 20, 30]).buffer;
      mockFetchResponse = createMockResponse('', 200, bytes);
      const t = new USBHttpTransport(7878);

      const result = await t.pullDictionaryImage!('entry-1');

      expect(new Uint8Array(result!)).toEqual(new Uint8Array([10, 20, 30]));
    });

    it('returns null on 404', async () => {
      mockFetchResponse = createMockResponse('Not Found', 404);
      const t = new USBHttpTransport(7878);

      const result = await t.pullDictionaryImage!('missing');

      expect(result).toBeNull();
    });

    it('throws SyncError on connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Connection refused'));
      const t = new USBHttpTransport(7878);

      await expect(t.pullDictionaryImage!('any')).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'dictionary-entry',
        message: 'Connection refused',
      } as SyncError);
    });

    it('uses AbortController signal', async () => {
      mockFetchResponse = createMockResponse('', 200, new ArrayBuffer(4));
      const t = new USBHttpTransport(7878);

      await t.pullDictionaryImage!('entry-x');

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // -------------------------------------------------------------------------
  // pushDictionaryImage — binary image upload via localhost
  // -------------------------------------------------------------------------

  describe('pushDictionaryImage', () => {
    /** Create a minimal valid PNG array buffer (magic + 4-byte chunk header). */
    function makePngBuffer(extra: number[] = []): ArrayBuffer {
      return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...extra]).buffer;
    }

    it('PUTs image bytes to localhost URL', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new USBHttpTransport(7878);
      const bytes = makePngBuffer([5, 6, 7, 8]);

      const result = await t.pushDictionaryImage!('entry-1', bytes);

      expect(result.uploaded).toBe(true);
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/dictionary-images/entry-1');
      expect(fetchCalls[0]!.init?.method).toBe('PUT');
      expect(fetchCalls[0]!.init?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'image/png' }),
      );
    });

    it('sends raw binary body', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new USBHttpTransport(7878);
      const bytes = makePngBuffer([100, 200]);

      await t.pushDictionaryImage!('entry-y', bytes);

      expect(fetchCalls[0]!.init!.body).toBe(bytes);
    });

    it('throws SyncError on connection refused', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const t = new USBHttpTransport(7878);

      await expect(t.pushDictionaryImage!('entry-1', makePngBuffer())).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'dictionary-entry',
        message: 'Connection refused',
      } as SyncError);
    });

    it('throws SyncError on non-2xx', async () => {
      mockFetchResponse = createMockResponse('Error', 500);
      const t = new USBHttpTransport(7878);

      await expect(t.pushDictionaryImage!('entry-1', makePngBuffer())).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'dictionary-entry',
        message: expect.stringContaining('500'),
      } as SyncError);
    });

    it('uses AbortController signal', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new USBHttpTransport(7878);

      await t.pushDictionaryImage!('entry-1', makePngBuffer());

      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('rejects non-PNG bytes with a sync error', async () => {
      const t = new USBHttpTransport(7878);
      const nonPng = new Uint8Array([0, 1, 2, 3]).buffer;

      await expect(t.pushDictionaryImage!('entry-1', nonPng)).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'dictionary-entry',
        message: 'Not a valid PNG image',
      } as SyncError);
    });
  });

  // -------------------------------------------------------------------------
  // Book endpoints — binary book sync via localhost
  // -------------------------------------------------------------------------

  describe('book endpoints', () => {
    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'book-a',
          book: {
            hash: 'book-a',
            format: 'EPUB',
            title: 'USB Book',
            author: 'Author',
            createdAt: 1,
            updatedAt: 2,
          },
          assets: [
            { name: 'book', required: true, size: 100 },
            { name: 'cover.png', required: true, size: 10 },
          ],
        },
      ],
    };

    it('pulls the book manifest from /books/manifest with timeout signal', async () => {
      mockFetchResponse = createMockResponse(manifest);
      const t = new USBHttpTransport(7878);

      const result = await t.pullBookManifest!();

      expect(result.books[0]!.hash).toBe('book-a');
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/books/manifest');
      expect(fetchCalls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('PUTs sanitized book library metadata to /books/library as JSON', async () => {
      mockFetchResponse = createMockResponse({ merged: 1, skipped: 0 });
      const t = new USBHttpTransport(7878);

      await t.pushBookLibrary!([
        {
          hash: 'book-a',
          format: 'EPUB',
          title: 'USB Book',
          author: 'Author',
          filePath: '/sender/path/book.epub',
          createdAt: 1,
          updatedAt: 2,
        },
      ]);

      const body = JSON.parse(fetchCalls[0]!.init!.body as string) as Array<{ filePath?: string }>;
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/books/library');
      expect(fetchCalls[0]!.init?.method).toBe('PUT');
      expect(fetchCalls[0]!.init?.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/json' }),
      );
      expect(body[0]!.filePath).toBeUndefined();
    });

    it('pulls required book assets as binary ArrayBuffers', async () => {
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      mockFetchResponse = createMockResponse('', 200, bytes);
      const t = new USBHttpTransport(7878);

      const result = await t.pullBookAsset!('book-a', 'book');

      expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3]));
      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/books/assets/book-a/book');
    });

    it('returns null when optional nav asset is missing', async () => {
      mockFetchResponse = createMockResponse('Not Found', 404);
      const t = new USBHttpTransport(7878);

      const result = await t.pullBookAsset!('book-a', 'nav.json', { optional: true });

      expect(result).toBeNull();
    });

    it('throws SyncError when a required book asset returns HTTP error', async () => {
      mockFetchResponse = createMockResponse('Missing book', 404);
      const t = new USBHttpTransport(7878);

      await expect(t.pullBookAsset!('book-a', 'book')).rejects.toMatchObject({
        peerId: 'localhost:7878',
        kind: 'book',
        message: expect.stringContaining('404'),
      });
    });

    it('PUTs raw book asset bytes with binary body', async () => {
      mockFetchResponse = createMockResponse({ uploaded: true });
      const t = new USBHttpTransport(7878);
      const bytes = new Uint8Array([9, 8, 7]).buffer;

      await t.pushBookAsset!('book-a', 'cover.png', bytes);

      expect(fetchCalls[0]!.url).toBe('http://localhost:7878/books/assets/book-a/cover.png');
      expect(fetchCalls[0]!.init?.method).toBe('PUT');
      expect(fetchCalls[0]!.init?.body).toBe(bytes);
    });
  });

  // -------------------------------------------------------------------------
  // Interface contract
  // -------------------------------------------------------------------------

  describe('implements SyncTransport', () => {
    it('has kind = "usb"', () => {
      const t = new USBHttpTransport(7878);
      expect(t.kind).toBe('usb');
    });

    it('pull and push accept correct signatures', async () => {
      mockFetchResponse = createMockResponse([]);
      const t = new USBHttpTransport(7878);

      const pullResult: ReplicaRow[] = await t.pull('annotation' as SyncCategory);
      expect(pullResult).toEqual([]);

      await t.push('annotation' as SyncCategory, [makeRow('test', HLC_A)]);
    });
  });
});

// ---------------------------------------------------------------------------
// Image integrity — isPng and verifyImageManifest
// ---------------------------------------------------------------------------

describe('isPng', () => {
  let isPng: typeof import('@/services/sync/USBHttpTransport').isPng;

  beforeAll(async () => {
    const mod = await import('@/services/sync/USBHttpTransport');
    isPng = mod.isPng;
  });

  it('returns true for PNG magic bytes', () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer;
    expect(isPng(pngBytes)).toBe(true);
  });

  it('returns false for non-PNG bytes', () => {
    const nonPng = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
    expect(isPng(nonPng)).toBe(false);
  });

  it('returns false for empty buffer', () => {
    expect(isPng(new ArrayBuffer(0))).toBe(false);
  });

  it('returns false for buffer smaller than PNG magic', () => {
    const short = new Uint8Array([137, 80, 78]).buffer;
    expect(isPng(short)).toBe(false);
  });

  it('returns true for PNG with 4-byte chunk header (triangulation)', () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
      .buffer;
    expect(isPng(pngBytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyImageManifest — dictionary image integrity
// ---------------------------------------------------------------------------

describe('verifyImageManifest', () => {
  let verifyImageManifest: typeof import('@/services/sync/USBHttpTransport').verifyImageManifest;

  beforeAll(async () => {
    const mod = await import('@/services/sync/USBHttpTransport');
    verifyImageManifest = mod.verifyImageManifest;
  });

  it('returns {valid: false} when sha256 does not match (manifest says X, content differs)', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer;

    // Mock crypto.subtle.digest to return all zero bytes — guaranteed mismatch
    const mockDigest = vi.fn().mockResolvedValue(new Uint8Array(32).buffer);
    vi.stubGlobal('crypto', { subtle: { digest: mockDigest } });

    try {
      const result = await verifyImageManifest(pngBytes, {
        sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('SHA-256 mismatch');
      expect(mockDigest).toHaveBeenCalledWith('SHA-256', pngBytes);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns {valid: true} when sha256 matches', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer;

    // Compute the *actual* sha256 of those bytes so the hash is real
    const knownHash = '4f43ea3f1004c954b6bbeb21fd2694281a4f6ec2bcb137781f1e0b6875dee49a';
    const hashBytes = new Uint8Array(knownHash.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
    const mockDigest = vi.fn().mockResolvedValue(hashBytes.buffer);
    vi.stubGlobal('crypto', { subtle: { digest: mockDigest } });

    try {
      const result = await verifyImageManifest(pngBytes, { sha256: knownHash });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// ADB utility functions
// ---------------------------------------------------------------------------

describe('setupUsbTunnel', () => {
  let setupUsbTunnel: typeof import('@/services/sync/USBHttpTransport').setupUsbTunnel;

  beforeAll(async () => {
    const mod = await import('@/services/sync/USBHttpTransport');
    setupUsbTunnel = mod.setupUsbTunnel;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes the correct adb forward command', async () => {
    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, '', '');
      },
    );

    const result = await setupUsbTunnel('emulator-5554', 7878);

    expect(result.success).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      'adb -s emulator-5554 forward tcp:7878 tcp:7878',
      expect.any(Function),
    );
  });

  it('returns success: false when adb command fails', async () => {
    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('adb: command not found'), '', '');
      },
    );

    const result = await setupUsbTunnel('device-1', 7878);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('uses different port when configured', async () => {
    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, '', '');
      },
    );

    await setupUsbTunnel('device-1', 9999);

    expect(mockExec).toHaveBeenCalledWith(
      'adb -s device-1 forward tcp:9999 tcp:9999',
      expect.any(Function),
    );
  });
});

describe('listUsbDevices', () => {
  let listUsbDevices: typeof import('@/services/sync/USBHttpTransport').listUsbDevices;

  beforeAll(async () => {
    const mod = await import('@/services/sync/USBHttpTransport');
    listUsbDevices = mod.listUsbDevices;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses adb devices output to extract serials', async () => {
    const adbOutput = [
      'List of devices attached',
      'emulator-5554\tdevice',
      '192.168.1.10:5555\tdevice',
      '',
      'some-device\trecovery',
    ].join('\n');

    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, adbOutput, '');
      },
    );

    const devices = await listUsbDevices();

    expect(devices).toEqual(['emulator-5554', '192.168.1.10:5555', 'some-device']);
  });

  it('filters out empty serials and the header line', async () => {
    const adbOutput = ['List of devices attached', '', ' '].join('\n');

    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, adbOutput, '');
      },
    );

    const devices = await listUsbDevices();

    expect(devices).toEqual([]);
  });

  it('returns empty array when adb is not installed', async () => {
    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(new Error('ENOENT: adb not found'), '', '');
      },
    );

    const devices = await listUsbDevices();

    // Graceful degradation — no crash
    expect(devices).toEqual([]);
  });

  it('runs the "adb devices" command', async () => {
    mockExec.mockImplementation(
      (_cmd: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, 'List of devices attached\n', '');
      },
    );

    await listUsbDevices();

    expect(mockExec).toHaveBeenCalledWith('adb devices', expect.any(Function));
  });
});
