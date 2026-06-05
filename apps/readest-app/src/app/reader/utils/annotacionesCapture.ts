import type { BookConfig, BookNote } from '@/types/book';
import type { Annotacion } from '@/types/annotaciones';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';

export type AnnotationFlowStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'cancelled' | 'error';

export interface PendingAnnotation {
  key: string;
  cfi: string;
  href: string | null;
  text: string;
  page: number;
  range: Range;
  index: number;
  temporaryBookNoteId?: string;
  createdTemporaryOverlay: boolean;
}

export function createTemporaryAnnotationBookNote(
  pending: PendingAnnotation,
  timestamp: number,
): BookNote {
  return {
    id: pending.temporaryBookNoteId ?? pending.cfi,
    type: 'annotation',
    cfi: pending.cfi,
    style: 'highlight',
    color: 'yellow',
    text: pending.text,
    note: '',
    page: pending.page,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createFinalAnnotationBookNote(
  pending: PendingAnnotation,
  annotationId: string,
  id: string,
  timestamp: number,
): BookNote {
  return {
    id,
    type: 'annotation',
    annotationId,
    cfi: pending.cfi,
    style: 'highlight',
    color: 'yellow',
    text: pending.text,
    note: '',
    page: pending.page,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function softDeleteAnotacionesHighlights(
  annotations: readonly Annotacion[],
  ids: readonly string[],
  appService: AppService | null | undefined,
  envConfig: EnvConfigType,
  settings: SystemSettings,
): Promise<void> {
  if (ids.length === 0) return;

  const selectedIds = new Set(ids);
  const annotIdsByBook = new Map<string, Set<string>>();
  for (const annotation of annotations) {
    if (!selectedIds.has(annotation.id) || !annotation.bookHash) continue;
    const bookAnnotIds = annotIdsByBook.get(annotation.bookHash) ?? new Set<string>();
    bookAnnotIds.add(annotation.id);
    annotIdsByBook.set(annotation.bookHash, bookAnnotIds);
  }

  if (annotIdsByBook.size === 0) return;

  const bookDataStore = useBookDataStore.getState();
  const libraryStore = useLibraryStore.getState();
  const now = Date.now();

  for (const [bookHash, bookAnnotIds] of annotIdsByBook) {
    const loadedBookData = bookDataStore.getBookData(bookHash);
    const book = loadedBookData?.book ?? libraryStore.getBookByHash(bookHash);
    const config =
      loadedBookData?.config ??
      (book && appService ? await appService.loadBookConfig(book, settings) : null);
    if (!book || !config?.booknotes) continue;

    const { booknotes, changed } = markAnotacionesHighlightsDeleted(
      config.booknotes,
      [...bookAnnotIds],
      now,
    );
    if (!changed) continue;

    if (loadedBookData) {
      const updatedConfig = bookDataStore.updateBooknotes(bookHash, booknotes);
      if (updatedConfig)
        await bookDataStore.saveConfig(envConfig, bookHash, updatedConfig, settings);
    } else if (appService) {
      const updatedConfig: BookConfig = { ...config, booknotes, updatedAt: now };
      await appService.saveBookConfig(book, updatedConfig, settings);
    }
  }
}

export function markAnotacionesHighlightsDeleted(
  booknotes: BookNote[],
  annotationIds: readonly string[],
  deletedAt: number,
): { booknotes: BookNote[]; changed: boolean } {
  const idSet = new Set(annotationIds);
  let changed = false;
  const nextBooknotes = booknotes.map((note) => {
    if (note.deletedAt || !note.annotationId || !idSet.has(note.annotationId)) return note;
    changed = true;
    return { ...note, deletedAt };
  });

  return { booknotes: nextBooknotes, changed };
}
