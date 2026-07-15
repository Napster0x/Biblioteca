#!/usr/bin/env node

/**
 * Tests for prepare-engine.mjs EPUB import and tombstone resurrection behavior.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { computePartialMd5Node, createEpubImportDescriptor, importEpubToLibrary } from '../prepare-engine.mjs';

function makeTempLibrary() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'prepare-engine-test-'));
  const booksDir = join(dataRoot, 'Readest', 'Books');
  mkdirSync(booksDir, { recursive: true });
  return { dataRoot, booksDir, libraryPath: join(booksDir, 'library.json') };
}

function makeEpub(contents = 'fake epub content') {
  const dir = mkdtempSync(join(tmpdir(), 'prepare-engine-epub-'));
  const filePath = join(dir, 'fixture.epub');
  writeFileSync(filePath, contents);
  return filePath;
}

function readLibrary(libraryPath) {
  return JSON.parse(readFileSync(libraryPath, 'utf8'));
}

describe('importEpubToLibrary', () => {
  it('creates a reusable EPUB import descriptor without writing the desktop library', () => {
    const { libraryPath } = makeTempLibrary();
    const filePath = makeEpub('android descriptor import');
    const hash = computePartialMd5Node(filePath);

    const descriptor = createEpubImportDescriptor({
      filePath,
      title: 'Android Import',
      author: 'Harness',
      language: 'es',
      now: () => '2026-03-04T05:06:07.000Z',
    });

    expect(descriptor).toMatchObject({
      hash,
      fileName: 'fixture.epub',
      byteSize: 25,
      metadata: { title: 'Android Import', author: 'Harness', language: 'es' },
      entry: {
        hash,
        title: 'Android Import',
        author: 'Harness',
        fileName: 'fixture.epub',
        byteSize: 25,
        importedAt: '2026-03-04T05:06:07.000Z',
        updatedAt: '2026-03-04T05:06:07.000Z',
        language: 'es',
      },
    });
    expect(existsSync(libraryPath)).toBe(false);
  });

  it('defaults descriptor metadata from the EPUB when explicit title and author are omitted', () => {
    const filePath = makeEpub('android descriptor fallback');

    const descriptor = createEpubImportDescriptor({
      filePath,
      now: '2026-03-04T05:06:07.000Z',
    });

    expect(descriptor.metadata).toEqual({ title: 'fixture', author: 'Unknown' });
    expect(descriptor.entry.title).toBe('fixture');
    expect(descriptor.entry.author).toBe('Unknown');
  });

  it('resurrects a same-hash tombstoned book without creating a duplicate row', () => {
    const { dataRoot, booksDir, libraryPath } = makeTempLibrary();
    const filePath = makeEpub('same hash tombstone resurrection');
    const hash = computePartialMd5Node(filePath);
    const deletedAt = '2026-01-01T00:00:00.000Z';

    writeFileSync(libraryPath, JSON.stringify([
      {
        hash,
        title: 'Deleted title',
        author: 'Deleted author',
        fileName: 'old.epub',
        byteSize: 12,
        importedAt: '2025-12-31T00:00:00.000Z',
        updatedAt: '2025-12-31T00:00:00.000Z',
        deletedAt,
      },
    ], null, 2));

    const beforeImport = Date.now();
    const result = importEpubToLibrary({
      filePath,
      dataRoot,
      title: 'Live title',
      author: 'Live author',
      language: 'en',
    });

    expect(result.ok).toBe(true);
    expect(result.action).not.toBe('skipped');
    expect(result.book.hash).toBe(hash);
    expect(result.book.title).toBe('Live title');
    expect(result.book.author).toBe('Live author');
    expect(result.book.language).toBe('en');
    expect(result.book.deletedAt).toBeUndefined();
    expect(Date.parse(result.book.updatedAt)).toBeGreaterThanOrEqual(beforeImport);
    expect(result.book.updatedAt).toBe(result.book.importedAt);
    expect(existsSync(join(booksDir, hash, 'fixture.epub'))).toBe(true);

    const library = readLibrary(libraryPath);
    expect(library).toHaveLength(1);
    expect(library[0].hash).toBe(hash);
    expect(library[0].deletedAt).toBeUndefined();
    expect(library[0].title).toBe('Live title');
  });

  it('keeps same-hash live duplicate imports idempotent', () => {
    const { dataRoot, libraryPath } = makeTempLibrary();
    const filePath = makeEpub('same hash live duplicate');
    const hash = computePartialMd5Node(filePath);
    const existingBook = {
      hash,
      title: 'Existing live title',
      author: 'Existing live author',
      fileName: 'fixture.epub',
      byteSize: 24,
      importedAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    writeFileSync(libraryPath, JSON.stringify([existingBook], null, 2));

    const result = importEpubToLibrary({
      filePath,
      dataRoot,
      title: 'New title should not replace live duplicate',
      author: 'New author',
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe('skipped');
    expect(result.book).toEqual(existingBook);

    const library = readLibrary(libraryPath);
    expect(library).toEqual([existingBook]);
  });
});
