import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SyncTransport, UsbBookManifest } from '@/services/sync/SyncTransport';
import type { UsbBookFileService } from '@/services/sync/usbBookSync';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigJson(
  fields: Record<string, unknown>,
  timestamps: Record<string, string>,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt: Date.now(),
    progress: [1, 100],
    booknotes: [],
    viewSettings: { fontSize: 16 },
    location: 'local-cfi',
    searchConfig: { scope: 'book' },
    ...fields,
    _replica: { fieldTimestamps: timestamps },
  });
}

function makeBook(hash: string, title = `Book ${hash}`): Book {
  return {
    hash,
    format: 'EPUB',
    title,
    author: 'Author',
    filePath: `/sender-only/${hash}.epub`,
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeTransport(manifest: UsbBookManifest): SyncTransport {
  return {
    kind: 'usb',
    pull: vi.fn().mockResolvedValue([]),
    push: vi.fn().mockResolvedValue(undefined),
    pullBookManifest: vi.fn().mockResolvedValue(manifest),
    pullBookAsset: vi.fn().mockImplementation(async (_hash: string, asset: string) => {
      if (asset === 'nav.json') return null;
      return new TextEncoder().encode(asset).buffer;
    }),
    pushBookAsset: vi.fn().mockResolvedValue(undefined),
    pushBookLibrary: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFileService(
  library: Book[] = [],
): UsbBookFileService & { writes: Map<string, ArrayBuffer>; texts: Map<string, string> } {
  const writes = new Map<string, ArrayBuffer>();
  const texts = new Map<string, string>();
  return {
    writes,
    texts,
    readText: vi.fn().mockImplementation(async (path: string) => {
      if (texts.has(path)) return texts.get(path)!;
      if (path === 'library.json') return JSON.stringify(library);
      throw new Error(`missing ${path}`);
    }),
    writeText: vi.fn().mockImplementation(async (path: string, text: string) => {
      texts.set(path, text);
    }),
    readBinary: vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('/cover.png')) return new Uint8Array([1]).buffer;
      if (path.endsWith('/config.json')) return new TextEncoder().encode('{}').buffer;
      return new TextEncoder().encode('book').buffer;
    }),
    writeBinary: vi.fn().mockImplementation(async (path: string, bytes: ArrayBuffer) => {
      writes.set(path, bytes);
    }),
    fileExists: vi
      .fn()
      .mockImplementation(async (path: string) => path !== 'remote-only/Remote.epub'),
  };
}

describe('usbBookSync', () => {
  it('receives a missing remote book as managed local assets and strips sender filePath', async () => {
    const remoteBook = makeBook('remote-only', 'Remote');
    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'remote-only',
          book: remoteBook,
          assets: [
            { name: 'book', required: true },
            { name: 'cover.png', required: true },
            { name: 'config.json', required: true },
            { name: 'nav.json', required: false },
          ],
        },
      ],
    };
    const transport = makeTransport(manifest);
    const files = makeFileService([]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.received).toBe(1);
    expect(result.failedHashes).toEqual([]);
    expect(files.writes.has('remote-only/Remote.epub')).toBe(true);
    expect(files.writes.has('remote-only/cover.png')).toBe(true);
    expect(files.writes.has('remote-only/config.json')).toBe(true);
    const nextLibrary = JSON.parse(files.texts.get('library.json')!) as Array<{
      hash: string;
      filePath?: string;
    }>;
    expect(nextLibrary).toEqual([expect.objectContaining({ hash: 'remote-only' })]);
    expect(nextLibrary[0]!.filePath).toBeUndefined();
    expect(transport.pushBookLibrary).not.toHaveBeenCalled();
  });

  it('pushes local managed book assets to the remote book endpoints', async () => {
    const localBook = makeBook('local-only', 'Local');
    const transport = makeTransport({ books: [] });
    const files = makeFileService([localBook]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.sent).toBe(1);
    expect(transport.pushBookLibrary).toHaveBeenCalledWith([
      expect.objectContaining({ hash: 'local-only', filePath: undefined }),
    ]);
    const pushedAssets = vi
      .mocked(transport.pushBookAsset!)
      .mock.calls.map(([hash, asset, bytes]) => ({
        hash,
        asset,
        bytes: new Uint8Array(bytes),
      }));
    expect(pushedAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hash: 'local-only',
          asset: 'book',
          bytes: new Uint8Array([98, 111, 111, 107]),
        }),
        expect.objectContaining({
          hash: 'local-only',
          asset: 'cover.png',
          bytes: new Uint8Array([1]),
        }),
        expect.objectContaining({
          hash: 'local-only',
          asset: 'config.json',
          bytes: new Uint8Array([123, 125]),
        }),
      ]),
    );
  });

  it('applies a remote tombstone over a stale local live book without re-pushing assets', async () => {
    const localBook = makeBook('deleted-remote', 'Deleted Remote');
    const remoteTombstone: Book = {
      ...localBook,
      updatedAt: 10,
      deletedAt: 11,
      downloadedAt: null,
    };
    const transport = makeTransport({
      books: [{ hash: 'deleted-remote', book: remoteTombstone, assets: [] }],
    });
    const files = makeFileService([localBook]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.sent).toBe(0);
    expect(result.received).toBe(0);
    expect(transport.pushBookLibrary).not.toHaveBeenCalled();
    expect(transport.pushBookAsset).not.toHaveBeenCalled();
    expect(transport.pullBookAsset).not.toHaveBeenCalled();
    const nextLibrary = JSON.parse(files.texts.get('library.json')!) as Book[];
    expect(nextLibrary).toEqual([
      expect.objectContaining({ hash: 'deleted-remote', deletedAt: 11 }),
    ]);
    const nextBackup = JSON.parse(files.texts.get('library.json.bak')!) as Book[];
    expect(nextBackup).toEqual([
      expect.objectContaining({ hash: 'deleted-remote', deletedAt: 11 }),
    ]);
  });

  it('re-pushes a local re-add when local createdAt is newer than the remote tombstone deletedAt', async () => {
    const localReimport: Book = {
      ...makeBook('reimport-local', 'Reimport Local'),
      createdAt: 200,
      updatedAt: 201,
      deletedAt: null,
    };
    const remoteTombstone: Book = {
      ...localReimport,
      createdAt: 1,
      updatedAt: 100,
      deletedAt: 101,
      downloadedAt: null,
    };
    const transport = makeTransport({
      books: [{ hash: 'reimport-local', book: remoteTombstone, assets: [] }],
    });
    const files = makeFileService([localReimport]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.sent).toBe(1);
    expect(transport.pushBookLibrary).toHaveBeenCalledWith([
      expect.objectContaining({ hash: 'reimport-local', createdAt: 200, deletedAt: null }),
    ]);
    const pushedAssets = vi
      .mocked(transport.pushBookAsset!)
      .mock.calls.map(([hash, asset]) => ({ hash, asset }));
    expect(pushedAssets).toEqual(
      expect.arrayContaining([
        { hash: 'reimport-local', asset: 'book' },
        { hash: 'reimport-local', asset: 'cover.png' },
        { hash: 'reimport-local', asset: 'config.json' },
      ]),
    );
    expect(files.texts.has('library.json')).toBe(false);
  });

  it('shows real errors for shared-hash merge', async () => {
    const book = makeBook('shared-hash', 'Shared');
    const localConfigJson = makeConfigJson(
      {
        progress: [10, 100],
        booknotes: [{ id: 'n1', text: 'local' }],
        viewSettings: { fontSize: 16 },
      },
      { progress: 'T100', booknotes: 'T100', viewSettings: 'T100' },
    );
    const remoteConfigJson = makeConfigJson(
      {
        progress: [50, 100],
        booknotes: [{ id: 'n2', text: 'remote' }],
        viewSettings: { fontSize: 20 },
      },
      { progress: 'T200', booknotes: 'T200', viewSettings: 'T200' },
    );
    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'shared-hash',
          book,
          assets: [
            { name: 'book', required: true },
            { name: 'config.json', required: false },
          ],
        },
      ],
    };
    const transport = {
      ...makeTransport(manifest),
      pullBookConfig: vi.fn().mockResolvedValue(remoteConfigJson),
      pushBookConfig: vi.fn().mockResolvedValue(undefined),
    };
    const files = makeFileService([book]);
    files.texts.set('shared-hash/config.json', localConfigJson);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');
    const result = await syncUsbBooks(transport, files);
    expect(result.failedHashes).toEqual([]);
  });

  it('merges scoped config fields for an existing shared book when transport supports config methods', async () => {
    const book = makeBook('shared-hash', 'Shared');
    const localConfigJson = makeConfigJson(
      {
        progress: [10, 100],
        booknotes: [{ id: 'n1', text: 'local' }],
        viewSettings: { fontSize: 16 },
      },
      { progress: 'T100', booknotes: 'T100', viewSettings: 'T100' },
    );
    const remoteConfigJson = makeConfigJson(
      {
        progress: [50, 100],
        booknotes: [{ id: 'n2', text: 'remote' }],
        viewSettings: { fontSize: 20 },
      },
      { progress: 'T200', booknotes: 'T200', viewSettings: 'T200' },
    );

    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'shared-hash',
          book,
          assets: [
            { name: 'book', required: true },
            { name: 'config.json', required: false },
          ],
        },
      ],
    };
    const transport = {
      ...makeTransport(manifest),
      pullBookConfig: vi.fn().mockResolvedValue(remoteConfigJson),
      pushBookConfig: vi.fn().mockResolvedValue(undefined),
    };
    const files = makeFileService([book]);
    files.texts.set('shared-hash/config.json', localConfigJson);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.failedHashes, `errors: ${JSON.stringify(result.errors)}`).toEqual([]);
    const saved = JSON.parse(files.texts.get('shared-hash/config.json')!) as Record<
      string,
      unknown
    >;
    expect(saved['progress']).toEqual([50, 100]);
    expect(saved['booknotes']).toEqual([{ id: 'n2', text: 'remote' }]);
    expect(saved['viewSettings']).toEqual({ fontSize: 20 });
    expect(transport.pushBookConfig).toHaveBeenCalledWith('shared-hash', expect.any(String));
  });

  it('preserves local scoped field when local timestamp is newer than remote', async () => {
    const book = makeBook('ts-hash', 'TS Test');
    const localConfigJson = makeConfigJson(
      { progress: [90, 100], viewSettings: { fontSize: 16 } },
      { progress: 'T300', viewSettings: 'T200' },
    );
    const remoteConfigJson = makeConfigJson(
      { progress: [10, 100], viewSettings: { fontSize: 20 } },
      { progress: 'T100', viewSettings: 'T250' },
    );

    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'ts-hash',
          book,
          assets: [
            { name: 'book', required: true },
            { name: 'config.json', required: false },
          ],
        },
      ],
    };
    const transport = {
      ...makeTransport(manifest),
      pullBookConfig: vi.fn().mockResolvedValue(remoteConfigJson),
      pushBookConfig: vi.fn().mockResolvedValue(undefined),
    };
    const files = makeFileService([book]);
    files.texts.set('ts-hash/config.json', localConfigJson);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.failedHashes).toEqual([]);
    const saved = JSON.parse(files.texts.get('ts-hash/config.json')!) as Record<string, unknown>;
    // Local T300 > remote T100 → keep local
    expect(saved['progress']).toEqual([90, 100]);
    // Remote T250 > local T200 → take remote
    expect(saved['viewSettings']).toEqual({ fontSize: 20 });
  });

  it('preserves unscoped fields from local config when remote does not have them', async () => {
    const book = makeBook('unscoped-hash', 'Unscoped');
    const localConfigJson = makeConfigJson(
      {
        location: 'keep-this',
        searchConfig: { scope: 'book' as const },
        rsvpPosition: { cfi: '/2', wordText: 'hello' },
      },
      { progress: 'T100' },
    );
    const remoteConfigJson = makeConfigJson({ progress: [50, 100] }, { progress: 'T200' });

    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'unscoped-hash',
          book,
          assets: [
            { name: 'book', required: true },
            { name: 'config.json', required: false },
          ],
        },
      ],
    };
    const transport = {
      ...makeTransport(manifest),
      pullBookConfig: vi.fn().mockResolvedValue(remoteConfigJson),
      pushBookConfig: vi.fn().mockResolvedValue(undefined),
    };
    const files = makeFileService([book]);
    files.texts.set('unscoped-hash/config.json', localConfigJson);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.failedHashes).toEqual([]);
    const saved = JSON.parse(files.texts.get('unscoped-hash/config.json')!) as Record<
      string,
      unknown
    >;
    expect(saved['progress']).toEqual([50, 100]);
    expect(saved['location']).toBe('keep-this');
    expect(saved['searchConfig']).toEqual({ scope: 'book' });
    expect(saved['rsvpPosition']).toEqual({ cfi: '/2', wordText: 'hello' });
  });

  it('skips config merge when transport does not expose config methods', async () => {
    const book = makeBook('no-config-transport', 'No Config');
    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'no-config-transport',
          book,
          assets: [{ name: 'book', required: true }],
        },
      ],
    };
    const transport = makeTransport(manifest);
    const files = makeFileService([book]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);
    // Should not error — just skip the config merge
    expect(result.failedHashes).toEqual([]);
  });

  it('pushes library index BEFORE book assets so server can resolve filenames', async () => {
    const localBook = makeBook('order-test', 'OrderTest');
    const transport = makeTransport({ books: [] });
    const files = makeFileService([localBook]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    await syncUsbBooks(transport, files);

    // Verify pushBookLibrary was called
    expect(transport.pushBookLibrary).toHaveBeenCalled();

    // Verify pushBookAsset was called
    expect(transport.pushBookAsset).toHaveBeenCalled();

    // CRITICAL ORDER CHECK: pushBookLibrary must be called BEFORE pushBookAsset.
    // The server needs library.json to resolve book filenames during asset write.
    const libraryCallOrder = vi.mocked(transport.pushBookLibrary!).mock.invocationCallOrder[0]!;
    const assetCallOrder = vi.mocked(transport.pushBookAsset!).mock.invocationCallOrder[0]!;

    expect(
      libraryCallOrder,
      'pushBookLibrary must be invoked BEFORE pushBookAsset so the server can resolve filenames',
    ).toBeLessThan(assetCallOrder);
  });

  it('reports required asset transfer failure without committing the received book', async () => {
    const remoteBook = makeBook('broken', 'Broken');
    const transport = makeTransport({
      books: [
        {
          hash: 'broken',
          book: remoteBook,
          assets: [{ name: 'book', required: true }],
        },
      ],
    });
    vi.mocked(transport.pullBookAsset!).mockRejectedValueOnce(new Error('missing binary'));
    const files = makeFileService([]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');

    const result = await syncUsbBooks(transport, files);

    expect(result.received).toBe(0);
    expect(result.failedHashes).toEqual(['broken']);
    expect(transport.pushBookLibrary).not.toHaveBeenCalledWith([
      expect.objectContaining({ hash: 'broken' }),
    ]);
  });
});
