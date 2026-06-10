import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplicaRow, Hlc, FieldsObject } from '@/types/replica';
import type { WebDAVConfig } from '@/services/webdav/WebDAVClient';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetFile = vi.fn<(config: WebDAVConfig, path: string) => Promise<string | null>>();
const mockPutFile =
  vi.fn<
    (config: WebDAVConfig, path: string, body: string, contentType?: string) => Promise<void>
  >();
const mockEnsureDirectory = vi.fn<(config: WebDAVConfig, ancestors: string[]) => Promise<void>>();

// Binary mocks for dictionary image sync
const mockHeadFile =
  vi.fn<(config: WebDAVConfig, path: string) => Promise<{ size?: number; etag?: string } | null>>();
const mockGetFileBinary =
  vi.fn<(config: WebDAVConfig, path: string) => Promise<ArrayBuffer | null>>();
const mockPutFileBinary =
  vi.fn<
    (config: WebDAVConfig, path: string, body: ArrayBuffer, contentType?: string) => Promise<void>
  >();

vi.mock('@/services/webdav/WebDAVClient', () => ({
  getFile: mockGetFile,
  putFile: mockPutFile,
  ensureDirectory: mockEnsureDirectory,
  headFile: mockHeadFile,
  getFileBinary: mockGetFileBinary,
  putFileBinary: mockPutFileBinary,
}));

vi.mock('@/services/webdav/WebDAVPaths', () => ({
  buildBasePath: (rootPath: string) => `/normalized${rootPath}/Readest`,
  ancestorsOf: (absPath: string) =>
    absPath
      .split('/')
      .filter(Boolean)
      .slice(0, -1)
      .reduce<string[]>((acc, seg, i) => {
        acc.push(i === 0 ? `/${seg}` : `${acc[i - 1]}/${seg}`);
        return acc;
      }, []),
  buildDictionaryImagePath: (rootPath: string, entryId: string) =>
    `/normalized${rootPath}/Readest/replicas/dictionary-images/${entryId}.png`,
}));

// Must import after mocks are set up
const { WebDAVTransport } = await import('@/services/sync/WebDAVTransport');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG: WebDAVConfig = {
  serverUrl: 'https://dav.example.com',
  username: 'test',
  password: 'test',
};

const ROOT_PATH = '/books';
const EXPECTED_REPLICAS_PATH = '/normalized/books/Readest/replicas/annotation.json';

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

function makeDeletedRow(id: string, hlc: Hlc, kind: string = 'annotation'): ReplicaRow {
  const row = makeRow(id, hlc, kind);
  row.deleted_at_ts = hlc;
  return row;
}

const HLC_A = '0000000000001-00000001-test-dev' as Hlc;
const HLC_B = '0000000000002-00000001-test-dev' as Hlc;
const HLC_C = '0000000000003-00000001-test-dev' as Hlc;

// ---------------------------------------------------------------------------
// pull
// ---------------------------------------------------------------------------

describe('WebDAVTransport.pull', () => {
  let transport: InstanceType<typeof WebDAVTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new WebDAVTransport(CONFIG, ROOT_PATH);
  });

  it('returns an empty array when the remote file does not exist (404)', async () => {
    mockGetFile.mockResolvedValue(null);

    const result = await transport.pull('annotation');

    expect(result).toEqual([]);
    expect(mockGetFile).toHaveBeenCalledWith(CONFIG, EXPECTED_REPLICAS_PATH);
  });

  it('returns parsed ReplicaRows from the remote file', async () => {
    const row = makeRow('annot-1', HLC_A);
    mockGetFile.mockResolvedValue(JSON.stringify([row]));

    const result = await transport.pull('annotation');

    expect(result).toHaveLength(1);
    expect(result[0]!.replica_id).toBe('annotation:annot-1');
    expect(result[0]!.schema_version).toBe(1);
  });

  it('returns an empty array when the remote file contains malformed JSON', async () => {
    mockGetFile.mockResolvedValue('not-json');

    const result = await transport.pull('annotation');

    expect(result).toEqual([]);
  });

  it('returns an empty array when the remote file is not a JSON array', async () => {
    mockGetFile.mockResolvedValue(JSON.stringify({ not: 'an-array' }));

    const result = await transport.pull('annotation');

    expect(result).toEqual([]);
  });

  it('filters by cursor — only returns rows with updated_at_ts > since', async () => {
    const rowA = makeRow('annot-1', HLC_A);
    const rowB = makeRow('annot-2', HLC_B);
    const rowC = makeRow('annot-3', HLC_C);
    mockGetFile.mockResolvedValue(JSON.stringify([rowA, rowB, rowC]));

    const result = await transport.pull('annotation', HLC_A);

    // HLC_B and HLC_C > HLC_A
    expect(result).toHaveLength(2);
    expect(result[0]!.replica_id).toBe('annotation:annot-2');
    expect(result[1]!.replica_id).toBe('annotation:annot-3');
  });

  it('returns all rows when no cursor (since) is provided', async () => {
    const rowA = makeRow('annot-1', HLC_A);
    const rowB = makeRow('annot-2', HLC_B);
    mockGetFile.mockResolvedValue(JSON.stringify([rowA, rowB]));

    const result = await transport.pull('annotation');

    expect(result).toHaveLength(2);
  });

  it('filters out rows with unknown schema_version', async () => {
    const rowV1 = makeRow('annot-1', HLC_A);
    const rowV2 = { ...makeRow('annot-2', HLC_B), schema_version: 2 };
    const rowV0 = { ...makeRow('annot-3', HLC_C), schema_version: 0 };
    mockGetFile.mockResolvedValue(JSON.stringify([rowV1, rowV2, rowV0]));

    const result = await transport.pull('annotation');

    expect(result).toHaveLength(1);
    expect(result[0]!.replica_id).toBe('annotation:annot-1');
    expect(result[0]!.schema_version).toBe(1);
  });

  it('uses the correct path for different kinds', async () => {
    mockGetFile.mockResolvedValue('[]');

    await transport.pull('quote');

    expect(mockGetFile).toHaveBeenCalledWith(
      CONFIG,
      '/normalized/books/Readest/replicas/quote.json',
    );
  });

  it('includes deleted (tombstone) rows in pull', async () => {
    const deleted = makeDeletedRow('annot-del', HLC_B);
    mockGetFile.mockResolvedValue(JSON.stringify([deleted]));

    const result = await transport.pull('annotation');

    expect(result).toHaveLength(1);
    expect(result[0]!.deleted_at_ts).toBe(HLC_B);
  });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

describe('WebDAVTransport.push', () => {
  let transport: InstanceType<typeof WebDAVTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new WebDAVTransport(CONFIG, ROOT_PATH);
  });

  it('does nothing when rows array is empty', async () => {
    await transport.push('annotation', []);

    expect(mockPutFile).not.toHaveBeenCalled();
    expect(mockGetFile).not.toHaveBeenCalled();
  });

  it('writes rows to the remote when the file does not exist yet', async () => {
    mockGetFile.mockResolvedValue(null); // file does not exist
    const row = makeRow('annot-1', HLC_A);

    await transport.push('annotation', [row]);

    expect(mockGetFile).toHaveBeenCalledWith(CONFIG, EXPECTED_REPLICAS_PATH);
    expect(mockPutFile).toHaveBeenCalledWith(CONFIG, EXPECTED_REPLICAS_PATH, JSON.stringify([row]));
  });

  it('appends new rows to existing remote rows', async () => {
    const existing = makeRow('annot-1', HLC_A);
    const newRow = makeRow('annot-2', HLC_B);
    mockGetFile.mockResolvedValue(JSON.stringify([existing]));

    await transport.push('annotation', [newRow]);

    // The merged payload should contain both rows
    const putCall = mockPutFile.mock.calls[0] as [WebDAVConfig, string, string];
    const merged = JSON.parse(putCall[2]) as ReplicaRow[];
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.replica_id).sort()).toEqual([
      'annotation:annot-1',
      'annotation:annot-2',
    ]);
  });

  it('replaces an existing row when the new row has a higher HLC', async () => {
    const existing = makeRow('annot-1', HLC_A);
    const updated = makeRow('annot-1', HLC_B); // same id, higher HLC
    mockGetFile.mockResolvedValue(JSON.stringify([existing]));

    await transport.push('annotation', [updated]);

    const putCall = mockPutFile.mock.calls[0] as [WebDAVConfig, string, string];
    const merged = JSON.parse(putCall[2]) as ReplicaRow[];
    expect(merged).toHaveLength(1);
    expect(merged[0]!.updated_at_ts).toBe(HLC_B);
    expect(merged[0]!.fields_jsonb['text']!.v).toBe('text-annot-1');
  });

  it('keeps the existing row when the new row has a lower HLC', async () => {
    const existing = makeRow('annot-1', HLC_C);
    const older = makeRow('annot-1', HLC_A); // same id, lower HLC
    mockGetFile.mockResolvedValue(JSON.stringify([existing]));

    await transport.push('annotation', [older]);

    const putCall = mockPutFile.mock.calls[0] as [WebDAVConfig, string, string];
    const merged = JSON.parse(putCall[2]) as ReplicaRow[];
    expect(merged).toHaveLength(1);
    // Existing row should have been kept (higher HLC)
    expect(merged[0]!.updated_at_ts).toBe(HLC_C);
  });

  it('merges multiple rows including tombstones', async () => {
    const existing = makeRow('annot-1', HLC_A);
    const tombstone = makeDeletedRow('annot-2', HLC_B);
    const newRow = makeRow('annot-3', HLC_C);
    mockGetFile.mockResolvedValue(JSON.stringify([existing]));

    await transport.push('annotation', [tombstone, newRow]);

    const putCall = mockPutFile.mock.calls[0] as [WebDAVConfig, string, string];
    const merged = JSON.parse(putCall[2]) as ReplicaRow[];
    expect(merged).toHaveLength(3);
    // Verify the tombstone row is preserved
    const tombstoned = merged.find((r) => r.replica_id === 'annotation:annot-2');
    expect(tombstoned).toBeDefined();
    expect(tombstoned!.deleted_at_ts).toBe(HLC_B);
  });

  it('handles malformed existing remote file by treating it as empty', async () => {
    mockGetFile.mockResolvedValue('not-valid-json');
    const row = makeRow('annot-1', HLC_A);

    await transport.push('annotation', [row]);

    const putCall = mockPutFile.mock.calls[0] as [WebDAVConfig, string, string];
    const merged = JSON.parse(putCall[2]) as ReplicaRow[];
    expect(merged).toHaveLength(1);
    expect(merged[0]!.replica_id).toBe('annotation:annot-1');
  });

  it('filters out non-v1 rows from existing file during merge', async () => {
    const existingV2 = { ...makeRow('annot-old', HLC_A), schema_version: 2 };
    mockGetFile.mockResolvedValue(JSON.stringify([existingV2]));
    const row = makeRow('annot-1', HLC_B);

    await transport.push('annotation', [row]);

    const putCall = mockPutFile.mock.calls[0] as [WebDAVConfig, string, string];
    const merged = JSON.parse(putCall[2]) as ReplicaRow[];
    expect(merged).toHaveLength(1);
    expect(merged[0]!.replica_id).toBe('annotation:annot-1');
  });
});

// ---------------------------------------------------------------------------
// Dictionary image binary sync
// ---------------------------------------------------------------------------

const IMG_PATH = '/normalized/books/Readest/replicas/dictionary-images/entry-1.png';

describe('WebDAVTransport.pullDictionaryImage', () => {
  let transport: InstanceType<typeof WebDAVTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new WebDAVTransport(CONFIG, ROOT_PATH);
  });

  it('returns null when the remote image does not exist (404)', async () => {
    mockGetFileBinary.mockResolvedValue(null);

    const result = await transport.pullDictionaryImage('entry-1');

    expect(result).toBeNull();
    expect(mockGetFileBinary).toHaveBeenCalledWith(CONFIG, IMG_PATH);
  });

  it('returns the image bytes when the remote file exists', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    mockGetFileBinary.mockResolvedValue(bytes);

    const result = await transport.pullDictionaryImage('entry-1');

    expect(result).toBe(bytes);
    expect(mockGetFileBinary).toHaveBeenCalledWith(CONFIG, IMG_PATH);
  });
});

describe('WebDAVTransport.pushDictionaryImage', () => {
  let transport: InstanceType<typeof WebDAVTransport>;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new WebDAVTransport(CONFIG, ROOT_PATH);
  });

  it('uploads image bytes when remote does not exist (HEAD returns null)', async () => {
    mockHeadFile.mockResolvedValue(null);
    mockPutFileBinary.mockResolvedValue(undefined);

    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const result = await transport.pushDictionaryImage('entry-1', bytes);

    expect(result.uploaded).toBe(true);
    expect(mockHeadFile).toHaveBeenCalledWith(CONFIG, IMG_PATH);
    expect(mockEnsureDirectory).toHaveBeenCalled();
    expect(mockPutFileBinary).toHaveBeenCalledWith(CONFIG, IMG_PATH, bytes, 'image/png');
  });

  it('skips upload when remote HEAD reports same byte size', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    mockHeadFile.mockResolvedValue({ size: 4 });

    const result = await transport.pushDictionaryImage('entry-1', bytes);

    expect(result.uploaded).toBe(false);
    expect(mockPutFileBinary).not.toHaveBeenCalled();
  });

  it('uploads when remote HEAD reports different byte size', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    mockHeadFile.mockResolvedValue({ size: 999 });

    const result = await transport.pushDictionaryImage('entry-1', bytes);

    expect(result.uploaded).toBe(true);
    expect(mockPutFileBinary).toHaveBeenCalledWith(CONFIG, IMG_PATH, bytes, 'image/png');
  });

  it('proceeds with upload when HEAD probe fails (network error)', async () => {
    mockHeadFile.mockRejectedValue(new Error('Network error'));
    mockPutFileBinary.mockResolvedValue(undefined);

    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const result = await transport.pushDictionaryImage('entry-1', bytes);

    expect(result.uploaded).toBe(true);
    expect(mockPutFileBinary).toHaveBeenCalled();
  });

  it('round-trips: push then pull returns same bytes', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]).buffer;
    const bytesClone = new Uint8Array([10, 20, 30, 40, 50]).buffer;

    // Setup: push side
    mockHeadFile.mockResolvedValue(null);
    mockPutFileBinary.mockResolvedValue(undefined);

    await transport.pushDictionaryImage('entry-2', bytes);

    // Verify push called with correct bytes
    const putCall = mockPutFileBinary.mock.calls[0] as [
      WebDAVConfig,
      string,
      ArrayBuffer,
      string | undefined,
    ];
    expect(putCall[1]).toBe('/normalized/books/Readest/replicas/dictionary-images/entry-2.png');
    expect(new Uint8Array(putCall[2])).toEqual(new Uint8Array(bytesClone));

    // Setup: pull side
    mockGetFileBinary.mockResolvedValue(bytesClone);

    const pulled = await transport.pullDictionaryImage('entry-2');

    expect(pulled).not.toBeNull();
    expect(new Uint8Array(pulled!)).toEqual(new Uint8Array(bytesClone));
  });
});
