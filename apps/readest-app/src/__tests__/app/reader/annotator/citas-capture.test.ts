import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  captureQuoteFromSelection,
  CITAS_HIGHLIGHT_FALLBACK,
  markCitasHighlightsDeleted,
  resolveCitasHighlightColor,
} from '@/app/reader/utils/citasCapture';
import type { BookNote } from '@/types/book';

describe('reader quote selection actions', () => {
  it('exposes the Citas quick action as a quote tool', () => {
    const quote = annotationToolButtons.find((button) => button.type === 'quote');

    expect(quote?.label).toBe('Citas');
    expect(quote?.tooltip).toBe('Save selected text as a quote');
    expect(quote?.quickAction).toBe(true);
    expect(annotationToolButtons.some((button) => button.type === 'placeholder-c')).toBe(false);
  });
});

describe('citas highlight color', () => {
  it('resolves the configured token value when the browser exposes it', () => {
    document.documentElement.style.setProperty('--citas-highlight', '#fee2e2');

    expect(resolveCitasHighlightColor()).toBe('#fee2e2');

    document.documentElement.style.removeProperty('--citas-highlight');
  });

  it('falls back to rojo clarito when the token is unavailable', () => {
    document.documentElement.style.removeProperty('--citas-highlight');

    expect(resolveCitasHighlightColor()).toBe(CITAS_HIGHLIGHT_FALLBACK);
  });

  it('keeps the CSS token as the single source of truth', () => {
    const globals = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

    expect(globals).toContain(`--citas-highlight: ${CITAS_HIGHLIGHT_FALLBACK}`);
  });
});

describe('markCitasHighlightsDeleted', () => {
  const baseNote: BookNote = {
    id: 'note-1',
    type: 'annotation',
    cfi: 'epubcfi(/6/2)',
    style: 'highlight',
    citeId: 'cite-1',
    text: 'cita uno',
    note: '',
    createdAt: 100,
    updatedAt: 100,
  };

  it('soft-deletes one matching Citas highlight by citeId without mutating other notes', () => {
    const untouched: BookNote = { ...baseNote, id: 'note-2', citeId: 'cite-2', text: 'cita dos' };

    const result = markCitasHighlightsDeleted([baseNote, untouched], new Set(['cite-1']), 9000);

    expect(result.changed).toBe(true);
    expect(result.booknotes).toEqual([{ ...baseNote, deletedAt: 9000 }, untouched]);
    expect(baseNote.deletedAt).toBeUndefined();
  });

  it('soft-deletes every matching highlight in a bulk citeId set', () => {
    const second: BookNote = { ...baseNote, id: 'note-2', citeId: 'cite-2', text: 'cita dos' };
    const normalHighlight: BookNote = {
      ...baseNote,
      id: 'note-normal',
      citeId: undefined,
      dictionaryEntryId: 'entry-1',
    };

    const result = markCitasHighlightsDeleted(
      [baseNote, second, normalHighlight],
      new Set(['cite-1', 'cite-2']),
      9001,
    );

    expect(result.changed).toBe(true);
    expect(result.booknotes).toEqual([
      { ...baseNote, deletedAt: 9001 },
      { ...second, deletedAt: 9001 },
      normalHighlight,
    ]);
  });

  it('reports no change when no active note matches the selected citeIds', () => {
    const alreadyDeleted: BookNote = { ...baseNote, deletedAt: 777 };

    const result = markCitasHighlightsDeleted([alreadyDeleted], new Set(['cite-1']), 9002);

    expect(result.changed).toBe(false);
    expect(result.booknotes).toEqual([alreadyDeleted]);
  });
});

describe('citas capture client graph', () => {
  it('keeps the reader helper free of Node-only imports', () => {
    const helper = readFileSync(
      resolve(process.cwd(), 'src/app/reader/utils/citasCapture.ts'),
      'utf8',
    );

    expect(helper).not.toMatch(/from ['"]node:/);
    expect(helper).not.toMatch(/from ['"](?:fs|path|crypto)['"]/);
  });

  it('keeps the reader Citas path and service path browser-safe', () => {
    const files = [
      'src/app/reader/components/annotator/Annotator.tsx',
      'src/app/reader/utils/citasCapture.ts',
      'src/services/citas/citasServiceCache.ts',
      'src/services/citas/CitasService.ts',
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');

      expect(source, file).not.toMatch(/from ['"]node:/);
      expect(source, file).not.toMatch(/from ['"](?:fs|path|crypto)['"]/);
    }
  });

  it('adds Phase 3 quote hover delete and blocks Phase 4 navigation out-of-scope', () => {
    const annotator = readFileSync(
      resolve(process.cwd(), 'src/app/reader/components/annotator/Annotator.tsx'),
      'utf8',
    );

    // Phase 3: quote highlights now support hover delete
    expect(annotator).toMatch(/citeId[\s\S]{0,120}(delete|deletedAt|removeBookNoteOverlays)/i);
    // Phase 4 not yet: no blink/parpadeo/flash for quote navigation
    expect(annotator).not.toMatch(/(blink|parpadeo|flash)/i);
    // Phase 4 not yet: no citeId-based router.push for Citas nav
    expect(annotator).not.toMatch(/citeId[\s\S]{0,120}router\.push/i);
  });
});

describe('captureQuoteFromSelection', () => {
  it('creates a CiteInput first and returns a cite-linked BookNote highlight', async () => {
    const quote = {
      id: 'cite-1',
      bookHash: 'book-hash',
      bookTitle: 'Rayuela',
      bookAuthor: 'Julio Cortázar',
      cfi: 'epubcfi(/6/2!/4/8,/1:0,/1:10)',
      sectionHref: 'chapter.xhtml',
      page: 21,
      text: 'Andábamos sin buscarnos pero sabiendo que andábamos para encontrarnos.',
      contextBefore: 'La Maga y yo',
      contextAfter: 'en París',
      contentHash: 'hash-1',
      createdAt: 1717000000000,
      updatedAt: null,
    };
    const service = {
      createQuote: vi.fn().mockResolvedValue(quote),
    };

    const result = await captureQuoteFromSelection({
      selectedText: quote.text,
      cfi: quote.cfi,
      page: quote.page,
      sectionHref: quote.sectionHref,
      book: {
        hash: quote.bookHash,
        title: quote.bookTitle,
        author: quote.bookAuthor,
      },
      contextBefore: quote.contextBefore,
      contextAfter: quote.contextAfter,
      service,
      noteId: 'note-1',
      timestamp: 1717000000000,
      color: '#fee2e2',
    });

    expect(service.createQuote).toHaveBeenCalledWith({
      bookHash: quote.bookHash,
      bookTitle: quote.bookTitle,
      bookAuthor: quote.bookAuthor,
      cfi: quote.cfi,
      sectionHref: quote.sectionHref,
      page: quote.page,
      text: quote.text,
      contextBefore: quote.contextBefore,
      contextAfter: quote.contextAfter,
    });
    expect(result).toEqual({
      ok: true,
      quote,
      highlight: {
        id: 'note-1',
        type: 'annotation',
        cfi: quote.cfi,
        style: 'highlight',
        color: '#fee2e2',
        citeId: quote.id,
        text: quote.text,
        note: '',
        page: quote.page,
        createdAt: 1717000000000,
        updatedAt: 1717000000000,
      },
    });
  });

  it('aborts without creating a quote or highlight when CFI is missing', async () => {
    const service = {
      createQuote: vi.fn(),
    };

    const result = await captureQuoteFromSelection({
      selectedText: 'texto seleccionado',
      cfi: '   ',
      page: 3,
      sectionHref: 'chapter.xhtml',
      book: { hash: 'book-hash', title: 'Libro', author: 'Autora' },
      service,
      noteId: 'note-missing-cfi',
      timestamp: 1717000000000,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'missing-cfi',
      message: 'Quote capture requires a valid CFI.',
    });
    expect(service.createQuote).not.toHaveBeenCalled();
  });

  it('reports duplicate persistence errors without returning an orphan highlight', async () => {
    const service = {
      createQuote: vi
        .fn()
        .mockRejectedValue(
          new Error('UNIQUE constraint failed: quotes.book_hash, quotes.content_hash'),
        ),
    };

    const result = await captureQuoteFromSelection({
      selectedText: 'texto repetido',
      cfi: 'epubcfi(/6/2!/4/2)',
      book: { hash: 'book-hash' },
      service,
      noteId: 'note-duplicate',
      timestamp: 1717000000000,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'duplicate',
      message: 'Quote already exists for this book and content.',
    });
  });
});
