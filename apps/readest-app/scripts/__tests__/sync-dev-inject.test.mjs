#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteBook, updateBook } from '../sync-dev-inject.mjs';

function withTempLibrary(books, fn) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'biblioteca-delete-book-'));
  try {
    const booksDir = join(dataRoot, 'Readest', 'Books');
    mkdirSync(booksDir, { recursive: true });
    writeFileSync(join(booksDir, 'library.json'), JSON.stringify(books, null, 2), 'utf8');
    return fn({ dataRoot, libraryPath: join(booksDir, 'library.json') });
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

function readLibrary(libraryPath) {
  return JSON.parse(readFileSync(libraryPath, 'utf8'));
}

describe('deleteBook', () => {
  it('tombstones the matching book in desktop library.json instead of removing it', () => {
    withTempLibrary([
      { hash: 'book-a', title: 'A', downloadedAt: 1000, author: 'Author A' },
      { hash: 'book-b', title: 'B' },
    ], ({ dataRoot, libraryPath }) => {
      const result = deleteBook('book-a', { dataRoot });

      // Return value indicates tombstone
      assert.equal(result.ok, true);
      assert.equal(result.bookHash, 'book-a');
      assert.equal(result.action, 'tombstoned');

      // Book-a is still in the library
      const library = readLibrary(libraryPath);
      assert.equal(library.length, 2, 'should keep both entries');

      const tombstoned = library.find(b => b.hash === 'book-a');
      assert.ok(tombstoned, 'tombstoned book should still be present');
      assert.ok(typeof tombstoned.deletedAt === 'number', 'deletedAt should be a number');
      assert.ok(typeof tombstoned.updatedAt === 'number', 'updatedAt should be a number');
      assert.equal(tombstoned.downloadedAt, null, 'downloadedAt should be null');

      // Other fields preserved
      assert.equal(tombstoned.title, 'A');
      assert.equal(tombstoned.author, 'Author A');

      // Book-b is untouched
      assert.deepEqual(library.find(b => b.hash === 'book-b'), { hash: 'book-b', title: 'B' });
    });
  });

  it('returns not-found without modifying library.json when the book hash is missing', () => {
    withTempLibrary([{ hash: 'book-a', title: 'A' }], ({ dataRoot, libraryPath }) => {
      const result = deleteBook('missing-book', { dataRoot });

      assert.deepEqual(result, { ok: true, bookHash: 'missing-book', action: 'not-found' });
      assert.deepEqual(readLibrary(libraryPath), [{ hash: 'book-a', title: 'A' }]);
    });
  });

  it('preserves all other books when tombstoning one entry', () => {
    withTempLibrary([
      { hash: 'book-a', title: 'A' },
      { hash: 'book-b', title: 'B' },
      { hash: 'book-c', title: 'C' },
    ], ({ dataRoot, libraryPath }) => {
      deleteBook('book-b', { dataRoot });

      const library = readLibrary(libraryPath);
      assert.equal(library.length, 3, 'should still have 3 entries');

      const bookB = library.find(b => b.hash === 'book-b');
      assert.ok(typeof bookB.deletedAt === 'number', 'book-b should have deletedAt');
      assert.equal(bookB.deletedAt, bookB.updatedAt, 'deletedAt should equal updatedAt');
      assert.equal(bookB.downloadedAt, null, 'book-b downloadedAt should be null');

      // Non-tombstoned books untouched
      assert.equal(library.find(b => b.hash === 'book-a').title, 'A');
      assert.equal(library.find(b => b.hash === 'book-c').title, 'C');
    });
  });

  it('writes deletedAt, updatedAt timestamp and sets downloadedAt to null on matched book', () => {
    withTempLibrary([
      { hash: 'book-x', title: 'X', downloadedAt: 5000, author: 'Test' },
    ], ({ dataRoot, libraryPath }) => {
      const before = Date.now();
      const result = deleteBook('book-x', { dataRoot });
      const after = Date.now();

      assert.equal(result.action, 'tombstoned');

      const library = readLibrary(libraryPath);
      const book = library[0];

      // deletedAt and updatedAt should be reasonable timestamps
      assert.ok(book.deletedAt >= before && book.deletedAt <= after,
        'deletedAt should be current timestamp');
      assert.ok(book.updatedAt >= before && book.updatedAt <= after,
        'updatedAt should be current timestamp');
      assert.equal(book.downloadedAt, null, 'downloadedAt should be null');
      assert.equal(book.hash, 'book-x');
      assert.equal(book.title, 'X');
      assert.equal(book.author, 'Test');
    });
  });

  it('tombstones using bookHash field match as well as hash field', () => {
    // Some entries use bookHash instead of hash
    withTempLibrary([
      { bookHash: 'legacy-book', title: 'Legacy' },
    ], ({ dataRoot, libraryPath }) => {
      const result = deleteBook('legacy-book', { dataRoot });

      assert.equal(result.action, 'tombstoned');

      const library = readLibrary(libraryPath);
      assert.equal(library.length, 1, 'book should remain');
      assert.ok(typeof library[0].deletedAt === 'number');
      assert.equal(library[0].downloadedAt, null);
    });
  });

  it('updates deletedAt/updatedAt when tombstoning an already-tombstoned book', () => {
    withTempLibrary([
      { hash: 'book-a', title: 'Double Delete', deletedAt: 100, updatedAt: 100, downloadedAt: null },
    ], ({ dataRoot, libraryPath }) => {
      const result = deleteBook('book-a', { dataRoot });

      assert.equal(result.action, 'tombstoned');

      const library = readLibrary(libraryPath);
      const book = library[0];
      // Timestamps should be updated to new values
      assert.ok(book.deletedAt > 100, 'deletedAt should be updated');
      assert.ok(book.updatedAt > 100, 'updatedAt should be updated');
      assert.equal(book.downloadedAt, null);
      assert.equal(book.title, 'Double Delete');
    });
  });

  it('tombstones a book with minimal fields (only hash)', () => {
    withTempLibrary([
      { hash: 'minimal-book' },
    ], ({ dataRoot, libraryPath }) => {
      const result = deleteBook('minimal-book', { dataRoot });

      assert.equal(result.action, 'tombstoned');

      const library = readLibrary(libraryPath);
      assert.equal(library.length, 1);
      assert.ok(typeof library[0].deletedAt === 'number');
      assert.equal(library[0].downloadedAt, null);
      assert.equal(library[0].hash, 'minimal-book');
    });
  });

  it('throws when library.json is missing', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'biblioteca-delete-book-missing-'));
    try {
      assert.throws(
        () => deleteBook('book-a', { dataRoot }),
        /library\.json/,
      );
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws when library.json is malformed', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'biblioteca-delete-book-malformed-'));
    try {
      const booksDir = join(dataRoot, 'Readest', 'Books');
      mkdirSync(booksDir, { recursive: true });
      writeFileSync(join(booksDir, 'library.json'), '{not valid json', 'utf8');

      assert.throws(
        () => deleteBook('book-a', { dataRoot }),
        /JSON|Expected property name|Unexpected token/,
      );
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

describe('updateBook', () => {
  it('updates safe top-level and metadata fields in desktop library.json', () => {
    withTempLibrary([
      { hash: 'book-a', title: 'Old', metadata: { language: 'en' } },
      { hash: 'book-b', title: 'Other' },
    ], ({ dataRoot, libraryPath }) => {
      const result = updateBook('book-a', {
        title: 'New',
        author: 'Author',
        metadata: { publisher: 'Acme' },
      }, { dataRoot });

      assert.deepEqual(result, { ok: true, bookHash: 'book-a', action: 'updated' });
      assert.deepEqual(readLibrary(libraryPath), [
        { hash: 'book-a', title: 'New', author: 'Author', metadata: { language: 'en', publisher: 'Acme' } },
        { hash: 'book-b', title: 'Other' },
      ]);
    });
  });

  it('returns not-found for missing books', () => {
    withTempLibrary([{ hash: 'book-a', title: 'A' }], ({ dataRoot, libraryPath }) => {
      const result = updateBook('missing-book', { title: 'Nope' }, { dataRoot });

      assert.deepEqual(result, { ok: true, bookHash: 'missing-book', action: 'not-found' });
      assert.deepEqual(readLibrary(libraryPath), [{ hash: 'book-a', title: 'A' }]);
    });
  });
});
