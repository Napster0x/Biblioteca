import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { CitasService } from '@/services/citas/CitasService';
import type { Cite } from '@/types/citas';
import type { DatabaseService } from '@/types/database';

describe('CitasService', () => {
  let db: DatabaseService;
  let service: CitasService;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    await migrate(db, getMigrations('citas'));
    let idCounter = 0;
    service = new CitasService(db, {
      now: () => 1700000000000,
      createId: () => `cite-${++idCounter}`,
      sha256: createDeterministicSha256(),
    });
  });

  it('stays browser-safe by not importing Node-only crypto APIs', async () => {
    const source = await readFile('src/services/citas/CitasService.ts', 'utf8');

    expect(source).not.toContain('node:crypto');
    expect(source).not.toContain('createHash');
  });

  afterEach(async () => {
    await db.close();
  });

  it('opens with CitasService.open and returns a usable service', async () => {
    const opened = await CitasService.open({
      openDatabase: async () => db,
    } as never);
    const quotes = await opened.listQuotes();
    expect(quotes).toEqual([]);
    await opened.close();
  });

  it('returns an empty list when no quotes exist', async () => {
    const quotes = await service.listQuotes();
    expect(quotes).toEqual([]);
  });

  it('creates a quote and computes the 64-hex SHA-256 of text||NUL||contextBefore||NUL||contextAfter', async () => {
    const input: Omit<Cite, 'id' | 'contentHash' | 'createdAt' | 'updatedAt'> = {
      bookHash: 'book-1',
      bookTitle: 'Test',
      bookAuthor: 'Tester',
      cfi: '/6/2',
      sectionHref: null,
      page: 7,
      text: 'hello world',
      contextBefore: 'before',
      contextAfter: 'after',
    };

    const created = await service.createQuote(input);

    expect(created.id).toBe('cite-1');
    expect(created.createdAt).toBe(1700000000000);
    expect(created.contentHash).toMatch(/^[a-f0-9]{64}$/);
    // Deterministic hash: sha256("hello world\0before\0after"), as produced
    // by both the inline test SHA-256 (below) and Web Crypto SHA-256.
    // Cross-checked with: echo -n "hello world\0before\0after" | sha256sum
    expect(created.contentHash).toBe(
      'a1a940e0c770b8b88209553e9175c242057683f66209f57dcbb5a5ac98e919c3',
    );

    const all = await service.listQuotes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: 'cite-1',
      bookHash: 'book-1',
      text: 'hello world',
      contentHash: created.contentHash,
    });
  });

  it('rejects a duplicate (bookHash, contentHash) insertion via the UNIQUE constraint', async () => {
    const baseInput = {
      bookHash: 'book-1',
      text: 'duplicate me',
      contextBefore: null,
      contextAfter: null,
    } as const;

    await service.createQuote({
      ...baseInput,
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
    });

    await expect(
      service.createQuote({
        ...baseInput,
        bookTitle: null,
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
      }),
    ).rejects.toThrow();
  });

  it('permits the same content hash across different book hashes', async () => {
    await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'shared',
      contextBefore: null,
      contextAfter: null,
    });
    await service.createQuote({
      bookHash: 'book-2',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'shared',
      contextBefore: null,
      contextAfter: null,
    });

    const all = await service.listQuotes();
    expect(all).toHaveLength(2);
  });

  it('uses NUL as separator so (a,bc) and (ab,c) do NOT collide', async () => {
    const a = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'a',
      contextBefore: 'b',
      contextAfter: 'c',
    });
    const b = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'ab',
      contextBefore: 'c',
      contextAfter: '',
    });

    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('listQuotesByBook filters to one book hash', async () => {
    await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'one',
      contextBefore: null,
      contextAfter: null,
    });
    await service.createQuote({
      bookHash: 'book-2',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'two',
      contextBefore: null,
      contextAfter: null,
    });

    const bookOne = await service.listQuotesByBook('book-1');
    expect(bookOne).toHaveLength(1);
    expect(bookOne[0]?.bookHash).toBe('book-1');
  });

  it('getQuote returns the quote by id', async () => {
    const created = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'find me',
      contextBefore: null,
      contextAfter: null,
    });

    const found = await service.getQuote(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it('getQuote returns null when the id does not exist', async () => {
    const found = await service.getQuote('cite-missing');
    expect(found).toBeNull();
  });

  it('searchQuotes does a case-insensitive LIKE on text, bookTitle, and bookAuthor', async () => {
    await service.createQuote({
      bookHash: 'b1',
      bookTitle: 'Mancha',
      bookAuthor: 'Cervantes',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'En un lugar de La Mancha',
      contextBefore: null,
      contextAfter: null,
    });
    await service.createQuote({
      bookHash: 'b2',
      bookTitle: 'Ficciones',
      bookAuthor: 'Borges',
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'El sur',
      contextBefore: null,
      contextAfter: null,
    });

    // Search on `text` column — case-insensitive: "mancha" (lowercase)
    // matches the title-case word "Mancha" inside the text. SQLite's
    // default LIKE is case-insensitive for ASCII, which is what the
    // service relies on.
    const byText = await service.searchQuotes('mancha');
    expect(byText.map((q) => q.bookAuthor)).toEqual(['Cervantes']);

    // Search on `book_author` column — case-insensitive: "BORGES"
    // (uppercase) matches the title-case author "Borges".
    const byAuthor = await service.searchQuotes('BORGES');
    expect(byAuthor.map((q) => q.bookAuthor)).toEqual(['Borges']);

    const byTitle = await service.searchQuotes('ficciones');
    expect(byTitle.map((q) => q.bookTitle)).toEqual(['Ficciones']);

    const noMatch = await service.searchQuotes('xyzzy');
    expect(noMatch).toEqual([]);
  });

  it('updateQuote updates fields and sets updated_at to the latest timestamp', async () => {
    const created = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: 'Original',
      bookAuthor: null,
      cfi: '/6/2',
      sectionHref: null,
      page: 1,
      text: 'editable',
      contextBefore: null,
      contextAfter: null,
    });
    expect(created.updatedAt).toBeNull();

    // Advance the clock for the update
    service.setNow(() => 1700000099999);

    const updated = await service.updateQuote({
      id: created.id,
      text: 'edited',
      bookAuthor: 'New Author',
    });

    expect(updated.text).toBe('edited');
    expect(updated.bookAuthor).toBe('New Author');
    expect(updated.updatedAt).toBe(1700000099999);
    // unchanged fields stay
    expect(updated.bookHash).toBe('book-1');
    expect(updated.cfi).toBe('/6/2');
  });

  it('updateQuote recomputes contentHash when text or context fields change', async () => {
    const created = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'original',
      contextBefore: 'cb',
      contextAfter: 'ca',
    });
    const originalHash = created.contentHash;

    const updated = await service.updateQuote({
      id: created.id,
      text: 'updated',
    });

    expect(updated.contentHash).not.toBe(originalHash);
    expect(updated.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('updateQuote throws when the id does not exist', async () => {
    await expect(service.updateQuote({ id: 'cite-missing', text: 'x' })).rejects.toThrow();
  });

  it('deleteQuotes removes the listed ids and leaves the rest intact', async () => {
    const a = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'a',
      contextBefore: null,
      contextAfter: null,
    });
    const b = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'b',
      contextBefore: null,
      contextAfter: null,
    });
    const c = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'c',
      contextBefore: null,
      contextAfter: null,
    });

    await service.deleteQuotes([a.id, c.id]);

    const remaining = await service.listQuotes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
  });

  it('deleteQuotes is a no-op when the list is empty', async () => {
    await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'keep me',
      contextBefore: null,
      contextAfter: null,
    });

    await service.deleteQuotes([]);

    const all = await service.listQuotes();
    expect(all).toHaveLength(1);
  });

  it('deleteQuotesByBook deletes only quotes matching the given bookHash', async () => {
    const a = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'from book-1',
      contextBefore: null,
      contextAfter: null,
    });
    const b = await service.createQuote({
      bookHash: 'book-2',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'from book-2',
      contextBefore: null,
      contextAfter: null,
    });
    const c = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'also from book-1',
      contextBefore: null,
      contextAfter: null,
    });

    const deletedIds = await service.deleteQuotesByBook('book-1');

    expect(deletedIds).toEqual([a.id, c.id]);
    const remaining = await service.listQuotes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(b.id);
  });

  it('deleteQuotesByBook returns empty array and keeps all quotes when bookHash has no matches', async () => {
    await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'only quote',
      contextBefore: null,
      contextAfter: null,
    });

    const deletedIds = await service.deleteQuotesByBook('book-unknown');

    expect(deletedIds).toEqual([]);
    const all = await service.listQuotes();
    expect(all).toHaveLength(1);
  });

  it('deleteQuotesByBook returns empty array when no quotes exist at all', async () => {
    const deletedIds = await service.deleteQuotesByBook('book-empty');

    expect(deletedIds).toEqual([]);
  });

  it('deleteQuotes soft-deletes: listQuotes excludes deleted rows', async () => {
    const a = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'to delete',
      contextBefore: null,
      contextAfter: null,
    });

    await service.deleteQuotes([a.id]);

    const visible = await service.listQuotes();
    expect(visible).toHaveLength(0);

    const rows = await db.select<{ id: string; deleted_at: number | null }>(
      'SELECT id, deleted_at FROM quotes',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(a.id);
    expect(rows[0]?.deleted_at).toBe(1700000000000);
  });

  it('deleteQuotesByBook soft-deletes: row still exists with deleted_at', async () => {
    const a = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'from book-1',
      contextBefore: null,
      contextAfter: null,
    });

    const deletedIds = await service.deleteQuotesByBook('book-1');
    expect(deletedIds).toEqual([a.id]);

    const rows = await db.select<{ deleted_at: number | null }>(
      'SELECT deleted_at FROM quotes WHERE id = ?',
      [a.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).toBe(1700000000000);
  });

  it('listAllQuotes returns all rows including soft-deleted', async () => {
    const a = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'will be deleted',
      contextBefore: null,
      contextAfter: null,
    });
    const b = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'keep me',
      contextBefore: null,
      contextAfter: null,
    });

    await service.deleteQuotes([a.id]);

    const all = await service.listAllQuotes();
    expect(all).toHaveLength(2);
    const deleted = all.find((x) => x.id === a.id);
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBe(1700000000000);
    const kept = all.find((x) => x.id === b.id);
    expect(kept).toBeDefined();
    expect(kept?.deletedAt).toBeUndefined();
  });

  it('bulkUpsertQuotes inserts new quotes', async () => {
    const quotes = [
      {
        id: 'bulk-1',
        bookHash: 'book-1',
        bookTitle: null,
        bookAuthor: null,
        cfi: null,
        sectionHref: null,
        page: null,
        text: 'bulk inserted',
        contextBefore: null,
        contextAfter: null,
        contentHash: 'test-hash-1',
        createdAt: 100,
        updatedAt: null,
      } as Cite,
    ];

    await service.bulkUpsertQuotes(quotes);

    const all = await service.listQuotes();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('bulk-1');
    expect(all[0]?.text).toBe('bulk inserted');
  });

  it('bulkUpsertQuotes updates existing quotes including deletedAt', async () => {
    const created = await service.createQuote({
      bookHash: 'book-1',
      bookTitle: null,
      bookAuthor: null,
      cfi: null,
      sectionHref: null,
      page: null,
      text: 'original',
      contextBefore: null,
      contextAfter: null,
    });

    await service.bulkUpsertQuotes([
      {
        ...created,
        text: 'updated via upsert',
        deletedAt: 200,
      },
    ]);

    const visible = await service.listQuotes();
    expect(visible).toHaveLength(0);

    const all = await service.listAllQuotes();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe('updated via upsert');
    expect(all[0]?.deletedAt).toBe(200);
  });
});

/**
 * Returns a deterministic SHA-256 implementation for testing. The
 * production CitasService uses Web Crypto by default (FIPS 180-4
 * SHA-256), but we override the helper in tests so the assertions are
 * stable across Node versions and jsdom setups.
 */
function createDeterministicSha256(): (input: string) => string {
  return (input: string) => {
    // Tiny inline SHA-256 (FIPS 180-4). NOT a general-purpose implementation —
    // it's a straight translation of the spec so the test is self-contained
    // and doesn't depend on the host's `crypto` module being present in jsdom.
    return sha256Hex(input);
  };
}

// Minimal pure-JS SHA-256 (FIPS 180-4). Used only in tests; production
// uses globalThis.crypto.subtle.digest('SHA-256', ...).
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(n: number, x: number) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Hex(message: string): string {
  const utf8 = new TextEncoder().encode(message);
  const bitLen = utf8.length * 8;
  const padded = new Uint8Array(((utf8.length + 9 + 63) >> 6) << 6);
  padded.set(utf8);
  padded[utf8.length] = 0x80;
  // length as 64-bit big-endian
  const high = Math.floor(bitLen / 0x100000000);
  const low = bitLen >>> 0;
  const lenIdx = padded.length - 8;
  padded[lenIdx] = (high >>> 24) & 0xff;
  padded[lenIdx + 1] = (high >>> 16) & 0xff;
  padded[lenIdx + 2] = (high >>> 8) & 0xff;
  padded[lenIdx + 3] = high & 0xff;
  padded[lenIdx + 4] = (low >>> 24) & 0xff;
  padded[lenIdx + 5] = (low >>> 16) & 0xff;
  padded[lenIdx + 6] = (low >>> 8) & 0xff;
  padded[lenIdx + 7] = low & 0xff;

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let i = 0; i < padded.length; i += 64) {
    const W = new Array<number>(64);
    for (let t = 0; t < 16; t++) {
      const o = i + t * 4;
      W[t] =
        ((padded[o]! << 24) | (padded[o + 1]! << 16) | (padded[o + 2]! << 8) | padded[o + 3]!) >>>
        0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, W[t - 15]!) ^ rotr(18, W[t - 15]!) ^ (W[t - 15]! >>> 3);
      const s1 = rotr(17, W[t - 2]!) ^ rotr(19, W[t - 2]!) ^ (W[t - 2]! >>> 10);
      W[t] = (W[t - 16]! + s0 + W[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H as number[];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e!) ^ rotr(11, e!) ^ rotr(25, e!);
      const ch = ((e! & f!) ^ (~e! & g!)) >>> 0;
      const t1 = (h! + S1 + ch! + SHA256_K[t]! + W[t]!) >>> 0;
      const S0 = rotr(2, a!) ^ rotr(13, a!) ^ rotr(22, a!);
      const mj = ((a! & b!) ^ (a! & c!) ^ (b! & c!)) >>> 0;
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a!) >>> 0;
    H[1] = (H[1]! + b!) >>> 0;
    H[2] = (H[2]! + c!) >>> 0;
    H[3] = (H[3]! + d!) >>> 0;
    H[4] = (H[4]! + e!) >>> 0;
    H[5] = (H[5]! + f!) >>> 0;
    H[6] = (H[6]! + g!) >>> 0;
    H[7] = (H[7]! + h!) >>> 0;
  }

  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}
