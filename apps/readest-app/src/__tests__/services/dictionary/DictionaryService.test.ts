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
    let idCounter = 0;
    service = new DictionaryService(db, {
      now: () => 1700000000000,
      createId: (prefix) => `${prefix}-${++idCounter}`,
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

  it('creates a manual dictionary entry without creating an occurrence', async () => {
    const entry = await service.upsertEntry({
      term: '  Lantern  ',
      displayTerm: 'Lantern',
      definition: 'A portable lamp.',
      enrichmentStatus: 'none',
    });

    expect(entry).toMatchObject({
      term: 'lantern',
      displayTerm: 'Lantern',
      definition: 'A portable lamp.',
      enrichmentStatus: 'none',
    });

    const occurrences = await db.select<{ entry_id: string }>(
      'SELECT entry_id FROM dictionary_occurrences WHERE entry_id = ?',
      [entry.id],
    );
    expect(occurrences).toEqual([]);
  });

  it('searches entries by term, definition, occurrence text, book title, and book author', async () => {
    const entry = await service.upsertEntry({
      term: 'Aleph',
      definition: 'A point containing all points.',
    });
    await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      bookTitle: 'Ficciones',
      bookAuthor: 'Borges',
      cfi: '/6/2',
      selectedText: 'El Aleph',
    });

    expect((await service.searchEntries('aleph')).map((item) => item.id)).toEqual([entry.id]);
    expect((await service.searchEntries('points')).map((item) => item.id)).toEqual([entry.id]);
    expect((await service.searchEntries('ficciones')).map((item) => item.id)).toEqual([entry.id]);
    expect((await service.searchEntries('borges')).map((item) => item.id)).toEqual([entry.id]);
    expect(await service.searchEntries('xyzzy')).toEqual([]);
  });

  it('soft-deletes selected entries and their occurrences', async () => {
    const keep = await service.upsertEntry({ term: 'anchor', language: 'en' });
    const removeOne = await service.upsertEntry({ term: 'beacon', language: 'en' });
    const removeTwo = await service.upsertEntry({ term: 'current', language: 'en' });

    await service.createOccurrence({
      entryId: keep.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'anchor',
    });
    await service.createOccurrence({
      entryId: removeOne.id,
      bookHash: 'book-1',
      cfi: '/6/4',
      selectedText: 'beacon',
    });
    await service.createOccurrence({
      entryId: removeTwo.id,
      bookHash: 'book-2',
      cfi: '/6/6',
      selectedText: 'current',
    });

    await service.deleteEntries([removeOne.id, removeTwo.id]);

    // listEntries filters out soft-deleted entries
    const visible = await service.listEntries();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(keep.id);

    // Entries still exist in the table with deleted_at set
    const entryRows = await db.select<{ id: string; term: string; deleted_at: number | null }>(
      'SELECT id, term, deleted_at FROM dictionary_entries ORDER BY term ASC',
    );
    expect(entryRows).toHaveLength(3);
    expect(entryRows[0]?.deleted_at).toBeNull();
    expect(entryRows[1]?.deleted_at).toBe(1700000000000);
    expect(entryRows[2]?.deleted_at).toBe(1700000000000);

    // Occurrences still exist with deleted_at set
    const occRows = await db.select<{
      entry_id: string;
      selected_text: string;
      deleted_at: number | null;
    }>(
      'SELECT entry_id, selected_text, deleted_at FROM dictionary_occurrences ORDER BY selected_text ASC',
    );
    expect(occRows).toHaveLength(3);
    expect(occRows[0]?.deleted_at).toBeNull(); // keep entry's occurrence stays undeleted
    expect(occRows[1]?.deleted_at).toBe(1700000000000); // removed entries' occurrences are deleted
    expect(occRows[2]?.deleted_at).toBe(1700000000000);
  });

  it('ignores an empty delete request without changing entries', async () => {
    const entry = await service.upsertEntry({ term: 'harbor', language: 'en' });

    await service.deleteEntries([]);

    const entries = await service.listEntries();
    expect(entries).toEqual([entry]);
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

  it('deleteEntries soft-deletes: listEntries excludes deleted rows', async () => {
    const a = await service.upsertEntry({ term: 'alpha', language: 'en' });
    const b = await service.upsertEntry({ term: 'beta', language: 'en' });

    await service.deleteEntries([a.id]);

    const visible = await service.listEntries();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(b.id);

    const rows = await db.select<{ id: string; deleted_at: number | null }>(
      'SELECT id, deleted_at FROM dictionary_entries ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.deleted_at).toBe(1700000000000);
    expect(rows[1]?.deleted_at).toBeNull();
  });

  it('deleteEntries does NOT cascade-delete occurrences (they stay but are filtered)', async () => {
    const entry = await service.upsertEntry({ term: 'gamma', language: 'en' });
    await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'gamma',
    });

    await service.deleteEntries([entry.id]);

    // Entries no longer visible
    const entries = await service.listEntries();
    expect(entries).toHaveLength(0);

    // Occurrences are still in the database
    const occRows = await db.select<{ id: string; deleted_at: number | null }>(
      'SELECT id, deleted_at FROM dictionary_occurrences',
    );
    expect(occRows).toHaveLength(1);
    expect(occRows[0]?.deleted_at).toBe(1700000000000);
  });

  it('listAllEntries returns all rows including soft-deleted', async () => {
    const a = await service.upsertEntry({ term: 'delta', language: 'en' });
    const b = await service.upsertEntry({ term: 'epsilon', language: 'en' });

    await service.deleteEntries([a.id]);

    const all = await service.listAllEntries();
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === a.id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === b.id);
    expect(kept).toBeDefined();
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('listAllOccurrences returns all occurrences including for deleted entries', async () => {
    const entry = await service.upsertEntry({ term: 'zeta', language: 'en' });
    await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'zeta',
    });

    await service.deleteEntries([entry.id]);

    const all = await service.listAllOccurrences();
    expect(all).toHaveLength(1);
    expect(all[0]?.selectedText).toBe('zeta');
    expect(all[0]?.deletedAt).toBe(1700000000000);
  });

  it('bulkUpsertEntries inserts new entries', async () => {
    const entries = [
      {
        id: 'entry-bulk-1',
        term: 'eta',
        displayTerm: 'eta',
        language: 'en',
        enrichmentStatus: 'none' as const,
        createdAt: 100,
        updatedAt: 100,
      },
    ];

    await service.bulkUpsertEntries(entries);

    const all = await service.listEntries();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('entry-bulk-1');
    expect(all[0]?.term).toBe('eta');
  });

  it('bulkUpsertEntries updates existing entries including deletedAt', async () => {
    const entry = await service.upsertEntry({ term: 'theta', language: 'en' });

    await service.bulkUpsertEntries([
      {
        ...entry,
        definition: 'updated',
        deletedAt: 200,
      },
    ]);

    const visible = await service.listEntries();
    expect(visible).toHaveLength(0);

    const all = await service.listAllEntries();
    expect(all).toHaveLength(1);
    expect(all[0]?.definition).toBe('updated');
    expect(all[0]?.deletedAt).toBe(200);
  });

  it('bulkUpsertOccurrences inserts new occurrences', async () => {
    const entry = await service.upsertEntry({ term: 'iota', language: 'en' });

    const occurrences = [
      {
        id: 'occ-bulk-1',
        entryId: entry.id,
        bookHash: 'book-1',
        cfi: '/6/2',
        selectedText: 'iota',
        createdAt: 100,
      },
    ];

    await service.bulkUpsertOccurrences(occurrences);

    const all = await service.listOccurrences(entry.id);
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('occ-bulk-1');
  });

  it('bulkUpsertOccurrences updates existing occurrences including deletedAt', async () => {
    const entry = await service.upsertEntry({ term: 'kappa', language: 'en' });
    const occ = await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'kappa',
    });

    await service.bulkUpsertOccurrences([
      {
        ...occ,
        selectedText: 'updated kappa',
        deletedAt: 300,
      },
    ]);

    const visible = await service.listOccurrences(entry.id);
    expect(visible).toHaveLength(0);

    const all = await service.listAllOccurrences();
    expect(all).toHaveLength(1);
    expect(all[0]?.selectedText).toBe('updated kappa');
    expect(all[0]?.deletedAt).toBe(300);
  });
});
