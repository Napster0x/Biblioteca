import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { UsbBookFileService } from '@/services/sync/usbBookSync';

describe('trace2', () => {
  it('shows readText behavior', async () => {
    const library: Book[] = [
      {
        hash: 'h1',
        format: 'EPUB',
        title: 'Test',
        author: 'A',
        filePath: '/h1.epub',
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const texts = new Map<string, string>();
    const readText = vi.fn().mockImplementation(async (path: string) => {
      if (texts.has(path)) return texts.get(path)!;
      if (path === 'library.json') return JSON.stringify(library);
      throw new Error(`missing ${path}`);
    });

    texts.set('h1/config.json', '{}');
    console.log('texts has library.json:', texts.has('library.json'));
    console.log('library.json value:', await readText('library.json'));
    console.log('h1/config.json value:', await readText('h1/config.json'));

    // Now try to read "library.json" when texts has "library.json" set
    texts.set('library.json', '["collision"]');
    console.log('AFTER set, library.json value:', await readText('library.json'));
  });
});
