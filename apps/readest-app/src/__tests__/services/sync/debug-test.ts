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

describe('debug', () => {
  it('tries sync', async () => {
    const book = makeBook('debug-hash');
    const manifest: UsbBookManifest = {
      books: [{ hash: 'debug-hash', book, assets: [{ name: 'book', required: true }] }],
    };
    const transport = makeTransport(manifest);
    const files = makeFileService([book]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');
    try {
      const result = await syncUsbBooks(transport, files);
      console.log('RESULT:', JSON.stringify(result, null, 2));
    } catch (e) {
      console.log('UNCAUGHT ERROR:', e);
    }
  });
});
