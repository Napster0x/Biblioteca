import { describe, expect, it, vi } from 'vitest';

import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  captureDictionaryOccurrence,
  createDictionaryCaptureHighlight,
} from '@/app/reader/utils/dictionaryCapture';

describe('reader dictionary selection actions', () => {
  it('keeps provider lookup available under a renamed action', () => {
    const capture = annotationToolButtons.find((button) => button.type === 'dictionary');

    expect(capture?.label).toBe('Diccionario');
    expect(capture?.tooltip).toBe('Save word to dictionary after selection');
  });
});

describe('dictionary capture flow', () => {
  it('rejects multiword selections before creating highlights or occurrences', async () => {
    const service = {
      upsertEntry: vi.fn(),
      createOccurrence: vi.fn(),
    };

    const result = await captureDictionaryOccurrence({
      selectedText: 'dos palabras',
      cfi: 'epubcfi(/6/2!/4/2)',
      page: 7,
      book: { hash: 'book-hash', title: 'Libro de prueba', language: 'es' },
      highlightNoteId: 'note-1',
      service,
      sectionHref: 'chapter.xhtml',
    });

    expect(result).toEqual({ ok: false, reason: 'multi-word', selectedText: 'dos palabras' });
    expect(service.upsertEntry).not.toHaveBeenCalled();
    expect(service.createOccurrence).not.toHaveBeenCalled();
  });

  it('creates a visible highlight contract and durable occurrence for one repaired word', async () => {
    const service = {
      upsertEntry: vi.fn().mockResolvedValue({ id: 'entry-1' }),
      createOccurrence: vi.fn().mockResolvedValue({ id: 'occurrence-1' }),
    };
    const cfi = 'epubcfi(/6/2!/4/8,/1:0,/1:10)';

    const highlight = createDictionaryCaptureHighlight({
      selectedText: 'con-\nnection',
      cfi,
      page: 9,
      style: 'highlight',
      color: '#bae6fd',
      dictionaryEntryId: 'entry-1',
      id: 'note-1',
      timestamp: 1717000000000,
    });
    const result = await captureDictionaryOccurrence({
      selectedText: 'con-\nnection',
      cfi,
      page: 9,
      book: { hash: 'book-hash', title: 'Network Notes', language: 'en' },
      highlightNoteId: highlight.id,
      service,
      sectionHref: 'chapter.xhtml',
    });

    expect(highlight).toMatchObject({
      id: 'note-1',
      type: 'annotation',
      cfi,
      style: 'highlight',
      color: '#bae6fd',
      dictionaryEntryId: 'entry-1',
      text: 'con-\nnection',
      note: '',
      page: 9,
    });
    expect(highlight).not.toHaveProperty('citeId');
    expect(result).toEqual({ ok: true, entryId: 'entry-1', occurrenceId: 'occurrence-1' });
    expect(service.upsertEntry).toHaveBeenCalledWith({
      term: 'connection',
      displayTerm: 'connection',
      language: 'en',
      enrichmentStatus: 'pending',
    });
    expect(service.createOccurrence).toHaveBeenCalledWith({
      entryId: 'entry-1',
      bookHash: 'book-hash',
      bookTitle: 'Network Notes',
      cfi,
      sectionHref: 'chapter.xhtml',
      page: 9,
      selectedText: 'con-\nnection',
      highlightNoteId: 'note-1',
    });
  });
});
