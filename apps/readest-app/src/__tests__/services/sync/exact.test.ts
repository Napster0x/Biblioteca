import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SyncTransport, UsbBookManifest } from '@/services/sync/SyncTransport';
import type { UsbBookFileService } from '@/services/sync/usbBookSync';

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
function makeFileService(library: Book[] = []) {
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

describe('exact', () => {
  it('matches original test', async () => {
    const book = makeBook('shared-hash', { title: 'Shared' });
    const remoteConfigJson = JSON.stringify({
      progress: [50, 100],
      _replica: { fieldTimestamps: { progress: 'T200' } },
    });
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
    files.texts.set(
      'shared-hash/config.json',
      JSON.stringify({ progress: [10, 100], _replica: { fieldTimestamps: { progress: 'T100' } } }),
    );
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');
    const result = await syncUsbBooks(transport, files);
    console.log('errors:', JSON.stringify(result.errors));
    expect(result.failedHashes).toEqual([]);
  });
});
