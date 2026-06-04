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
}

export type AnnotacionInput = Omit<Annotacion, 'id' | 'createdAt' | 'updatedAt'>;

export interface AnotacionesShelfItem {
  type: 'anotaciones-shelf-item';
  id: 'anotaciones';
  title: string;
}

export const ANOTACIONES_SHELF_ITEM: AnotacionesShelfItem = {
  type: 'anotaciones-shelf-item',
  id: 'anotaciones',
  title: 'Anotaciones',
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
