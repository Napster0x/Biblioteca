import type { Book } from './book';

/**
 * Domain types for the Citas (Quotes) module.
 *
 * Mirrors `types/dictionary.ts` but in a separate file: Citas is a peer
 * domain, not a child of Diccionario, so it does not belong in
 * `types/dictionary.ts`. See proposal §4 / design §6.1.
 *
 * Phase 1 scope: shell + data model. The capture-from-reader wiring and
 * the per-quote detail view (`/citas/[id]`) are deferred to Fase 2/3.
 */

export interface Cite {
  id: string;
  bookHash: string;
  bookTitle: string | null;
  bookAuthor: string | null;
  /** CFI inside the source book. Not part of the UNIQUE constraint (decision #313). */
  cfi: string | null;
  sectionHref: string | null;
  page: number | null;
  /** The captured fragment. Required, not nullable. */
  text: string;
  contextBefore: string | null;
  contextAfter: string | null;
  /** SHA-256 of `text || \0 || contextBefore || \0 || contextAfter` (64 hex chars). */
  contentHash: string;
  createdAt: number;
  updatedAt: number | null;
}

export type CiteInput = Omit<Cite, 'id' | 'contentHash' | 'createdAt' | 'updatedAt'>;

export type CiteUpdate = Pick<Cite, 'id'> & Partial<Omit<CiteInput, 'bookHash'>>;

export interface CitasShelfItem extends Book {
  type: 'citas-shelf-item';
  id: 'citas';
  title: string;
  hash: 'citas';
}

export const CITAS_SHELF_ITEM: CitasShelfItem = {
  type: 'citas-shelf-item',
  id: 'citas',
  hash: 'citas',
  format: 'EPUB',
  // Re-bound at render time via useTranslation. Keeping a stable string here
  // mirrors DICTIONARY_SHELF_ITEM (DictionaryShelfCard re-reads item.title
  // before rendering, so the literal value matters only for static analyses
  // and tests that import the constant directly).
  title: 'Citas',
  author: 'Mateo Galiano',
  coverImageUrl: '/images/citas-cover.png',
  createdAt: 0,
  updatedAt: 0,
};

export function isCitasShelfItem(value: unknown): value is CitasShelfItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['type'] === 'citas-shelf-item' && candidate['id'] === 'citas';
}

/**
 * Generates a stable, namespaced id for a new quote. Mirrors
 * `createDictionaryId` so the same fallback strategy applies when
 * `crypto.randomUUID` is unavailable (older runtimes, some tests).
 */
export function createCitasId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cite-${crypto.randomUUID()}`;
  }
  return `cite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
