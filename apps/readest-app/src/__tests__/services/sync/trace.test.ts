// Temp test to trace where error "filename.replace is not a function" comes from
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
    filePath: `/${hash}.epub`,
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
    pullBookAsset: vi.fn().mockImplementation(async (_h: string, a: string) => {
      if (a === 'nav.json') return null;
      return new TextEncoder().encode(a).buffer;
    }),
    pushBookAsset: vi.fn().mockResolvedValue(undefined),
    pushBookLibrary: vi.fn().mockResolvedValue(undefined),
  };
}
function makeFileService(library: Book[] = []): any {
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
    writeText: vi.fn().mockImplementation(async (p: string, t: string) => texts.set(p, t)),
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    writeBinary: vi.fn(),
    fileExists: vi.fn().mockResolvedValue(true),
  };
}

describe('trace', () => {
  it('shows where error is', async () => {
    const book = makeBook('h1');
    const manifest: UsbBookManifest = {
      books: [
        {
          hash: 'h1',
          book,
          assets: [
            { name: 'book', required: true },
            { name: 'config.json', required: false },
          ],
        },
      ],
    };
    const config = JSON.stringify({
      progress: [10, 100],
      _replica: { fieldTimestamps: { progress: 'T100' } },
    });
    const transport = {
      ...makeTransport(manifest),
      pullBookConfig: vi.fn().mockResolvedValue(config),
      pushBookConfig: vi.fn().mockResolvedValue(undefined),
    };
    const files = makeFileService([book]);
    files.texts.set('h1/config.json', config);
    const { syncUsbBooks, mergeBookConfig } = await import('@/services/sync/usbBookSync');

    // Test merge function directly
    try {
      const merged = mergeBookConfig(config, config);
      console.log('mergeBookConfig works:', merged);
    } catch (e) {
      console.log('merge FAILED:', e);
    }

    const result = await syncUsbBooks(transport, files);
    console.log('errors:', result.errors);
    expect(result.failedHashes, `errors: ${JSON.stringify(result.errors)}`).toEqual([]);
  });
});
