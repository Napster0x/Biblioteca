import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { mergeImportedLibraryBooks } from '@/services/libraryService';

function makeBook(hash: string, overrides: Partial<Book> = {}): Book {
  return {
    hash,
    format: 'EPUB',
    title: `Book ${hash}`,
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('mergeImportedLibraryBooks', () => {
  it('appends incoming books by hash and strips sender-only filePath', () => {
    const merged = mergeImportedLibraryBooks(
      [],
      [
        makeBook('incoming', {
          filePath: '/sender/device/book.epub',
          coverImageUrl: 'blob:sender',
        }),
      ],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        hash: 'incoming',
        filePath: undefined,
        coverImageUrl: undefined,
        uploadedAt: null,
        deletedAt: null,
      }),
    ]);
  });

  it('keeps the receiver managed path when an existing local book is newer', () => {
    const local = makeBook('same', {
      title: 'Local title',
      filePath: 'same/Local.epub',
      updatedAt: 20,
      uploadedAt: 5,
    });
    const incoming = makeBook('same', {
      title: 'Remote title',
      filePath: '/sender/same.epub',
      updatedAt: 10,
    });

    const merged = mergeImportedLibraryBooks([local], [incoming]);

    expect(merged).toEqual([local]);
  });

  it('updates stale receiver metadata without preserving sender filePath', () => {
    const local = makeBook('same', {
      title: 'Old title',
      filePath: 'same/Local.epub',
      updatedAt: 10,
    });
    const incoming = makeBook('same', {
      title: 'New title',
      filePath: '/sender/same.epub',
      updatedAt: 30,
    });

    const merged = mergeImportedLibraryBooks([local], [incoming]);

    expect(merged).toEqual([
      expect.objectContaining({
        hash: 'same',
        title: 'New title',
        filePath: 'same/Local.epub',
      }),
    ]);
  });
});
