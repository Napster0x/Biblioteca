import { describe, expect, it } from 'vitest';

import { markAnotacionesHighlightsDeleted } from '@/app/reader/utils/annotacionesCapture';
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
