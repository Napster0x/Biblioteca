import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { SyncTransport, UsbBookManifest } from '@/services/sync/SyncTransport';
import type { UsbBookFileService } from '@/services/sync/usbBookSync';

function makeBook(h: string): Book {
  return {
    hash: h,
    format: 'EPUB',
    title: `Book ${h}`,
    author: 'A',
    filePath: `/${h}.epub`,
    createdAt: 1,
    updatedAt: 2,
  };
}
function makeTransport(m: UsbBookManifest): SyncTransport {
  return {
    kind: 'usb',
    pull: vi.fn().mockResolvedValue([]),
    push: vi.fn().mockResolvedValue(undefined),
    pullBookManifest: vi.fn().mockResolvedValue(m),
    pullBookAsset: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    pushBookAsset: vi.fn().mockResolvedValue(undefined),
    pushBookLibrary: vi.fn().mockResolvedValue(undefined),
  };
}
function makeFileService(l: Book[] = []) {
  const texts = new Map<string, string>();
  return {
    texts,
    reads: [] as string[],
    readText: vi.fn().mockImplementation(async (p: string) => {
      (globalThis as any).__reads ??= [];
      (globalThis as any).__reads.push(p);
      throw new Error(`missing ${p}`);
    }),
    writeText: vi.fn(),
    readBinary: vi.fn(),
    writeBinary: vi.fn(),
    fileExists: vi.fn().mockResolvedValue(true),
  };
}

describe('dbg', () => {
  it('shows errors', async () => {
    const book = makeBook('h1');
    const m: UsbBookManifest = {
      books: [{ hash: 'h1', book, assets: [{ name: 'book', required: true }] }],
    };
    const t = makeTransport(m);
    const f = makeFileService([book]);
    const { syncUsbBooks } = await import('@/services/sync/usbBookSync');
    const r = await syncUsbBooks(t, f);
    console.log('RESULT:', JSON.stringify(r));
    expect(r.failedHashes).toEqual([]);
  });
});
