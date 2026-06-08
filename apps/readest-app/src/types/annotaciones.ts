import type { Book } from './book';

/**
 * Domain types for the Anotaciones (Annotations) module.
 *
 * Phase 1 scope: shell + data model. Capture-from-reader wiring and
 * the per-annotation detail view are deferred to later phases.
 */

export interface Annotacion {
  id: string;
  bookHash: string;
  bookTitle: string | null;
  bookAuthor: string | null;
  /** CFI inside the source book. */
  cfi: string | null;
  sectionHref: string | null;
  page: number | null;
  /** The annotated text fragment. Required, not nullable. */
  text: string;
  /** User note attached to the annotation. */
  note: string;
  /** Visual style: 'highlight' | 'underline' | 'squiggly'. */
  style: string;
  /** Color token for the highlight. */
  color: string;
  createdAt: number;
  updatedAt: number | null;
  /** Soft-delete tombstone: set when the annotation is deleted. Sync uses this to propagate deletions across devices. */
  deletedAt?: number;
  /**
   * Internal: per-field HLC strings that track the last-observed remote
   * timestamp for each key. Added via ReplicaRow merge; never persisted.
   */
  _replicaTimestamps?: Record<string, string>;
}

export type AnnotacionInput = Omit<Annotacion, 'id' | 'createdAt' | 'updatedAt'>;

export interface AnotacionesShelfItem extends Book {
  type: 'anotaciones-shelf-item';
  id: 'anotaciones';
  title: string;
  hash: 'anotaciones';
}

export const ANOTACIONES_SHELF_ITEM: AnotacionesShelfItem = {
  type: 'anotaciones-shelf-item',
  id: 'anotaciones',
  hash: 'anotaciones',
  format: 'EPUB',
  title: 'Anotaciones',
  author: 'Mateo Galiano',
  coverImageUrl: '/images/annotaciones-cover.png',
  createdAt: 0,
  updatedAt: 0,
};

export function isAnotacionesShelfItem(value: unknown): value is AnotacionesShelfItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['type'] === 'anotaciones-shelf-item' && candidate['id'] === 'anotaciones';
}

/**
 * Generates a stable, namespaced id for a new annotation.
 */
export function createAnnotacionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `annot-${crypto.randomUUID()}`;
  }
  return `annot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
