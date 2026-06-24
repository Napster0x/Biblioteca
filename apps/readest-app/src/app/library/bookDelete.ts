import type { EnvConfigType } from '@/services/environment';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

interface ToastPayload {
  type: 'info' | 'error';
  message: string;
  timeout?: number;
}

interface LibraryBookDeleteDependencies {
  appService: Pick<AppService, 'deleteBook'> | null | undefined;
  envConfig: EnvConfigType;
  updateBook: (envConfig: EnvConfigType, book: Book) => Promise<void>;
  clearBookData: (bookHash: string) => void;
  dispatchToast: (payload: ToastPayload) => void;
  translate: (key: string, values?: Record<string, string>) => string;
  now: () => number;
}

export function createLibraryBookDeleteHandler({
  appService,
  envConfig,
  updateBook,
  clearBookData,
  dispatchToast,
  translate,
  now,
}: LibraryBookDeleteDependencies) {
  return async (book: Book): Promise<boolean> => {
    try {
      await appService?.deleteBook(book);
      const deletedBook: Book = {
        ...book,
        deletedAt: now(),
        downloadedAt: null,
        coverDownloadedAt: null,
      };
      Object.assign(book, deletedBook);
      await updateBook(envConfig, deletedBook);
      clearBookData(book.hash);
      dispatchToast({
        type: 'info',
        timeout: 1000,
        message: translate('Book deleted: {{title}}', { title: book.title }),
      });
      return true;
    } catch {
      dispatchToast({
        message: translate('Failed to delete book: {{title}}', { title: book.title }),
        type: 'error',
      });
      return false;
    }
  };
}
