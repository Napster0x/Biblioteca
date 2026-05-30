import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { DictionaryService } from '@/services/dictionary/DictionaryService';
import type { DatabaseService } from '@/types/database';

describe('DictionaryService', () => {
  let db: DatabaseService;
  let service: DictionaryService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('dictionary'));
    service = new DictionaryService(db, {
      now: () => 1700000000000,
      createId: (prefix) => `${prefix}-fixed`,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('deduplicates entries by normalized term and language', async () => {
    const first = await service.upsertEntry({ term: 'Tree', language: 'en' });
    const second = await service.upsertEntry({ term: 'tree', language: 'en' });

    expect(second).toEqual(first);

    const rows = await db.select<{ term: string; language: string | null }>(
      'SELECT term, language FROM dictionary_entries',
    );
    expect(rows).toEqual([{ term: 'tree', language: 'en' }]);
  });

  it('creates an occurrence linked to an existing entry', async () => {
    const entry = await service.upsertEntry({ term: 'lighthouse', language: 'en' });

    const occurrence = await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      bookTitle: 'Sea Notes',
      bookAuthor: 'Marina Test',
      cfi: '/6/2!/4/2',
      sectionHref: 'chapter.xhtml',
      page: 12,
      selectedText: 'light-\nhouse',
      contextBefore: 'the old',
      contextAfter: 'stood there',
      highlightNoteId: 'note-1',
    });

    expect(occurrence).toMatchObject({
      entryId: entry.id,
      bookHash: 'book-1',
      bookTitle: 'Sea Notes',
      bookAuthor: 'Marina Test',
      cfi: '/6/2!/4/2',
      selectedText: 'light-\nhouse',
      highlightNoteId: 'note-1',
    });

    const rows = await db.select<{
      entry_id: string;
      book_author: string | null;
      selected_text: string;
    }>('SELECT entry_id, book_author, selected_text FROM dictionary_occurrences');
    expect(rows).toEqual([
      { entry_id: entry.id, book_author: 'Marina Test', selected_text: 'light-\nhouse' },
    ]);

    const occurrences = await service.listOccurrences(entry.id);
    expect(occurrences[0]).toMatchObject({
      bookTitle: 'Sea Notes',
      bookAuthor: 'Marina Test',
    });
  });

  it('records no enrichment by default when no enrichmentStatus provided', async () => {
    const entry = await service.upsertEntry({ term: 'offline', language: 'en' });

    expect(entry.enrichmentStatus).toBe('none');
    expect(entry.definition).toBeUndefined();
  });

  it('updates definition and curiosity on an existing entry via updateEntry', async () => {
    const entry = await service.upsertEntry({ term: 'ephemeral', language: 'en' });

    const updated = await service.updateEntry({
      id: entry.id,
      definition: 'Lasting for a very short time; fleeting.',
      curiosity: 'From Greek ephēmeros, lasting only a day.',
    });

    expect(updated.definition).toBe('Lasting for a very short time; fleeting.');
    expect(updated.curiosity).toBe('From Greek ephēmeros, lasting only a day.');
    expect(updated.id).toBe(entry.id);

    // Verify persistence
    const rows = await db.select<{ definition: string | null; curiosity: string | null }>(
      'SELECT definition, curiosity FROM dictionary_entries WHERE id = ?',
      [entry.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.definition).toBe('Lasting for a very short time; fleeting.');
    expect(rows[0]!.curiosity).toBe('From Greek ephēmeros, lasting only a day.');
  });

  it('updates imagePath on an existing entry via updateEntry', async () => {
    const entry = await service.upsertEntry({ term: 'lighthouse', language: 'en' });

    const updated = await service.updateEntry({
      id: entry.id,
      imagePath: 'Dictionaries/images/lighthouse.jpg',
    });

    expect(updated.imagePath).toBe('Dictionaries/images/lighthouse.jpg');

    const rows = await db.select<{ image_path: string | null }>(
      'SELECT image_path FROM dictionary_entries WHERE id = ?',
      [entry.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.image_path).toBe('Dictionaries/images/lighthouse.jpg');
  });

  it('returns entry by id via getEntry', async () => {
    const entry = await service.upsertEntry({ term: 'serendipia', language: 'es' });

    const found = await service.getEntry(entry.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
    expect(found!.term).toBe('serendipia');
  });

  it('returns null via getEntry when entry does not exist', async () => {
    const result = await service.getEntry('entry-nonexistent');
    expect(result).toBeNull();
  });
});
