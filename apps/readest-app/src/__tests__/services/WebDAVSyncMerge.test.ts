import { describe, test, expect } from 'vitest';
import { mergeNotes, mergeByUpdatedAt } from '@/services/webdav/WebDAVSync';
import type { BookNote } from '@/types/book';
import type { Annotacion } from '@/types/annotaciones';
import type { Cite } from '@/types/citas';

// ---------------------------------------------------------------------------
// 2.1 — mergeByUpdatedAt generic (and mergeNotes approval tests)
// ---------------------------------------------------------------------------

describe('mergeNotes (approval — existing behavior preserved)', () => {
  const alice: BookNote = {
    id: 'n1',
    type: 'annotation',
    cfi: '/4/2',
    note: 'alice version',
    createdAt: 100,
    updatedAt: 100,
  };
  const bob: BookNote = {
    id: 'n1',
    type: 'annotation',
    cfi: '/4/2',
    note: 'bob version',
    createdAt: 100,
    updatedAt: 200,
  };

  test('remote with higher updatedAt wins', () => {
    const merged = mergeNotes([alice], [bob]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.note).toBe('bob version');
  });

  test('local with higher updatedAt wins', () => {
    const merged = mergeNotes([bob], [alice]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.note).toBe('bob version');
  });

  test('remote deletedAt propagates deletion', () => {
    const deleted: BookNote = {
      ...alice,
      updatedAt: 150,
      deletedAt: 300,
    };
    const merged = mergeNotes([alice], [deleted]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe(300);
  });

  test('items unique to each side are both present', () => {
    const local = [{ ...alice, id: 'n1' }];
    const remote = [{ ...bob, id: 'n2', note: 'only remote' }];
    const merged = mergeNotes(local, remote);
    expect(merged).toHaveLength(2);
    const ids = merged.map((n) => n.id).sort();
    expect(ids).toEqual(['n1', 'n2']);
  });

  test('empty arrays produce empty result', () => {
    expect(mergeNotes([], [])).toEqual([]);
  });

  test('only local items -> all kept', () => {
    const merged = mergeNotes([alice, { ...alice, id: 'n2' }], []);
    expect(merged).toHaveLength(2);
  });

  test('only remote items -> all kept', () => {
    const merged = mergeNotes([], [bob, { ...bob, id: 'n2' }]);
    expect(merged).toHaveLength(2);
  });

  test('tied updatedAt defers to more recent deletedAt', () => {
    const local: BookNote = {
      ...alice,
      updatedAt: 100,
      deletedAt: null,
    };
    const remote: BookNote = {
      ...bob,
      id: 'n1',
      updatedAt: 100,
      deletedAt: 500,
    };
    const merged = mergeNotes([local], [remote]);
    expect(merged).toHaveLength(1);
    // remote has deletedAt=500 > local's 0 (null → 0), so remote wins
    expect(merged[0]!.deletedAt).toBe(500);
  });
});

describe('mergeByUpdatedAt generic', () => {
  interface TestItem {
    id: string;
    value: string;
    updatedAt?: number | null;
    deletedAt?: number | null;
  }

  const localA: TestItem = { id: 'a', value: 'local', updatedAt: 100 };
  const remoteA: TestItem = { id: 'a', value: 'remote', updatedAt: 200 };
  const localB: TestItem = { id: 'b', value: 'local-only', updatedAt: 50 };
  const remoteC: TestItem = { id: 'c', value: 'remote-only', updatedAt: 75 };

  test('remote with higher updatedAt wins for matching id', () => {
    const merged = mergeByUpdatedAt([localA], [remoteA]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe('remote');
  });

  test('local with higher updatedAt wins for matching id', () => {
    const merged = mergeByUpdatedAt([remoteA], [localA]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe('remote');
  });

  test('deletedAt propagates even when updatedAt is lower', () => {
    const deleted: TestItem = {
      id: 'a',
      value: 'deleted',
      updatedAt: 50,
      deletedAt: 999,
    };
    const merged = mergeByUpdatedAt([localA], [deleted]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe(999);
  });

  test('items unique to each side are all present', () => {
    const merged = mergeByUpdatedAt([localA, localB], [remoteC]);
    expect(merged).toHaveLength(3);
  });

  test('empty arrays produce empty result', () => {
    expect(mergeByUpdatedAt([], [])).toEqual([]);
  });

  test('only local -> all kept', () => {
    const merged = mergeByUpdatedAt([localA, localB], []);
    expect(merged).toHaveLength(2);
  });

  test('only remote -> all kept', () => {
    const merged = mergeByUpdatedAt([], [remoteA, remoteC]);
    expect(merged).toHaveLength(2);
  });

  test('tied updatedAt defers to more recent deletedAt', () => {
    const local: TestItem = { id: 'a', value: 'local', updatedAt: 100, deletedAt: null };
    const remote: TestItem = { id: 'a', value: 'remote', updatedAt: 100, deletedAt: 500 };
    const merged = mergeByUpdatedAt([local], [remote]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.deletedAt).toBe(500);
  });

  test('updatedAt null/undefined treated as 0', () => {
    const noDates: TestItem = { id: 'x', value: 'nodate' };
    const withUpdate: TestItem = { id: 'x', value: 'withdate', updatedAt: 1 };
    const merged = mergeByUpdatedAt([noDates], [withUpdate]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.value).toBe('withdate');
  });

  test('works with Annotacion-like objects', () => {
    const local: Annotacion = {
      id: 'ann-1',
      bookHash: 'abc',
      bookTitle: 'Test',
      bookAuthor: null,
      cfi: '/4/2',
      sectionHref: null,
      page: null,
      text: 'local text',
      note: '',
      style: 'highlight',
      color: 'yellow',
      createdAt: 10,
      updatedAt: 100,
    };
    const remote: Annotacion = {
      ...local,
      text: 'remote text',
      updatedAt: 200,
    };
    const merged = mergeByUpdatedAt([local], [remote]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe('remote text');
  });

  test('works with Cite-like objects', () => {
    const local: Cite = {
      id: 'cite-1',
      bookHash: 'abc',
      bookTitle: 'Test',
      bookAuthor: null,
      cfi: '/4/2',
      sectionHref: null,
      page: null,
      text: 'local quote',
      contextBefore: null,
      contextAfter: null,
      contentHash: 'abcdef',
      createdAt: 10,
      updatedAt: 100,
    };
    const remote: Cite = {
      ...local,
      text: 'remote quote',
      updatedAt: 200,
    };
    const merged = mergeByUpdatedAt([local], [remote]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.text).toBe('remote quote');
  });
});
