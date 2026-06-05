import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createFinalAnnotationBookNote,
  createTemporaryAnnotationBookNote,
  markAnotacionesHighlightsDeleted,
} from '@/app/reader/utils/annotacionesCapture';
import type { BookNote } from '@/types/book';

describe('markAnotacionesHighlightsDeleted', () => {
  const baseNote: BookNote = {
    id: 'note-1',
    type: 'annotation',
    cfi: 'epubcfi(/6/2)',
    style: 'highlight',
    annotationId: 'annot-1',
    text: 'anotacion uno',
    note: '',
    createdAt: 100,
    updatedAt: 100,
  };

  it('soft-deletes one matching annotation highlight by annotationId without mutating other notes', () => {
    const untouched: BookNote = {
      ...baseNote,
      id: 'note-2',
      annotationId: 'annot-2',
      text: 'anotacion dos',
    };

    const result = markAnotacionesHighlightsDeleted([baseNote, untouched], ['annot-1'], 9000);

    expect(result.changed).toBe(true);
    expect(result.booknotes).toEqual([{ ...baseNote, deletedAt: 9000 }, untouched]);
    expect(baseNote.deletedAt).toBeUndefined();
  });

  it('soft-deletes every matching highlight in a bulk annotationId array', () => {
    const second: BookNote = {
      ...baseNote,
      id: 'note-2',
      annotationId: 'annot-2',
      text: 'anotacion dos',
    };
    const normalHighlight: BookNote = {
      ...baseNote,
      id: 'note-normal',
      annotationId: undefined,
      dictionaryEntryId: 'entry-1',
    };

    const result = markAnotacionesHighlightsDeleted(
      [baseNote, second, normalHighlight],
      ['annot-1', 'annot-2'],
      9001,
    );

    expect(result.changed).toBe(true);
    expect(result.booknotes).toEqual([
      { ...baseNote, deletedAt: 9001 },
      { ...second, deletedAt: 9001 },
      normalHighlight,
    ]);
  });

  it('reports no change when no active note matches the selected annotationIds', () => {
    const alreadyDeleted: BookNote = { ...baseNote, deletedAt: 777 };

    const result = markAnotacionesHighlightsDeleted([alreadyDeleted], ['annot-1'], 9002);

    expect(result.changed).toBe(false);
    expect(result.booknotes).toEqual([alreadyDeleted]);
  });

  it('is a pure function and does not mutate the input array or its elements', () => {
    const original: BookNote = { ...baseNote, annotationId: 'annot-1' };
    const input = [original];

    const result = markAnotacionesHighlightsDeleted(input, ['annot-1'], 9999);

    expect(result.changed).toBe(true);
    expect(result.booknotes[0]?.deletedAt).toBe(9999);
    expect(original.deletedAt).toBeUndefined();
    expect(input[0]!.deletedAt).toBeUndefined();
  });

  it('returns booknotes unchanged when annotationIds array is empty', () => {
    const result = markAnotacionesHighlightsDeleted([baseNote], [], 9000);

    expect(result.changed).toBe(false);
    expect(result.booknotes).toEqual([baseNote]);
  });

  it('supports passing annotationIds as a readonly string array', () => {
    const second: BookNote = { ...baseNote, id: 'note-2', annotationId: 'annot-2' };

    const result = markAnotacionesHighlightsDeleted([baseNote, second], ['annot-1'], 9000);

    expect(result.changed).toBe(true);
    expect(result.booknotes[0]?.deletedAt).toBe(9000);
    expect(result.booknotes[1]?.deletedAt).toBeUndefined();
  });
});

describe('annotation pending/final BookNote helpers', () => {
  const pending = {
    key: 'book-1',
    cfi: 'epubcfi(/6/2!/4/2)',
    href: 'ch1.xhtml',
    text: 'plain selected text',
    page: 42,
    range: new Range(),
    index: 0,
    temporaryBookNoteId: 'temp-note-1',
    createdTemporaryOverlay: true,
  };

  it('creates an explicit temporary yellow overlay BookNote without annotationId', () => {
    const temporary = createTemporaryAnnotationBookNote(pending, 1000);

    expect(temporary).toEqual({
      id: 'temp-note-1',
      type: 'annotation',
      cfi: 'epubcfi(/6/2!/4/2)',
      style: 'highlight',
      color: 'yellow',
      text: 'plain selected text',
      note: '',
      page: 42,
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it('creates the final Anotaciones BookNote invariant from SQL id', () => {
    const final = createFinalAnnotationBookNote(pending, 'annot-1', 'final-note-1', 2000);

    expect(final).toEqual({
      id: 'final-note-1',
      type: 'annotation',
      annotationId: 'annot-1',
      cfi: 'epubcfi(/6/2!/4/2)',
      style: 'highlight',
      color: 'yellow',
      text: 'plain selected text',
      note: '',
      page: 42,
      createdAt: 2000,
      updatedAt: 2000,
    });
  });

  it('tolerates legacy annotation highlights with note content without changing new final shape', () => {
    const legacy: BookNote = {
      id: 'legacy-1',
      type: 'annotation',
      annotationId: 'annot-legacy',
      cfi: 'epubcfi(/6/2!/4/8)',
      style: 'highlight',
      color: 'yellow',
      text: 'legacy selected text',
      note: 'legacy note body',
      createdAt: 1,
      updatedAt: 1,
    };
    const final = createFinalAnnotationBookNote(pending, 'annot-new', 'final-note-2', 3000);

    expect(legacy.note).toBe('legacy note body');
    expect(legacy.annotationId).toBe('annot-legacy');
    expect(final.note).toBe('');
    expect(final.annotationId).toBe('annot-new');
  });
});

describe('Anotaciones reader source guards', () => {
  it('keeps handleAnnotate off the generic handleHighlight(true) path', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/reader/components/annotator/Annotator.tsx'),
      'utf8',
    );
    const handleAnnotate = source.match(/const handleAnnotate = \(\) => \{[\s\S]*?\n {2}\};/);

    expect(handleAnnotate).not.toBeNull();
    expect(handleAnnotate![0]).not.toContain('handleHighlight(true)');
    expect(handleAnnotate![0]).toContain('setNotebookNewAnnotation');
    expect(handleAnnotate![0]).toContain('deselect');
  });

  it('keeps the NoteEditor selected text preview plain instead of booknote styled', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/reader/components/notebook/NoteEditor.tsx'),
      'utf8',
    );
    const preview = source.match(/<div\s+data-testid='annotation-preview'[\s\S]*?<\/div>/);

    expect(preview).not.toBeNull();
    expect(preview![0]).toContain('getAnnotationText()');
    expect(preview![0]).not.toContain('booknote-text');
    expect(preview![0]).not.toContain('backgroundColor');
  });
});
