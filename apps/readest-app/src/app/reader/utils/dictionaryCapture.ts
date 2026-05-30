import type { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import { normalizeDictionarySelection } from '@/utils/dictionaryText';

interface DictionaryCaptureBook {
  hash: string;
  title?: string;
  language?: string;
}

interface DictionaryCaptureService {
  upsertEntry(input: {
    term: string;
    displayTerm?: string;
    language?: string;
    enrichmentStatus?: 'pending';
  }): Promise<Pick<DictionaryEntry, 'id'>>;
  createOccurrence(input: {
    entryId: string;
    bookHash: string;
    bookTitle?: string;
    cfi: string;
    sectionHref?: string;
    page?: number;
    selectedText: string;
    highlightNoteId?: string;
  }): Promise<Pick<DictionaryOccurrence, 'id'>>;
}

export interface CreateDictionaryCaptureHighlightInput {
  selectedText: string;
  cfi: string;
  page?: number;
  style: HighlightStyle;
  color: HighlightColor;
  id: string;
  timestamp: number;
}

export interface CaptureDictionaryOccurrenceInput {
  selectedText: string;
  cfi: string;
  page?: number;
  book: DictionaryCaptureBook;
  highlightNoteId: string;
  service: DictionaryCaptureService;
  sectionHref?: string;
}

export type CaptureDictionaryOccurrenceResult =
  | { ok: true; entryId: string; occurrenceId: string }
  | { ok: false; reason: 'empty' | 'multi-word' | 'invalid-word'; selectedText: string };

export function createDictionaryCaptureHighlight(
  input: CreateDictionaryCaptureHighlightInput,
): BookNote {
  return {
    id: input.id,
    type: 'annotation',
    cfi: input.cfi,
    style: input.style,
    color: input.color,
    text: input.selectedText,
    note: '',
    page: input.page,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export async function captureDictionaryOccurrence(
  input: CaptureDictionaryOccurrenceInput,
): Promise<CaptureDictionaryOccurrenceResult> {
  const normalized = normalizeDictionarySelection(input.selectedText);
  if (!normalized.ok) return normalized;

  const entry = await input.service.upsertEntry({
    term: normalized.term,
    displayTerm: normalized.displayTerm,
    language: input.book.language,
    enrichmentStatus: 'pending',
  });
  const occurrence = await input.service.createOccurrence({
    entryId: entry.id,
    bookHash: input.book.hash,
    bookTitle: input.book.title,
    cfi: input.cfi,
    sectionHref: input.sectionHref,
    page: input.page,
    selectedText: normalized.selectedText,
    highlightNoteId: input.highlightNoteId,
  });

  return { ok: true, entryId: entry.id, occurrenceId: occurrence.id };
}
