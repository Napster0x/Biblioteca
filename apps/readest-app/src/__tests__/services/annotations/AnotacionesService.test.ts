import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { AnotacionesService } from '@/services/annotations/AnotacionesService';
import type { Annotacion } from '@/types/annotaciones';
import type { DatabaseService } from '@/types/database';

describe('AnotacionesService', () => {
  let db: DatabaseService;
  let service: AnotacionesService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('annotaciones'));
    let idCounter = 0;
    service = new AnotacionesService(db, {
      now: () => 1700000000000,
      createId: () => `annot-${++idCounter}`,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it('opens with AnotacionesService.open and returns a usable service', async () => {
    const opened = await AnotacionesService.open({
      openDatabase: async () => db,
    } as never);
    const annotations = await opened.listAnnotations();
    expect(annotations).toEqual([]);
    await opened.close();
  });

  it('returns an empty list when no annotations exist', async () => {
    const annotations = await service.listAnnotations();
    expect(annotations).toEqual([]);
  });

  it('creates an annotation and returns it with auto-generated id and timestamp', async () => {
    const input = {
      bookHash: 'book-1',
      bookTitle: 'Ficciones',
      bookAuthor: 'Borges',
      cfi: '/6/2',
      sectionHref: 'cap1.xhtml',
      page: 42,
      text: 'El Aleph',
      note: 'Mi nota favorita',
      style: 'highlight' as const,
      color: 'yellow' as const,
    };

    const created = await service.createAnnotation(input);

    expect(created.id).toBe('annot-1');
    expect(created.createdAt).toBe(1700000000000);
    expect(created.updatedAt).toBeNull();
    expect(created.bookHash).toBe('book-1');
    expect(created.text).toBe('El Aleph');
    expect(created.note).toBe('Mi nota favorita');
    expect(created.style).toBe('highlight');
    expect(created.color).toBe('yellow');

    const all = await service.listAnnotations();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: 'annot-1',
      bookHash: 'book-1',
      text: 'El Aleph',
    });
  });

  it('creates an annotation with default style and color when omitted', async () => {
    const created = await service.createAnnotation({
      bookHash: 'book-2',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'defaults test',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    expect(created.style).toBe('highlight');
    expect(created.color).toBe('yellow');
  });

  it('lists annotations in reverse chronological order', async () => {
    const serviceWithClock = new AnotacionesService(db, {
      now: () => 1000,
      createId: () => 'annot-1',
    });
    await serviceWithClock.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'first',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    serviceWithClock.setNow(() => 2000);
    const svc2 = new AnotacionesService(db, {
      now: () => 2000,
      createId: () => 'annot-2',
    });
    await svc2.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'second',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    const all = await service.listAnnotations();
    expect(all).toHaveLength(2);
    // Latest first
    expect(all[0]?.text).toBe('second');
    expect(all[1]?.text).toBe('first');
  });

  it('searches annotations by text, note, book title, and book author using LIKE', async () => {
    await service.createAnnotation({
      bookHash: 'b1',
      bookTitle: 'Don Quijote',
      bookAuthor: 'Miguel de Cervantes',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'En un lugar de La Mancha',
      note: 'nota sobre Cervantes',
      style: 'highlight',
      color: 'yellow',
    });
    await service.createAnnotation({
      bookHash: 'b2',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'El sur',
      note: 'otra nota',
      style: 'highlight',
      color: 'blue',
    });

    // Search matching text
    const byText = await service.searchAnnotations('mancha');
    expect(byText).toHaveLength(1);
    expect(byText[0]?.text).toBe('En un lugar de La Mancha');

    // Search matching note
    const byNote = await service.searchAnnotations('Cervantes');
    expect(byNote).toHaveLength(1);
    expect(byNote[0]?.note).toBe('nota sobre Cervantes');

    const byTitle = await service.searchAnnotations('quijote');
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]?.bookTitle).toBe('Don Quijote');

    const byAuthor = await service.searchAnnotations('miguel');
    expect(byAuthor).toHaveLength(1);
    expect(byAuthor[0]?.bookAuthor).toBe('Miguel de Cervantes');

    // No match
    const noMatch = await service.searchAnnotations('xyzzy');
    expect(noMatch).toEqual([]);
  });

  it('deleteAnnotations removes the listed ids and leaves the rest intact', async () => {
    const a = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'a',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const b = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'b',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const c = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'c',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    await service.deleteAnnotations([a.id, c.id]);

    const remaining = await service.listAllAnnotations();
    expect(remaining).toHaveLength(3);
    const deletedA = remaining.find((x) => x.id === a.id);
    expect(deletedA?.deletedAt).toBe(1700000000000);
    const deletedC = remaining.find((x) => x.id === c.id);
    expect(deletedC?.deletedAt).toBe(1700000000000);
    const kept = remaining.find((x) => x.id === b.id);
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('deleteAnnotations is a no-op when the list is empty', async () => {
    await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'keep me',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    await service.deleteAnnotations([]);

    const all = await service.listAnnotations();
    expect(all).toHaveLength(1);
  });

  it('deleteAnnotationsByBook deletes only annotations matching the given bookHash', async () => {
    const a = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'from book-1',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const b = await service.createAnnotation({
      bookHash: 'book-2',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'from book-2',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const c = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'also from book-1',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    const deletedIds = await service.deleteAnnotationsByBook('book-1');

    expect(deletedIds).toEqual([a.id, c.id]);
    const all = await service.listAllAnnotations();
    expect(all).toHaveLength(3);
    const deletedA = all.find((x) => x.id === a.id);
    expect(deletedA?.deletedAt).toBe(1700000000000);
    const deletedC = all.find((x) => x.id === c.id);
    expect(deletedC?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === b.id);
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('deleteAnnotationsByBook returns empty array when bookHash has no matches', async () => {
    await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'only quote',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    const deletedIds = await service.deleteAnnotationsByBook('book-unknown');
    expect(deletedIds).toEqual([]);

    const all = await service.listAnnotations();
    expect(all).toHaveLength(1);
  });

  it('deleteAnnotations soft-deletes: listAnnotations includes deleted rows for tombstone sync', async () => {
    const a = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'to delete',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    await service.deleteAnnotations([a.id]);

    // D4: listAnnotations includes soft-deleted rows for tombstone consistency
    const all = await service.listAnnotations();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(a.id);
    expect(all[0]?.deletedAt).toBe(1700000000000);

    // Row still exists in the table with deleted_at set
    const rows = await db.select<{ id: string; deleted_at: number | null }>(
      'SELECT id, deleted_at FROM annotations',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(a.id);
    expect(rows[0]?.deleted_at).toBe(1700000000000);
  });

  it('deleteAnnotationsByBook soft-deletes: row still exists with deleted_at', async () => {
    const a = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'from book-1',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    const deletedIds = await service.deleteAnnotationsByBook('book-1');

    expect(deletedIds).toEqual([a.id]);

    // Row still exists but soft-deleted
    const rows = await db.select<{ deleted_at: number | null }>(
      'SELECT deleted_at FROM annotations WHERE id = ?',
      [a.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).toBe(1700000000000);
  });

  it('listAllAnnotations returns all rows including soft-deleted', async () => {
    const a = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'will be deleted',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const b = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'keep me',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    await service.deleteAnnotations([a.id]);

    const all = await service.listAllAnnotations();
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === a.id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === b.id);
    expect(kept).toBeDefined();
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('bulkUpsertAnnotations inserts new annotations', async () => {
    const annotations: Annotacion[] = [
      {
        id: 'bulk-1',
        bookHash: 'book-1',
        bookTitle: null,
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'bulk inserted',
        note: '',
        style: 'highlight',
        color: 'yellow',
        createdAt: 100,
        updatedAt: null,
      },
    ];

    await service.bulkUpsertAnnotations(annotations);

    const all = await service.listAnnotations();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('bulk-1');
    expect(all[0]?.text).toBe('bulk inserted');
  });

  it('bulkUpsertAnnotations persists and reloads per-field replica timestamps', async () => {
    const timestamps = {
      text: '1700000001000-0001-device-a',
      note: '1700000001000-0002-device-a',
    };

    await service.bulkUpsertAnnotations([
      {
        id: 'bulk-replica-1',
        bookHash: 'book-1',
        bookTitle: null,
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'with timestamps',
        note: 'crdt metadata',
        style: 'highlight',
        color: 'yellow',
        createdAt: 100,
        updatedAt: null,
        _replicaTimestamps: timestamps,
      },
    ]);

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM annotations WHERE id = ?',
      ['bulk-replica-1'],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const reloaded = await service.getAnnotation('bulk-replica-1');
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('maps NULL and invalid annotation replica_timestamps to an empty object', async () => {
    await db.execute(
      `INSERT INTO annotations
       (id, book_hash, text, note, style, color, created_at, replica_timestamps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['annot-null-replica', 'book-1', 'null timestamps', '', 'highlight', 'yellow', 1, null],
    );
    await db.execute(
      `INSERT INTO annotations
       (id, book_hash, text, note, style, color, created_at, replica_timestamps)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'annot-invalid-replica',
        'book-1',
        'invalid timestamps',
        '',
        'highlight',
        'yellow',
        2,
        '{not-json',
      ],
    );

    await expect(service.getAnnotation('annot-invalid-replica')).resolves.toMatchObject({
      id: 'annot-invalid-replica',
      _replicaTimestamps: {},
    });
    await expect(service.getAnnotation('annot-null-replica')).resolves.toMatchObject({
      id: 'annot-null-replica',
      _replicaTimestamps: {},
    });
  });

  it('createAnnotation persists replica_timestamps through to SQLite', async () => {
    const timestamps = {
      text: '1700000001000-0001-device-a',
      note: '1700000001000-0002-device-a',
    };

    await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'with timestamps',
      note: 'crdt metadata',
      style: 'highlight',
      color: 'yellow',
      _replicaTimestamps: timestamps,
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM annotations WHERE id = ?',
      ['annot-1'],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const reloaded = await service.getAnnotation('annot-1');
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('createAnnotation stores null replica_timestamps when none provided', async () => {
    await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'no timestamps',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM annotations WHERE id = ?',
      ['annot-1'],
    );
    expect(rows).toEqual([{ replica_timestamps: null }]);

    const reloaded = await service.getAnnotation('annot-1');
    expect(reloaded?._replicaTimestamps).toEqual({});
  });

  it('updateAnnotation persists replica_timestamps through to SQLite', async () => {
    const created = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'original',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    const timestamps = {
      note: '1700000002000-0001-device-a',
      text: '1700000002000-0002-device-a',
    };

    await service.updateAnnotation({
      id: created.id,
      note: 'updated note',
      _replicaTimestamps: timestamps,
    });

    const rows = await db.select<{ replica_timestamps: string | null }>(
      'SELECT replica_timestamps FROM annotations WHERE id = ?',
      [created.id],
    );
    expect(rows).toEqual([{ replica_timestamps: JSON.stringify(timestamps) }]);

    const reloaded = await service.getAnnotation(created.id);
    expect(reloaded?._replicaTimestamps).toEqual(timestamps);
  });

  it('maps missing annotation replica_timestamps to an empty object', async () => {
    const dbWithoutColumn: DatabaseService = {
      select: async <T extends Record<string, unknown>>(): Promise<T[]> => [
        {
          id: 'annot-missing-replica',
          book_hash: 'book-1',
          book_title: null,
          book_author: null,
          cfi: null,
          section_href: null,
          page: null,
          text: 'missing timestamp column',
          note: '',
          style: 'highlight',
          color: 'yellow',
          created_at: 1,
          updated_at: null,
          deleted_at: null,
        } as unknown as T,
      ],
      execute: async () => ({ rowsAffected: 0, lastInsertId: 0 }),
      batch: async () => undefined,
      close: async () => undefined,
    };

    const [annotation] = await new AnotacionesService(dbWithoutColumn).listAllAnnotations();

    expect(annotation?._replicaTimestamps).toEqual({});
  });

  it('bulkUpsertAnnotations updates existing annotations including deletedAt', async () => {
    const created = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'original',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    // Upsert with updated text and deletedAt
    await service.bulkUpsertAnnotations([
      {
        ...created,
        text: 'updated via upsert',
        deletedAt: 200,
      },
    ]);

    // D4: listAnnotations includes deleted rows for tombstone sync
    const all = await service.listAnnotations();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe('updated via upsert');
    expect(all[0]?.deletedAt).toBe(200);

    // listAllAnnotations also shows it
    const allRows = await service.listAllAnnotations();
    expect(allRows).toHaveLength(1);
    expect(allRows[0]?.text).toBe('updated via upsert');
    expect(allRows[0]?.deletedAt).toBe(200);
  });

  it('serializes concurrent public calls that touch the database', async () => {
    const events: string[] = [];
    const gate = createGate();
    const guardedDb = createOverlapRejectingDb(events, gate.promise);
    const guardedService = new AnotacionesService(guardedDb);

    const listPromise = guardedService.listAnnotations();
    await Promise.resolve();
    const upsertPromise = guardedService.bulkUpsertAnnotations([
      {
        id: 'bulk-serial',
        bookHash: 'book-1',
        bookTitle: null,
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'serialized',
        note: '',
        style: 'highlight',
        color: 'yellow',
        createdAt: 1,
        updatedAt: null,
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
    const recoveringService = new AnotacionesService(recoveringDb);

    await expect(recoveringService.listAnnotations()).rejects.toThrow('read failed');
    await expect(recoveringService.deleteAnnotations(['annot-1'])).resolves.toBeUndefined();

    expect(events).toEqual(['select:fail', 'execute:success']);
  });

  it('close call is forwarded to the database', async () => {
    const closeSpy = vi.spyOn(db, 'close');
    await service.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  // ---------------------------------------------------------------------------
  // D4: Tombstone consistency — listAnnotations includes soft-deleted rows
  // ---------------------------------------------------------------------------

  it('listAnnotations includes soft-deleted annotations for tombstone consistency', async () => {
    const a = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'active annotation',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const b = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'to be deleted',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });

    await service.deleteAnnotations([b.id]);

    // listAnnotations MUST include soft-deleted rows for tombstone sync
    const all = await service.listAnnotations();
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === b.id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === a.id);
    expect(kept).toBeDefined();
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('searchAnnotations excludes soft-deleted annotations', async () => {
    await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'visible note',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    const b = await service.createAnnotation({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'deleted note',
      note: '',
      style: 'highlight',
      color: 'yellow',
    });
    await service.deleteAnnotations([b.id]);

    const results = await service.searchAnnotations('note');
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe('visible note');
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
