import type { BookConfig, BookNote, HighlightColor } from '@/types/book';
import type { Cite, CiteInput } from '@/types/citas';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';

export const CITAS_HIGHLIGHT_FALLBACK = '#fecaca';

interface CaptureQuoteBook {
  hash: string;
  title?: string | null;
  author?: string | null;
}

export interface CitasCaptureService {
  createQuote(input: CiteInput): Promise<Cite>;
}

export interface CaptureQuoteFromSelectionInput {
  selectedText: string;
  cfi: string;
  page?: number | null;
  sectionHref?: string | null;
  book: CaptureQuoteBook;
  contextBefore?: string | null;
  contextAfter?: string | null;
  service: CitasCaptureService;
  noteId: string;
  timestamp: number;
  color?: HighlightColor;
}

export type CaptureQuoteFromSelectionResult =
  | { ok: true; quote: Cite; highlight: BookNote }
  | {
      ok: false;
      reason: 'empty' | 'missing-cfi' | 'duplicate' | 'service-error';
      message?: string;
    };

export function resolveCitasHighlightColor(): HighlightColor {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return CITAS_HIGHLIGHT_FALLBACK;
  }

  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--citas-highlight')
    .trim();

  return token || CITAS_HIGHLIGHT_FALLBACK;
}

export async function softDeleteCitasHighlights(
  quotes: readonly Cite[],
  citeIds: readonly string[],
  appService: AppService | null | undefined,
  envConfig: EnvConfigType,
  settings: SystemSettings,
): Promise<void> {
  if (citeIds.length === 0) return;

  const selectedIds = new Set(citeIds);
  const citeIdsByBook = new Map<string, Set<string>>();
  for (const quote of quotes) {
    if (!selectedIds.has(quote.id) || !quote.bookHash) continue;
    const bookCiteIds = citeIdsByBook.get(quote.bookHash) ?? new Set<string>();
    bookCiteIds.add(quote.id);
    citeIdsByBook.set(quote.bookHash, bookCiteIds);
  }

  if (citeIdsByBook.size === 0) return;

  const bookDataStore = useBookDataStore.getState();
  const libraryStore = useLibraryStore.getState();
  const now = Date.now();

  for (const [bookHash, bookCiteIds] of citeIdsByBook) {
    const loadedBookData = bookDataStore.getBookData(bookHash);
    const book = loadedBookData?.book ?? libraryStore.getBookByHash(bookHash);
    const config =
      loadedBookData?.config ??
      (book && appService ? await appService.loadBookConfig(book, settings) : null);
    if (!book || !config?.booknotes) continue;

    const { booknotes, changed } = markCitasHighlightsDeleted(config.booknotes, bookCiteIds, now);
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

export function markCitasHighlightsDeleted(
  booknotes: BookNote[],
  citeIds: ReadonlySet<string>,
  deletedAt: number,
): { booknotes: BookNote[]; changed: boolean } {
  let changed = false;
  const nextBooknotes = booknotes.map((note) => {
    if (note.deletedAt || !note.citeId || !citeIds.has(note.citeId)) return note;
    changed = true;
    return { ...note, deletedAt };
  });

  return { booknotes: nextBooknotes, changed };
}

export async function captureQuoteFromSelection(
  input: CaptureQuoteFromSelectionInput,
): Promise<CaptureQuoteFromSelectionResult> {
  const text = input.selectedText.trim();
  if (!text) {
    return { ok: false, reason: 'empty', message: 'Quote capture requires selected text.' };
  }

  const cfi = input.cfi.trim();
  if (!cfi) {
    return {
      ok: false,
      reason: 'missing-cfi',
      message: 'Quote capture requires a valid CFI.',
    };
  }

  try {
    const quote = await input.service.createQuote({
      bookHash: input.book.hash,
      bookTitle: input.book.title ?? null,
      bookAuthor: input.book.author ?? null,
      cfi,
      sectionHref: input.sectionHref ?? null,
      page: input.page ?? null,
      text: input.selectedText,
      contextBefore: input.contextBefore ?? null,
      contextAfter: input.contextAfter ?? null,
    });

    return {
      ok: true,
      quote,
      highlight: createQuoteHighlight({
        quote,
        noteId: input.noteId,
        timestamp: input.timestamp,
        color: input.color ?? resolveCitasHighlightColor(),
      }),
    };
  } catch (error) {
    if (isDuplicateQuoteError(error)) {
      return {
        ok: false,
        reason: 'duplicate',
        message: 'Quote already exists for this book and content.',
      };
    }

    return { ok: false, reason: 'service-error', message: getErrorMessage(error) };
  }
}

function createQuoteHighlight(input: {
  quote: Cite;
  noteId: string;
  timestamp: number;
  color: HighlightColor;
}): BookNote {
  return {
    id: input.noteId,
    type: 'annotation',
    cfi: input.quote.cfi ?? '',
    style: 'highlight',
    color: input.color,
    citeId: input.quote.id,
    text: input.quote.text,
    note: '',
    page: input.quote.page ?? undefined,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function isDuplicateQuoteError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('unique') || message.includes('duplicate');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
