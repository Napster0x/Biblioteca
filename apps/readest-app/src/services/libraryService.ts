import { FileSystem } from '@/types/system';
import type { Book } from '@/types/book';
import { getLibraryFilename } from '@/utils/book';
import { safeLoadJSON, safeSaveJSON } from './persistence';

const COVER_CONCURRENCY = 20;

function sanitizeImportedBook(book: Book): Book {
  const { coverImageUrl: _coverImageUrl, filePath: _filePath, ...rest } = book;
  return {
    ...rest,
    coverImageUrl: undefined,
    filePath: undefined,
    downloadedAt: book.downloadedAt ?? Date.now(),
    uploadedAt: null,
    deletedAt: null,
  };
}

export function mergeImportedLibraryBooks(currentBooks: Book[], incomingBooks: Book[]): Book[] {
  const merged = [...currentBooks];

  for (const incomingBook of incomingBooks) {
    const incoming = sanitizeImportedBook(incomingBook);
    const existingIndex = merged.findIndex((book) => book.hash === incoming.hash);
    if (existingIndex === -1) {
      merged.push(incoming);
      continue;
    }

    const existing = merged[existingIndex]!;
    if ((existing.updatedAt ?? 0) > (incoming.updatedAt ?? 0)) continue;

    merged[existingIndex] = {
      ...incoming,
      filePath: existing.filePath,
    };
  }

  return merged;
}

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

export async function loadLibraryBooks(
  fs: FileSystem,
  generateCoverImageUrl: (book: Book) => Promise<string>,
): Promise<Book[]> {
  const libraryFilename = getLibraryFilename();

  if (!(await fs.exists('', 'Books'))) {
    await fs.createDir('', 'Books', true);
  }

  const books = await safeLoadJSON<Book[]>(fs, libraryFilename, 'Books', []);

  await processInBatches(books, COVER_CONCURRENCY, async (book) => {
    book.coverImageUrl = await generateCoverImageUrl(book);
    book.updatedAt ??= book.lastUpdated || Date.now();
  });

  return books;
}

export async function saveLibraryBooks(fs: FileSystem, books: Book[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const libraryBooks = books.map(({ coverImageUrl, ...rest }) => rest);
  await safeSaveJSON(fs, getLibraryFilename(), 'Books', libraryBooks);
}
