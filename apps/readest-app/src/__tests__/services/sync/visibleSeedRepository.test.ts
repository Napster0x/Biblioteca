import { describe, expect, it, vi } from 'vitest';
import type { Annotacion } from '@/types/annotaciones';
import type { Cite } from '@/types/citas';
import type { DictionaryEntry, DictionaryOccurrence } from '@/types/dictionary';
import type { Hlc } from '@/types/replica';
import { createVisibleSeedRepository } from '@/services/sync/visibleSeedRepository';

const DEVICE_ID = 'visible-dev';

describe('visibleSeedRepository', () => {
  it('converts visible annotations and quotes from services into seed ReplicaRows', async () => {
    const annotation: Annotacion = {
      id: 'ann-visible-1',
      bookHash: 'book-a',
      bookTitle: 'Libro A',
      bookAuthor: 'Autora A',
      cfi: '/6/2',
      sectionHref: 'chapter.xhtml',
      page: 12,
      text: 'texto anotado',
      note: 'nota visible',
      style: 'highlight',
      color: 'yellow',
      createdAt: 100,
      updatedAt: null,
    };
    const quote: Cite = {
      id: 'quote-visible-1',
      bookHash: 'book-q',
      bookTitle: 'Libro Q',
      bookAuthor: 'Autor Q',
      cfi: '/6/8',
      sectionHref: 'quote.xhtml',
      page: 44,
      text: 'cita visible',
      contextBefore: 'antes',
      contextAfter: 'después',
      contentHash: 'hash-q',
      createdAt: 200,
      updatedAt: null,
    };
    const repository = createVisibleSeedRepository({
      annotationsService: { listAllAnnotations: vi.fn().mockResolvedValue([annotation]) },
      citasService: { listAllQuotes: vi.fn().mockResolvedValue([quote]) },
      dictionaryService: {
        listAllEntries: vi.fn().mockResolvedValue([]),
        listAllOccurrences: vi.fn().mockResolvedValue([]),
      },
    });

    const annotationRows = await repository.getSeedRows('annotation', DEVICE_ID);
    const quoteRows = await repository.getSeedRows('quote', DEVICE_ID);

    expect(annotationRows).toHaveLength(1);
    expect(annotationRows[0]!.kind).toBe('annotation');
    expect(annotationRows[0]!.replica_id).toBe('annotation:ann-visible-1');
    expect(annotationRows[0]!.fields_jsonb['note']!.v).toBe('nota visible');
    expect(annotationRows[0]!.fields_jsonb['note']!.s).toBe(DEVICE_ID);

    expect(quoteRows).toHaveLength(1);
    expect(quoteRows[0]!.kind).toBe('quote');
    expect(quoteRows[0]!.replica_id).toBe('quote:quote-visible-1');
    expect(quoteRows[0]!.fields_jsonb['contextBefore']!.v).toBe('antes');
    expect(quoteRows[0]!.fields_jsonb['contentHash']!.v).toBe('hash-q');
  });

  it('converts dictionary entries and occurrences from visible DB services into seed rows', async () => {
    const entry: DictionaryEntry = {
      id: 'entry-visible-1',
      term: 'serendipia',
      displayTerm: 'Serendipia',
      language: 'es',
      definition: 'hallazgo valioso accidental',
      imagePath: 'serendipia.png',
      curiosity: 'curiosidad',
      enrichmentStatus: 'ready',
      createdAt: 300,
      updatedAt: 310,
    };
    const occurrence: DictionaryOccurrence = {
      id: 'occ-visible-1',
      entryId: entry.id,
      bookHash: 'book-d',
      bookTitle: 'Libro D',
      bookAuthor: 'Autora D',
      cfi: '/6/10',
      sectionHref: 'dict.xhtml',
      page: 7,
      selectedText: 'serendipia',
      contextBefore: 'una',
      contextAfter: 'extraña',
      highlightNoteId: 'ann-linked',
      createdAt: 320,
    };
    const repository = createVisibleSeedRepository({
      annotationsService: { listAllAnnotations: vi.fn().mockResolvedValue([]) },
      citasService: { listAllQuotes: vi.fn().mockResolvedValue([]) },
      dictionaryService: {
        listAllEntries: vi.fn().mockResolvedValue([entry]),
        listAllOccurrences: vi.fn().mockResolvedValue([occurrence]),
      },
    });

    const rows = await repository.getSeedRows('dictionary-entry', DEVICE_ID);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.replica_id)).toEqual([
      'dictionary-entry:entry-visible-1',
      'dictionary-entry:occ-visible-1',
    ]);
    expect(rows[0]!.fields_jsonb['definition']!.v).toBe('hallazgo valioso accidental');
    expect(rows[1]!.fields_jsonb['entryId']!.v).toBe(entry.id);
    expect(rows[1]!.fields_jsonb['selectedText']!.v).toBe('serendipia');
    expect(rows[1]!.updated_at_ts > rows[0]!.updated_at_ts).toBe(true);
  });

  it('preserves visible tombstones as deleted ReplicaRows', async () => {
    const deletedAt = 12345;
    const repository = createVisibleSeedRepository({
      annotationsService: {
        listAllAnnotations: vi.fn().mockResolvedValue([
          {
            id: 'ann-deleted',
            bookHash: 'book-a',
            bookTitle: null,
            bookAuthor: null,
            cfi: null,
            sectionHref: null,
            page: null,
            text: 'deleted text',
            note: '',
            style: 'highlight',
            color: 'yellow',
            createdAt: 100,
            updatedAt: null,
            deletedAt,
          } satisfies Annotacion,
        ]),
      },
      citasService: { listAllQuotes: vi.fn().mockResolvedValue([]) },
      dictionaryService: {
        listAllEntries: vi.fn().mockResolvedValue([]),
        listAllOccurrences: vi.fn().mockResolvedValue([]),
      },
    });

    const [row] = await repository.getSeedRows('annotation', DEVICE_ID);

    expect(row!.deleted_at_ts).toBe(row!.updated_at_ts as Hlc);
    expect(row!.replica_id).toBe('annotation:ann-deleted');
  });
});
