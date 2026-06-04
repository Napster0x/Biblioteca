import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';

describe('annotaciones migrations', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('annotaciones'));
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates the annotations table with all 13 expected columns', async () => {
    const columns = await db.select<{ name: string; type: string }>(
      `PRAGMA table_info(annotations)`,
    );
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toEqual([
      'id',
      'book_hash',
      'book_title',
      'book_author',
      'cfi',
      'section_href',
      'page',
      'text',
      'note',
      'style',
      'color',
      'created_at',
      'updated_at',
    ]);
  });

  it('creates the 2 supporting indexes on annotations', async () => {
    const indexes = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'index'
         AND tbl_name = 'annotations'
         AND name LIKE 'idx_annotations_%'
       ORDER BY name`,
    );

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_annotations_book_hash',
      'idx_annotations_created_at',
    ]);
  });

  it('starts the annotations table empty (no seed)', async () => {
    const rows = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM annotations`);
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('is idempotent: applying the migration twice does not duplicate', async () => {
    await db.execute(
      `INSERT INTO annotations
       (id, book_hash, text, created_at)
       VALUES (?, ?, ?, ?)`,
      ['annot-1', 'book-1', 'survive re-migrate', 1],
    );

    await migrate(db, getMigrations('annotaciones'));

    const rows = await db.select<{ id: string }>(`SELECT id FROM annotations`);
    expect(rows).toEqual([{ id: 'annot-1' }]);

    const version = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]?.user_version).toBe(1);
  });
});
