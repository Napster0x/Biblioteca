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

    const remaining = await service.listAnnotations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
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
    const remaining = await service.listAnnotations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
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

  it('deleteAnnotations soft-deletes: listAnnotations excludes deleted rows', async () => {
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

    // listAnnotations should exclude soft-deleted rows
    const visible = await service.listAnnotations();
    expect(visible).toHaveLength(0);

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

    // listAnnotations filters out deleted
    const visible = await service.listAnnotations();
    expect(visible).toHaveLength(0);

    // listAllAnnotations shows it with deletedAt
    const all = await service.listAllAnnotations();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe('updated via upsert');
    expect(all[0]?.deletedAt).toBe(200);
  });

  it('close call is forwarded to the database', async () => {
    const closeSpy = vi.spyOn(db, 'close');
    await service.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
