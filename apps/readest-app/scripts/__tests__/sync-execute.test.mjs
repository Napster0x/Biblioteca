#!/usr/bin/env node

/**
 * Test: pushBookAssets pushes EPUB, cover.png, and config.json to transport.
 *
 * Verifies that after transport.pushBookLibrary([book]), the asset push loop:
 * 1. Pushes the EPUB file (book.fileName) as 'book' asset
 * 2. Pushes cover.png if it exists (optional)
 * 3. Pushes config.json if it exists (optional)
 * 4. Skips missing optional assets gracefully
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the function we'll add to sync-execute.mjs
import { pushBookAssets } from '../sync-execute.mjs';

function createTempBook(hash, fileName, assets = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-execute-test-'));
  const booksDir = join(dir, 'Books');
  const bookDir = join(booksDir, hash);
  mkdirSync(bookDir, { recursive: true });

  // Write the EPUB file (the fileName)
  writeFileSync(join(bookDir, fileName), 'fake-epub-content');

  // Write optional assets
  if (assets.cover) writeFileSync(join(bookDir, 'cover.png'), assets.cover);
  if (assets.config) writeFileSync(join(bookDir, 'config.json'), assets.config);

  return { root: dir, booksDir };
}

describe('pushBookAssets', () => {
  it('should push EPUB, cover.png, and config.json when all exist', async () => {
    const hash = 'testhash123';
    const fileName = 'mybook.epub';
    const { root, booksDir } = createTempBook(hash, fileName, {
      cover: 'fake-cover-png',
      config: JSON.stringify({ lastRead: 123 }),
    });

    const pushed = [];
    const transport = {
      async pushBookAsset(h, name, bytes) {
        pushed.push({ hash: h, name, size: bytes.byteLength || bytes.length });
        return {};
      },
    };

    const book = { hash, title: 'Test Book', fileName };

    await pushBookAssets(transport, book, booksDir);

    assert.equal(pushed.length, 3, 'should push 3 assets');

    const bookPush = pushed.find(p => p.name === 'book');
    assert.ok(bookPush, 'should push book asset');
    assert.equal(bookPush.hash, hash);
    assert.equal(bookPush.size, 17); // 'fake-epub-content'.length

    const coverPush = pushed.find(p => p.name === 'cover.png');
    assert.ok(coverPush, 'should push cover.png');
    assert.equal(coverPush.size, 14); // 'fake-cover-png'.length

    const configPush = pushed.find(p => p.name === 'config.json');
    assert.ok(configPush, 'should push config.json');
  });

  it('should skip missing cover.png and config.json gracefully', async () => {
    const hash = 'testhash456';
    const fileName = 'naked.epub';
    const { root, booksDir } = createTempBook(hash, fileName); // no cover, no config

    const pushed = [];
    const transport = {
      async pushBookAsset(h, name, bytes) {
        pushed.push({ hash: h, name, size: bytes.byteLength || bytes.length });
        return {};
      },
    };

    const book = { hash, title: 'Naked Book', fileName };

    await pushBookAssets(transport, book, booksDir);

    // Only the EPUB should have been pushed
    assert.equal(pushed.length, 1, 'should push only the book EPUB when optional assets missing');
    assert.equal(pushed[0].name, 'book');
    assert.equal(pushed[0].hash, hash);
  });

  it('should push with only config (no cover)', async () => {
    const hash = 'testhash789';
    const fileName = 'config-only.epub';
    const { root, booksDir } = createTempBook(hash, fileName, {
      config: JSON.stringify({ lastRead: 456 }),
    });

    const pushed = [];
    const transport = {
      async pushBookAsset(h, name, bytes) {
        pushed.push({ hash: h, name, size: bytes.byteLength || bytes.length });
        return {};
      },
    };

    const book = { hash, title: 'Config Only', fileName };

    await pushBookAssets(transport, book, booksDir);

    assert.equal(pushed.length, 2, 'should push book + config.json');
    assert.ok(pushed.find(p => p.name === 'book'));
    assert.ok(pushed.find(p => p.name === 'config.json'));
    assert.equal(pushed.find(p => p.name === 'cover.png'), undefined);
  });
});
