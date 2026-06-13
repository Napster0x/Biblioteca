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

    // D4: listEntries includes soft-deleted entries for tombstone sync
    const all = await service.listEntries();
    expect(all).toHaveLength(3);
    const deletedOne = all.find((x) => x.id === removeOne.id);
    expect(deletedOne?.deletedAt).toBe(1700000000000);
    const deletedTwo = all.find((x) => x.id === removeTwo.id);
    expect(deletedTwo?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === keep.id);
    expect(kept?.deletedAt).toBeUndefined();

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

  it('deleteEntries soft-deletes: listEntries includes deleted rows for tombstone sync', async () => {
    const a = await service.upsertEntry({ term: 'alpha', language: 'en' });
    const b = await service.upsertEntry({ term: 'beta', language: 'en' });

    await service.deleteEntries([a.id]);

    // D4: listEntries includes soft-deleted rows for tombstone consistency
    const all = await service.listEntries();
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === a.id);
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === b.id);
    expect(kept?.deletedAt).toBeUndefined();

    const rows = await db.select<{ id: string; deleted_at: number | null }>(
      'SELECT id, deleted_at FROM dictionary_entries ORDER BY id',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.deleted_at).toBe(1700000000000);
    expect(rows[1]?.deleted_at).toBeNull();
  });

  it('deleteEntries does NOT cascade-delete occurrences (they stay but are soft-deleted)', async () => {
    const entry = await service.upsertEntry({ term: 'gamma', language: 'en' });
    await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'gamma',
    });

    await service.deleteEntries([entry.id]);

    // D4: entries with deletedAt still visible via listEntries
    const entries = await service.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.deletedAt).toBe(1700000000000);

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

  it('upsertEntry persists replica_timestamps through to SQLite', async () => {
    const timestamps = {
      term: '1700000001000-0001-device-a',
      definition: '1700000001000-0002-device-a',
    };

    const entry = await service.upsertEntry({
      term: 'replica-persist',
      displayTerm: 'Replica Persist',
      language: 'en',
      definition: 'a definition',
      _replicaTimestamps: timestamps,
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_entries WHERE id = ?',
      [entry.id],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const reloaded = await service.getEntry(entry.id);
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('upsertEntry stores null replica_timestamps when none provided', async () => {
    const entry = await service.upsertEntry({
      term: 'no-replica-ts',
      language: 'en',
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_entries WHERE id = ?',
      [entry.id],
    );
    expect(rows).toEqual([{ replica_timestamps: null }]);

    const reloaded = await service.getEntry(entry.id);
    expect(reloaded?._replicaTimestamps).toEqual({});
  });

  it('createOccurrence persists replica_timestamps through to SQLite', async () => {
    const entry = await service.upsertEntry({ term: 'occ-replica', language: 'en' });
    const timestamps = {
      selectedText: '1700000001000-0001-device-a',
      bookTitle: '1700000001000-0002-device-a',
    };

    const occ = await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      bookTitle: 'Test Book',
      cfi: '/6/2',
      selectedText: 'test word',
      _replicaTimestamps: timestamps,
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_occurrences WHERE id = ?',
      [occ.id],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const [reloaded] = await service.listAllOccurrences();
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('createOccurrence stores null replica_timestamps when none provided', async () => {
    const entry = await service.upsertEntry({ term: 'occ-no-ts', language: 'en' });

    const occ = await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'no timestamps',
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_occurrences WHERE id = ?',
      [occ.id],
    );
    expect(rows).toEqual([{ replica_timestamps: null }]);

    const [reloaded] = await service.listAllOccurrences();
    expect(reloaded?._replicaTimestamps).toEqual({});
  });

  it('updateEntry persists replica_timestamps through to SQLite', async () => {
    const entry = await service.upsertEntry({ term: 'update-replica', language: 'en' });

    const timestamps = {
      definition: '1700000002000-0001-device-a',
      curiosity: '1700000002000-0002-device-a',
    };

    await service.updateEntry({
      id: entry.id,
      definition: 'updated definition',
      _replicaTimestamps: timestamps,
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_entries WHERE id = ?',
      [entry.id],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const reloaded = await service.getEntry(entry.id);
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('updateEntry stores null replica_timestamps when none provided', async () => {
    const entry = await service.upsertEntry({ term: 'update-no-ts', language: 'en' });

    await service.updateEntry({
      id: entry.id,
      definition: 'updated',
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_entries WHERE id = ?',
      [entry.id],
    );
    expect(rows).toEqual([{ replica_timestamps: null }]);

    const reloaded = await service.getEntry(entry.id);
    expect(reloaded?._replicaTimestamps).toEqual({});
  });

  it('bulkUpsertEntries persists and reloads per-field replica timestamps', async () => {
    const timestamps = {
      definition: '1700000001000-0001-device-a',
      enrichmentStatus: '1700000001000-0002-device-a',
    };

    await service.bulkUpsertEntries([
      {
        id: 'entry-replica-1',
        term: 'lambda',
        displayTerm: 'lambda',
        language: 'en',
        enrichmentStatus: 'ready',
        definition: 'with metadata',
        createdAt: 100,
        updatedAt: 100,
        _replicaTimestamps: timestamps,
      },
    ]);

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_entries WHERE id = ?',
      ['entry-replica-1'],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const reloaded = await service.getEntry('entry-replica-1');
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('maps NULL and invalid dictionary entry replica_timestamps to an empty object', async () => {
    await db.execute(
      `INSERT INTO dictionary_entries
       (id, term, display_term, enrichment_status, created_at, updated_at, replica_timestamps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['entry-null-replica', 'null-entry', 'null-entry', 'none', 1, 1, null],
    );
    await db.execute(
      `INSERT INTO dictionary_entries
       (id, term, display_term, enrichment_status, created_at, updated_at, replica_timestamps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['entry-invalid-replica', 'invalid-entry', 'invalid-entry', 'none', 2, 2, '{not-json'],
    );

    await expect(service.getEntry('entry-invalid-replica')).resolves.toMatchObject({
      id: 'entry-invalid-replica',
      _replicaTimestamps: {},
    });
    await expect(service.getEntry('entry-null-replica')).resolves.toMatchObject({
      id: 'entry-null-replica',
      _replicaTimestamps: {},
    });
  });

  it('maps missing dictionary entry replica_timestamps to an empty object', async () => {
    const dbWithoutColumn: DatabaseService = {
      select: async <T extends Record<string, unknown>>(): Promise<T[]> => [
        {
          id: 'entry-missing-replica',
          term: 'missing-entry',
          display_term: 'missing-entry',
          language: null,
          definition: null,
          enrichment_status: 'none',
          image_path: null,
          curiosity: null,
          created_at: 1,
          updated_at: 1,
          deleted_at: null,
        } as unknown as T,
      ],
      execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
      batch: async () => undefined,
      close: async () => undefined,
    };

    const [entry] = await new DictionaryService(dbWithoutColumn).listAllEntries();

    expect(entry?._replicaTimestamps).toEqual({});
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

    // D4: listEntries includes deleted rows for tombstone sync
    const all = await service.listEntries();
    expect(all).toHaveLength(1);
    expect(all[0]?.definition).toBe('updated');
    expect(all[0]?.deletedAt).toBe(200);

    const allRows = await service.listAllEntries();
    expect(allRows).toHaveLength(1);
    expect(allRows[0]?.definition).toBe('updated');
    expect(allRows[0]?.deletedAt).toBe(200);
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

  it('bulkUpsertOccurrences persists and reloads per-field replica timestamps', async () => {
    const entry = await service.upsertEntry({ term: 'mu', language: 'en' });
    const timestamps = {
      selectedText: '1700000001000-0001-device-a',
      highlightNoteId: '1700000001000-0002-device-a',
    };

    await service.bulkUpsertOccurrences([
      {
        id: 'occ-replica-1',
        entryId: entry.id,
        bookHash: 'book-1',
        cfi: '/6/2',
        selectedText: 'mu',
        createdAt: 100,
        _replicaTimestamps: timestamps,
      },
    ]);

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM dictionary_occurrences WHERE id = ?',
      ['occ-replica-1'],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const [reloaded] = await service.listAllOccurrences();
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('maps NULL and invalid dictionary occurrence replica_timestamps to an empty object', async () => {
    const entry = await service.upsertEntry({ term: 'nu', language: 'en' });
    await db.execute(
      `INSERT INTO dictionary_occurrences
       (id, entry_id, book_hash, cfi, selected_text, created_at, replica_timestamps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['occ-null-replica', entry.id, 'book-1', '/6/2', 'null occurrence', 1, null],
    );
    await db.execute(
      `INSERT INTO dictionary_occurrences
       (id, entry_id, book_hash, cfi, selected_text, created_at, replica_timestamps)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['occ-invalid-replica', entry.id, 'book-1', '/6/4', 'invalid occurrence', 2, '{not-json'],
    );

    const occurrences = await service.listAllOccurrences();
    expect(occurrences.find((occ) => occ.id === 'occ-invalid-replica')?._replicaTimestamps).toEqual(
      {},
    );
    expect(occurrences.find((occ) => occ.id === 'occ-null-replica')?._replicaTimestamps).toEqual(
      {},
    );
  });

  it('maps missing dictionary occurrence replica_timestamps to an empty object', async () => {
    const dbWithoutColumn: DatabaseService = {
      select: async <T extends Record<string, unknown>>(): Promise<T[]> => [
        {
          id: 'occ-missing-replica',
          entry_id: 'entry-1',
          book_hash: 'book-1',
          book_title: null,
          book_author: null,
          cfi: '/6/2',
          section_href: null,
          page: null,
          selected_text: 'missing occurrence timestamp column',
          context_before: null,
          context_after: null,
          highlight_note_id: null,
          created_at: 1,
          deleted_at: null,
        } as unknown as T,
      ],
      execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
      batch: async () => undefined,
      close: async () => undefined,
    };

    const [occurrence] = await new DictionaryService(dbWithoutColumn).listAllOccurrences();

    expect(occurrence?._replicaTimestamps).toEqual({});
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

    // D4: listOccurrences includes deleted rows for tombstone sync
    const all = await service.listOccurrences(entry.id);
    expect(all).toHaveLength(1);
    expect(all[0]?.selectedText).toBe('updated kappa');
    expect(all[0]?.deletedAt).toBe(300);

    const allRows = await service.listAllOccurrences();
    expect(allRows).toHaveLength(1);
    expect(allRows[0]?.selectedText).toBe('updated kappa');
    expect(allRows[0]?.deletedAt).toBe(300);
  });

  it('serializes concurrent public calls that touch the database', async () => {
    const events: string[] = [];
    const gate = createGate();
    const guardedDb = createOverlapRejectingDb(events, gate.promise);
    const guardedService = new DictionaryService(guardedDb);

    const listPromise = guardedService.listEntries();
    await Promise.resolve();
    const upsertPromise = guardedService.bulkUpsertEntries([
      {
        id: 'entry-serial',
        term: 'serial',
        displayTerm: 'serial',
        language: 'en',
        enrichmentStatus: 'none',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await Promise.resolve();
    expect(events).toEqual(['select:start']);

    gate.resolve();
    await expect(Promise.all([listPromise, upsertPromise])).resolves.toEqual([[], undefined]);
    expect(events).toEqual(['select:start', 'select:end', 'execute:start', 'execute:end']);
  });

  it('releases the database lock after an error so later calls can proceed', async () => {
    const events: string[] = [];
    const recoveringDb: DatabaseService = {
      select: async () => {
        events.push('select:fail');
        throw new Error('read failed');
      },
      execute: async () => {
        events.push('execute:success');
        return { rowsAffected: 1, lastInsertId: 0 };
      },
      batch: async () => undefined,
      close: async () => undefined,
    };
    const recoveringService = new DictionaryService(recoveringDb);

    await expect(recoveringService.listEntries()).rejects.toThrow('read failed');
    await expect(recoveringService.deleteEntries(['entry-1'])).resolves.toBeUndefined();

    expect(events).toEqual(['select:fail', 'execute:success', 'execute:success']);
  });

  // ---------------------------------------------------------------------------
  // D4: Tombstone consistency — listEntries/listOccurrences include soft-deleted rows
  // ---------------------------------------------------------------------------

  it('listEntries includes soft-deleted entries for tombstone consistency', async () => {
    const a = await service.upsertEntry({ term: 'alpha', language: 'en' });
    const b = await service.upsertEntry({ term: 'beta', language: 'en' });

    await service.deleteEntries([b.id]);

    // listEntries MUST include soft-deleted rows for tombstone sync
    const all = await service.listEntries();
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === b.id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === a.id);
    expect(kept).toBeDefined();
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('listOccurrences includes soft-deleted occurrences for tombstone consistency', async () => {
    const entry = await service.upsertEntry({ term: 'lighthouse', language: 'en' });
    const occ1 = await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/2',
      selectedText: 'first occurrence',
    });
    const occ2 = await service.createOccurrence({
      entryId: entry.id,
      bookHash: 'book-1',
      cfi: '/6/3',
      selectedText: 'second occurrence',
    });

    // Soft-delete occ2 by upserting with deletedAt via bulkUpsert
    await service.bulkUpsertOccurrences([{ ...occ2, deletedAt: 1700000000000 }]);

    // listOccurrences MUST include soft-deleted rows for tombstone sync
    const all = await service.listOccurrences(entry.id);
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === occ2.id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === occ1.id);
    expect(kept).toBeDefined();
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('searchEntries excludes soft-deleted entries', async () => {
    await service.upsertEntry({ term: 'visible', language: 'en' });
    const b = await service.upsertEntry({ term: 'deleted', language: 'en' });
    await service.deleteEntries([b.id]);

    const results = await service.searchEntries('deleted');
    expect(results).toHaveLength(0);
  });
});

function createGate(): { promise: Promise<void>; resolve: () => void } {
  let resolveGate: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  return {
    promise,
    resolve: () => {
      if (!resolveGate) throw new Error('Gate resolver not initialized');
      resolveGate();
    },
  };
}

function createOverlapRejectingDb(events: string[], firstDelay: Promise<void>): DatabaseService {
  let inUse = false;
  let operationCount = 0;

  async function runGuarded<T>(name: string, result: T): Promise<T> {
    if (inUse) throw new Error('concurrent use forbidden');
    inUse = true;
    operationCount += 1;
    events.push(`${name}:start`);
    if (operationCount === 1) await firstDelay;
    events.push(`${name}:end`);
    inUse = false;
    return result;
  }

  return {
    select: async <T extends Record<string, unknown>>(): Promise<T[]> => runGuarded('select', []),
    execute: async () => runGuarded('execute', { rowsAffected: 1, lastInsertId: 0 }),
    batch: async () => undefined,
    close: async () => undefined,
  };
}
