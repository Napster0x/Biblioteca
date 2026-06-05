import type { Book } from './book';

export type EnrichmentStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface DictionaryEntry {
  id: string;
  term: string;
  displayTerm: string;
  language?: string;
  definition?: string;
  imagePath?: string;
  curiosity?: string;
  enrichmentStatus: EnrichmentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface DictionaryOccurrence {
  id: string;
  entryId: string;
  bookHash: string;
  bookTitle?: string;
  bookAuthor?: string;
  cfi: string;
  sectionHref?: string;
  page?: number;
  selectedText: string;
  contextBefore?: string;
  contextAfter?: string;
  highlightNoteId?: string;
  createdAt: number;
}

export interface DictionaryShelfItem extends Book {
  type: 'dictionary-shelf-item';
  id: 'dictionary';
  title: string;
  hash: 'dictionary';
}

export const DICTIONARY_SHELF_ITEM: DictionaryShelfItem = {
  type: 'dictionary-shelf-item',
  id: 'dictionary',
  hash: 'dictionary',
  format: 'EPUB',
  title: 'Diccionario',
  author: 'Mateo Galiano',
  coverImageUrl: '/images/dictionary-cover.png',
  createdAt: 0,
  updatedAt: 0,
};

export function isDictionaryShelfItem(value: unknown): value is DictionaryShelfItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['type'] === 'dictionary-shelf-item' && candidate['id'] === 'dictionary';
}
