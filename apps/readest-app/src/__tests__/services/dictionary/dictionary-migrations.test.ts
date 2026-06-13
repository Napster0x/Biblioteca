import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';

describe('dictionary migrations', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('dictionary'));
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates dictionary_entries with a unique normalized term and language contract', async () => {
    await db.execute(
      `INSERT INTO dictionary_entries
       (id, term, display_term, language, enrichment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['entry-1', 'casa', 'casa', 'es', 'pending', 1, 1],
    );

    await expect(
      db.execute(
        `INSERT INTO dictionary_entries
         (id, term, display_term, language, enrichment_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['entry-2', 'casa', 'casa', 'es', 'pending', 2, 2],
      ),
    ).rejects.toThrow();
  });

  it('adds image_path and curiosity columns via dictionary_refine migration', async () => {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(dictionary_entries)`);
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('image_path');
    expect(columnNames).toContain('curiosity');
  });

  it('adds book_author to dictionary_occurrences via additive migration', async () => {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(dictionary_occurrences)`);
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('book_author');
  });

  it('adds deleted_at column to dictionary_entries for soft-delete support', async () => {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(dictionary_entries)`);
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('deleted_at');
  });

  it('adds nullable replica_timestamps column to dictionary_entries for CRDT metadata', async () => {
    const columns = await db.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(dictionary_entries)`);
    const column = columns.find((c) => c.name === 'replica_timestamps');

    expect(column).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: 'NULL' });
  });

  it('adds deleted_at column to dictionary_occurrences for soft-delete support', async () => {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(dictionary_occurrences)`);
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('deleted_at');
  });

  it('adds nullable replica_timestamps column to dictionary_occurrences for CRDT metadata', async () => {
    const columns = await db.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>(`PRAGMA table_info(dictionary_occurrences)`);
    const column = columns.find((c) => c.name === 'replica_timestamps');

    expect(column).toMatchObject({ type: 'TEXT', notnull: 0, dflt_value: 'NULL' });
  });

  it('creates occurrence indexes for entry, book, and recent listing access', async () => {
    const indexes = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'index'
         AND tbl_name = 'dictionary_occurrences'
         AND name LIKE 'idx_dictionary_occurrences_%'
       ORDER BY name`,
    );

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_dictionary_occurrences_book',
      'idx_dictionary_occurrences_created_at',
      'idx_dictionary_occurrences_entry',
    ]);
  });
});
