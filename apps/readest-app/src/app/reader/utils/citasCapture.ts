import type { BookNote, HighlightColor } from '@/types/book';
import type { Cite, CiteInput } from '@/types/citas';

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
