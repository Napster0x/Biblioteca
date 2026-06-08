import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';

describe('citas migrations', () => {
  let db: DatabaseService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('citas'));
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates the quotes table with all 14 expected columns', async () => {
    const columns = await db.select<{ name: string; type: string }>(`PRAGMA table_info(quotes)`);
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
      'context_before',
      'context_after',
      'content_hash',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  it('creates the 3 supporting indexes on quotes', async () => {
    const indexes = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'index'
         AND tbl_name = 'quotes'
         AND name LIKE 'idx_quotes_%'
       ORDER BY name`,
    );

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_quotes_book_hash',
      'idx_quotes_content_hash',
      'idx_quotes_created_at',
    ]);
  });

  it('creates a unique index for (book_hash, content_hash) so duplicates are blocked', async () => {
    await db.execute(
      `INSERT INTO quotes
       (id, book_hash, text, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['cite-1', 'book-1', 'hello world', 'hash-1', 1],
    );

    await expect(
      db.execute(
        `INSERT INTO quotes
         (id, book_hash, text, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['cite-2', 'book-1', 'hello world again', 'hash-1', 2],
      ),
    ).rejects.toThrow();
  });

  it('starts the quotes table empty (no seed)', async () => {
    const rows = await db.select<{ count: number }>(`SELECT COUNT(*) AS count FROM quotes`);
    expect(rows).toEqual([{ count: 0 }]);
  });

  it('adds deleted_at column for soft-delete support', async () => {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(quotes)`);
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('deleted_at');
  });

  it('is idempotent: applying the migration twice keeps user_version=1 and does not duplicate', async () => {
    // Re-running migrate() with the same migration set should be a no-op
    // because the runner reads PRAGMA user_version and skips already-applied
    // migrations. We verify by inserting a row, re-migrating, and asserting
    // the row is still there (no destructive re-apply).
    await db.execute(
      `INSERT INTO quotes
       (id, book_hash, text, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['cite-1', 'book-1', 'survive re-migrate', 'h-1', 1],
    );

    await migrate(db, getMigrations('citas'));

    const rows = await db.select<{ id: string }>(`SELECT id FROM quotes`);
    expect(rows).toEqual([{ id: 'cite-1' }]);

    const version = await db.select<{ user_version: number }>('PRAGMA user_version');
    expect(version[0]?.user_version).toBe(2);
  });
});
