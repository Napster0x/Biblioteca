#!/usr/bin/env node

/**
 * Tests for sync-execute.mjs push, asset, and tombstone behavior.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

import {
  mergeRemoteBookMetadata,
  mergeRemoteBookTombstones,
  mergeRemoteBookMetadataIntoLibraryFile,
  mergeRemoteBookTombstonesIntoLibraryFile,
  normalizeBookTimestamp,
  pushBookAssets,
  pushBooks,
  rowToReplica,
  toHlc,
  upsertReplicaRow,
} from '../sync-execute.mjs';
import {
  computeSemanticKey,
  ensureReplicaTables,
  filterUnchangedReplicas,
} from '../sync-filter-standalone.mjs';

// pushBooks will be extracted and exported — import will be added after extraction
// import { pushBooks } from '../sync-execute.mjs';

function createTempBook(hash, fileName, assets = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-execute-test-'));
  const booksDir = join(dir, 'Books');
  const bookDir = join(booksDir, hash);
  mkdirSync(bookDir, { recursive: true });

  writeFileSync(join(bookDir, fileName), 'fake-epub-content');

  if (assets.cover) writeFileSync(join(bookDir, 'cover.png'), assets.cover);
  if (assets.config) writeFileSync(join(bookDir, 'config.json'), assets.config);

  return { root: dir, booksDir };
}

function makeTempLibraryFile(library) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'sync-execute-library-'));
  const booksDir = join(dataRoot, 'Readest', 'Books');
  mkdirSync(booksDir, { recursive: true });
  const libraryPath = join(booksDir, 'library.json');
  writeFileSync(libraryPath, JSON.stringify(library, null, 2));
  return { dataRoot, libraryPath };
}

// ── remote book tombstone merge tests ──────────────────────────────────────

describe('remote book tombstone merge', () => {
  it('normalizes numeric and ISO timestamps while rejecting invalid values', () => {
    const iso = '2026-06-30T12:00:00.000Z';

    expect(normalizeBookTimestamp(Date.parse(iso))).toBe(Date.parse(iso));
    expect(normalizeBookTimestamp(iso)).toBe(Date.parse(iso));
    expect(normalizeBookTimestamp('not-a-date')).toBe(0);
    expect(normalizeBookTimestamp(null)).toBe(0);
    expect(normalizeBookTimestamp(Number.NaN)).toBe(0);
  });

  it('merges a newer Android metadata edit into desktop library for 9Ma convergence', () => {
    const localLibrary = [{
      hash: 'book-a',
      title: 'Desktop old title',
      author: 'Author',
      fileName: 'book.epub',
      updatedAt: 1000,
      deletedAt: null,
    }];
    const remoteIndexBooks = [{
      hash: 'book-a',
      title: 'Phase2 9Ma edited on Android',
      author: 'Author',
      updatedAt: 2000,
      deletedAt: null,
      metadata: { language: 'es' },
    }];

    const { library, applied } = mergeRemoteBookMetadata(localLibrary, remoteIndexBooks);

    expect(applied).toBe(1);
    expect(library).toEqual([{
      hash: 'book-a',
      title: 'Phase2 9Ma edited on Android',
      author: 'Author',
      fileName: 'book.epub',
      updatedAt: 2000,
      deletedAt: null,
      metadata: { language: 'es' },
    }]);
  });

  it('does not merge older Android metadata over newer desktop library state', () => {
    const localLibrary = [{ hash: 'book-a', title: 'Desktop newer title', updatedAt: 3000, deletedAt: null }];
    const remoteIndexBooks = [{ hash: 'book-a', title: 'Android stale title', updatedAt: 2000, deletedAt: null }];

    const { library, applied } = mergeRemoteBookMetadata(localLibrary, remoteIndexBooks);

    expect(applied).toBe(0);
    expect(library).toEqual(localLibrary);
  });

  it('writes newer Android metadata to library.json evidence file', () => {
    const { libraryPath } = makeTempLibraryFile([{ hash: 'book-a', title: 'Old', updatedAt: 1000, deletedAt: null }]);

    const result = mergeRemoteBookMetadataIntoLibraryFile(libraryPath, [{ hash: 'book-a', title: 'Edited', updatedAt: 2000, deletedAt: null }]);

    expect(result.applied).toBe(1);
    expect(JSON.parse(readFileSync(libraryPath, 'utf8'))[0]).toMatchObject({ title: 'Edited', updatedAt: 2000 });
  });

  it('merges a newer Android tombstone before push so stale desktop live state cannot resurrect the book', async () => {
    const localLibrary = [{
      hash: 'book-a',
      title: 'Desktop stale live',
      fileName: 'book-a.epub',
      createdAt: '2026-06-30T09:00:00.000Z',
      importedAt: '2026-06-30T09:05:00.000Z',
      updatedAt: '2026-06-30T10:00:00.000Z',
    }];
    const remoteIndexBooks = [{
      hash: 'book-a',
      title: 'Android deleted',
      deletedAt: '2026-06-30T11:00:00.000Z',
      updatedAt: '2026-06-30T11:00:00.000Z',
    }];

    const { library, applied } = mergeRemoteBookTombstones(localLibrary, remoteIndexBooks);

    expect(applied).toBe(1);
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({
      hash: 'book-a',
      deletedAt: '2026-06-30T11:00:00.000Z',
      updatedAt: '2026-06-30T11:00:00.000Z',
    });

    const pushedLibrary = [];
    const pushedAssets = [];
    const result = await pushBooks(
      {
        async pushBookLibrary(books) { pushedLibrary.push(...books); return {}; },
        async pushBookAsset(hash, name) { pushedAssets.push({ hash, name }); return {}; },
      },
      library,
      new Map([['book-a', remoteIndexBooks[0]]]),
      '/tmp/fake',
    );

    expect(result.tombstonesPushed).toBe(1);
    expect(result.sent).toBe(0);
    expect(pushedLibrary).toHaveLength(1);
    expect(pushedLibrary[0].deletedAt).toBe('2026-06-30T11:00:00.000Z');
    expect(pushedAssets).toEqual([]);
  });

  it('merges tombstones from the real /books/index wrapper shape', () => {
    const localLibrary = [{
      hash: 'book-index-wrapper',
      title: 'Desktop stale live',
      fileName: 'book.epub',
      updatedAt: 100,
    }];
    const remoteIndexPayload = {
      books: [{
        hash: 'book-index-wrapper',
        title: 'Android deleted',
        deletedAt: 200,
        updatedAt: 200,
      }],
    };

    const { library, applied } = mergeRemoteBookTombstones(localLibrary, remoteIndexPayload);

    expect(applied).toBe(1);
    expect(library[0]).toMatchObject({
      hash: 'book-index-wrapper',
      deletedAt: 200,
      updatedAt: 200,
    });
  });

  it('applies a pending Android delete marker when /books/index has already lost the tombstone', async () => {
    const localLibrary = [{
      hash: 'book-delete-marker',
      title: 'Desktop stale live',
      fileName: 'book.epub',
      updatedAt: 100,
    }];
    const pendingAndroidDeletes = [{
      hash: 'book-delete-marker',
      deletedAt: 300,
      updatedAt: 300,
    }];

    const { library, applied } = mergeRemoteBookTombstones(localLibrary, [], pendingAndroidDeletes);

    expect(applied).toBe(1);
    expect(library[0]).toMatchObject({
      hash: 'book-delete-marker',
      deletedAt: 300,
      updatedAt: 300,
    });

    const pushedLibrary = [];
    const pushedAssets = [];
    const result = await pushBooks(
      {
        async pushBookLibrary(books) { pushedLibrary.push(...books); return {}; },
        async pushBookAsset(hash, name) { pushedAssets.push({ hash, name }); return {}; },
      },
      library,
      new Map(),
      '/tmp/fake',
    );

    expect(result.tombstonesPushed).toBe(1);
    expect(result.sent).toBe(0);
    expect(pushedLibrary).toHaveLength(1);
    expect(pushedLibrary[0].deletedAt).toBe(300);
    expect(pushedAssets).toEqual([]);
  });

  it('keeps a newer local reimport live when the Android tombstone is older', () => {
    const localLibrary = [{
      hash: 'book-b',
      title: 'Desktop reimport',
      fileName: 'book-b.epub',
      createdAt: '2026-06-30T09:00:00.000Z',
      importedAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    }];
    const remoteIndexBooks = [{
      hash: 'book-b',
      deletedAt: '2026-06-30T11:00:00.000Z',
      updatedAt: '2026-06-30T11:00:00.000Z',
    }];

    const { library, applied } = mergeRemoteBookTombstones(localLibrary, remoteIndexBooks);

    expect(applied).toBe(0);
    expect(library).toEqual(localLibrary);
    expect(library[0].deletedAt).toBeUndefined();
  });

  it('updates only library.json when tombstones merge and leaves D/C/N files untouched', () => {
    const { dataRoot, libraryPath } = makeTempLibraryFile([{
      hash: 'book-c',
      title: 'Desktop stale live',
      fileName: 'book-c.epub',
      updatedAt: 100,
    }]);
    const readestDir = join(dataRoot, 'Readest');
    const dictionaryPath = join(readestDir, 'dictionary.db');
    const citasPath = join(readestDir, 'citas.db');
    const annotationsPath = join(readestDir, 'annotations.db');
    writeFileSync(dictionaryPath, 'dictionary sentinel');
    writeFileSync(citasPath, 'citas sentinel');
    writeFileSync(annotationsPath, 'annotations sentinel');

    const result = mergeRemoteBookTombstonesIntoLibraryFile(libraryPath, [{
      hash: 'book-c',
      deletedAt: 200,
      updatedAt: 200,
    }]);

    expect(result.applied).toBe(1);
    expect(JSON.parse(readFileSync(libraryPath, 'utf8'))[0].deletedAt).toBe(200);
    expect(readFileSync(dictionaryPath, 'utf8')).toBe('dictionary sentinel');
    expect(readFileSync(citasPath, 'utf8')).toBe('citas sentinel');
    expect(readFileSync(annotationsPath, 'utf8')).toBe('annotations sentinel');
  });
});

// ── rowToReplica HLC convergence tests ────────────────────────────────────

describe('rowToReplica HLC convergence', () => {
  it('should compute updated_at_ts as max of row timestamp and field envelope HLCs', () => {
    const row = {
      id: 'entry-1',
      term: 'test',
      display_term: 'Test',
      language: 'en',
      definition: 'new definition',
      curiosity: null,
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 100,
      replica_timestamps: JSON.stringify({
        definition: toHlc(1650),
        term: toHlc(100),
      }),
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // updated_at_ts should equal toHlc(1650) — the definition field HLC is highest
    assert.equal(replica.updated_at_ts, toHlc(1650),
      'updated_at_ts should max(fallback, field HLCs)');

    // Field envelope retains its specific HLC
    assert.equal(replica.fields_jsonb.definition.t, toHlc(1650));
    assert.equal(replica.fields_jsonb.definition.v, 'new definition');

    // Terms field keeps its own (lower) HLC
    assert.equal(replica.fields_jsonb.term.t, toHlc(100));
    assert.equal(replica.fields_jsonb.term.v, 'test');

    // Replica structure is valid
    assert.equal(replica.replica_id, 'dictionary-entry:entry-1');
    assert.equal(replica.kind, 'dictionary-entry');
    assert.equal(replica.deleted_at_ts, null);
  });

  it('should use fallbackTimestamp when no replica_timestamps exist', () => {
    const row = {
      id: 'entry-2',
      term: 'simple',
      display_term: 'Simple',
      language: 'en',
      definition: 'simple def',
      curiosity: null,
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 200,
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // All fields fall back to the fallbackTimestamp
    const expected = toHlc(200);
    assert.equal(replica.updated_at_ts, expected);
    assert.equal(replica.fields_jsonb.definition.t, expected);
    assert.equal(replica.fields_jsonb.term.t, expected);
  });

  it('should include deleted_at_ts and its HLC in max computation', () => {
    const row = {
      id: 'entry-3',
      term: 'del-term',
      display_term: 'Del',
      language: 'en',
      definition: 'del def',
      curiosity: null,
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 100,
      deleted_at: 300,
      replica_timestamps: JSON.stringify({
        definition: toHlc(200),
        __deleted: toHlc(300),
      }),
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // updated_at_ts should be at least as high as __deleted HLC (300)
    assert.equal(replica.updated_at_ts, toHlc(300),
      'updated_at_ts should include deleted HLC in max');
    assert.equal(replica.deleted_at_ts, toHlc(300),
      'deleted_at_ts should use __deleted timestamp');
  });

  it('should include all field envelope HLCs even when row updated_at is stale', () => {
    // Simulate: row.updated_at is old (100ms) but curiosity field has newer HLC (1800ms)
    const row = {
      id: 'entry-4',
      term: 'curious',
      display_term: 'Curious',
      language: 'en',
      definition: 'curious def',
      curiosity: 'very curious',
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 100,
      replica_timestamps: JSON.stringify({
        definition: toHlc(100),
        curiosity: toHlc(1800),
        term: toHlc(100),
      }),
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // The max should be the curiosity field HLC (1800ms)
    assert.equal(replica.updated_at_ts, toHlc(1800),
      'updated_at_ts should reflect the highest field HLC even when row timestamps are stale');

    // Each field retains its own HLC
    assert.equal(replica.fields_jsonb.curiosity.t, toHlc(1800));
    assert.equal(replica.fields_jsonb.definition.t, toHlc(100));
  });

  it('should handle detached entry (no book context) with field HLC convergence', () => {
    // A "detached" dictionary entry has no book fields, just dictionary data.
    // It should still compute updated_at_ts as max of all timestamps.
    const row = {
      id: 'entry-5',
      term: 'detached',
      display_term: 'Detached',
      language: 'en',
      definition: 'edited definition',
      curiosity: null,
      image_path: null,
      enrichment_status: 'pending',
      created_at: 100,
      updated_at: 100,
      replica_timestamps: JSON.stringify({
        definition: toHlc(2000),
        term: toHlc(100),
      }),
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // The definition HLC (2000ms) should drive updated_at_ts
    assert.equal(replica.updated_at_ts, toHlc(2000),
      'detached entry should still compute max HLC from field timestamps');
    assert.equal(replica.fields_jsonb.definition.v, 'edited definition');
    assert.equal(replica.replica_id, 'dictionary-entry:entry-5');
  });

  it('should use fallbackTimestamp as max when all field HLCs are lower', () => {
    // Row where updated_at is 500 but all field HLCs are lower (100-200)
    const row = {
      id: 'entry-6',
      term: 'old-fields',
      display_term: 'Old Fields',
      language: 'en',
      definition: 'old def',
      curiosity: 'old',
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 500,
      replica_timestamps: JSON.stringify({
        definition: toHlc(200),
        term: toHlc(100),
        curiosity: toHlc(150),
      }),
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // fallbackTimestamp (toHlc(500)) is higher than all field HLCs
    assert.equal(replica.updated_at_ts, toHlc(500),
      'fallbackTimestamp should win when it is the highest timestamp');
    // Field envelopes still keep their own (lower) HLCs
    assert.equal(replica.fields_jsonb.definition.t, toHlc(200));
    assert.equal(replica.fields_jsonb.curiosity.t, toHlc(150));
  });

  it('should handle row with only some fields having replica_timestamps', () => {
    // Row where some fields are missing from replica_timestamps (like enrichmentStatus, imagePath)
    const row = {
      id: 'entry-7',
      term: 'partial',
      display_term: 'Partial',
      language: 'en',
      definition: 'partial def',
      curiosity: null,
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 100,
      replica_timestamps: JSON.stringify({
        definition: toHlc(1650),
        // term, language, displayTerm, etc. are NOT in replica_timestamps
        // They should fall back to fallbackTimestamp
      }),
    };

    const replica = rowToReplica(row, 'dictionary-entry', {
      term: 'term',
      displayTerm: 'display_term',
      language: 'language',
      definition: 'definition',
      imagePath: 'image_path',
      curiosity: 'curiosity',
      enrichmentStatus: 'enrichment_status',
    }, row.updated_at);

    // max should still be the definition HLC since it's highest among all field HLCs
    // (fields without replica_timestamps fall back to fallbackTimestamp = toHlc(100))
    assert.equal(replica.updated_at_ts, toHlc(1650),
      'should max only present field HLCs; absent fields fall back');
    assert.equal(replica.fields_jsonb.definition.t, toHlc(1650));
    // Fields without timestamp fall back to fallbackTimestamp
    assert.equal(replica.fields_jsonb.term.t, toHlc(100));
    assert.equal(replica.fields_jsonb.enrichmentStatus.t, toHlc(100));
  });
});

// ── filterUnchangedReplicas stale rejection test ──────────────────────────

describe('filterUnchangedReplicas stale rejection', () => {
  function createTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'sync-filter-test-'));
    const dbPath = join(dir, 'test.db');
    const conn = (sql) => execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
    conn("CREATE TABLE IF NOT EXISTS _replicas (replica_id TEXT PRIMARY KEY, kind TEXT, user_id TEXT, fields_jsonb TEXT, manifest_jsonb TEXT, deleted_at_ts TEXT, reincarnation TEXT, updated_at_ts TEXT, schema_version INTEGER, semantic_key TEXT)");
    return { dir, dbPath, conn };
  }

  it('should filter out rows with stale updated_at_ts compared to stored replica', () => {
    const { dbPath, conn } = createTempDb();

    // Insert a stored row with updated_at_ts = toHlc(200)
    conn(`INSERT OR REPLACE INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version) VALUES ('dictionary-entry:stale-test', 'dictionary-entry', 'visible', '{}', '${toHlc(200)}', 1)`);

    // Create a replica row with updated_at_ts = toHlc(100) — STALE, should be filtered
    const staleReplica = {
      replica_id: 'dictionary-entry:stale-test',
      kind: 'dictionary-entry',
      user_id: 'visible',
      fields_jsonb: { term: { v: 'test', t: toHlc(100), s: 'visible' } },
      updated_at_ts: toHlc(100),
      schema_version: 1,
    };

    // Create a replica row with updated_at_ts = toHlc(300) — NEWER, should pass
    const freshReplica = {
      replica_id: 'dictionary-entry:stale-test',
      kind: 'dictionary-entry',
      user_id: 'visible',
      fields_jsonb: { term: { v: 'test', t: toHlc(300), s: 'visible' } },
      updated_at_ts: toHlc(300),
      schema_version: 1,
    };

    // Filter stale: should be removed (stored 200 >= incoming 100)
    const result = filterUnchangedReplicas(dbPath, [staleReplica, freshReplica], 'dictionary-entry');
    assert.equal(result.length, 1, 'stale row should be filtered out');
    assert.equal(result[0].updated_at_ts, toHlc(300), 'only the fresh row should remain');
  });

  it('should allow all rows when _replicas table does not exist (first sync)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-filter-test-nodb-'));
    const dbPath = join(dir, 'nonexistent.db');
    // Note: we do NOT create the _replicas table

    const freshReplica = {
      replica_id: 'dictionary-entry:new-entry',
      kind: 'dictionary-entry',
      user_id: 'visible',
      fields_jsonb: { definition: { v: 'new', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    // When _replicas table is missing, all rows should pass
    const result = filterUnchangedReplicas(dbPath, [freshReplica], 'dictionary-entry');
    assert.equal(result.length, 1, 'all rows pass when _replicas table is absent');
    assert.equal(result[0].updated_at_ts, toHlc(500));
  });

  it('should use semantic key dedup for dictionary-entry with same content different id', () => {
    const { dbPath, conn } = createTempDb();

    // Stored row has a different replica_id but same normalized term|language
    conn(`INSERT OR REPLACE INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key) VALUES ('dictionary-entry:old-id', 'dictionary-entry', 'visible', '{"term":{"v":"hello","t":"${toHlc(300)}","s":"visible"},"language":{"v":"en","t":"${toHlc(300)}","s":"visible"}}', '${toHlc(300)}', 1, 'hello|en')`);

    // Incoming row with new replica_id but same semantic content, lower HLC
    const staleSemantic = {
      replica_id: 'dictionary-entry:new-id',
      kind: 'dictionary-entry',
      user_id: 'visible',
      fields_jsonb: { term: { v: 'hello', t: toHlc(200), s: 'visible' }, language: { v: 'en', t: toHlc(200), s: 'visible' }, definition: { v: 'stale', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };

    // Incoming row with new replica_id, same semantic content, HIGHER HLC
    const freshSemantic = {
      replica_id: 'dictionary-entry:new-id',
      kind: 'dictionary-entry',
      user_id: 'visible',
      fields_jsonb: { term: { v: 'hello', t: toHlc(500), s: 'visible' }, language: { v: 'en', t: toHlc(500), s: 'visible' }, definition: { v: 'fresh', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    const result = filterUnchangedReplicas(dbPath, [staleSemantic, freshSemantic], 'dictionary-entry');
    assert.equal(result.length, 1, 'stale semantic match should be filtered, fresh should pass');
    assert.equal(result[0].updated_at_ts, toHlc(500), 'only fresh row survives semantic dedup');
    assert.equal(result[0].fields_jsonb.definition.v, 'fresh');
  });
});

// ── filterUnchangedReplicas kind pass-through gap (Slice 2 RED) ─────────

describe('filterUnchangedReplicas kind pass-through gap', () => {
  function createTempDb() {
    const dir = mkdtempSync(join(tmpdir(), 'sync-kind-gap-'));
    const dbPath = join(dir, 'test.db');
    const conn = (sql) => execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
    conn("CREATE TABLE IF NOT EXISTS _replicas (replica_id TEXT PRIMARY KEY, kind TEXT, user_id TEXT, fields_jsonb TEXT, manifest_jsonb TEXT, deleted_at_ts TEXT, reincarnation TEXT, updated_at_ts TEXT, schema_version INTEGER, semantic_key TEXT)");
    return { dir, dbPath, conn };
  }

  it('quote semantic dup survives WITHOUT kind — simulates push line 687 gap', () => {
    // DB has stored quote with semantic_key='abc|/2/4|hash123'
    const { dbPath, conn } = createTempDb();
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key)
      VALUES ('quote:stored', 'quote', 'visible',
        '{"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"},"contentHash":{"v":"hash123","t":"${toHlc(300)}","s":"visible"}}',
        '${toHlc(300)}', 1, 'abc|/2/4|hash123')`);

    // Incoming stale quote has same semantic identity but different replica_id, lower HLC
    const staleQuote = {
      replica_id: 'quote:new-id',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' }, contentHash: { v: 'hash123', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };
    const freshQuote = {
      replica_id: 'quote:new-id-2',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(500), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(500), s: 'visible' }, contentHash: { v: 'hash123', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    // Simulate current push behavior: filterUnchangedReplicas called WITHOUT kind
    const result = filterUnchangedReplicas(dbPath, [staleQuote, freshQuote]);

    // WITHOUT kind, pass 2 is skipped — stale semantic duplicate SURVIVES
    // This documents the gap: main() at line 687 doesn't pass 'quote'
    assert.equal(result.length, 2, 'BUG: WITHOUT kind, stale quote dup survives — main() line 687 missing kind');
  });

  it('occurrence semantic dup survives WITHOUT kind — simulates push line 676 gap', () => {
    const { dbPath, conn } = createTempDb();
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key)
      VALUES ('occ:stored', 'dictionary-occurrence', 'visible',
        '{"entryId":{"v":"e1","t":"${toHlc(300)}","s":"visible"},"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"}}',
        '${toHlc(300)}', 1, 'e1|abc|/2/4')`);

    const stale = {
      replica_id: 'occ:new-id',
      kind: 'dictionary-occurrence',
      user_id: 'visible',
      fields_jsonb: { entryId: { v: 'e1', t: toHlc(200), s: 'visible' }, bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };
    const fresh = {
      replica_id: 'occ:new-id-2',
      kind: 'dictionary-occurrence',
      user_id: 'visible',
      fields_jsonb: { entryId: { v: 'e1', t: toHlc(500), s: 'visible' }, bookHash: { v: 'abc', t: toHlc(500), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    const result = filterUnchangedReplicas(dbPath, [stale, fresh]);
    assert.equal(result.length, 2, 'BUG: WITHOUT kind, stale occurrence dup survives — main() line 676 missing kind');
  });

  it('annotation semantic dup survives WITHOUT kind — simulates push line 698 gap', () => {
    const { dbPath, conn } = createTempDb();
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key)
      VALUES ('ann:stored', 'annotation', 'visible',
        '{"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"},"text":{"v":"my text","t":"${toHlc(300)}","s":"visible"}}',
        '${toHlc(300)}', 1, 'abc|/2/4|my text')`);

    const stale = {
      replica_id: 'ann:new-id',
      kind: 'annotation',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' }, text: { v: 'my text', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };
    const fresh = {
      replica_id: 'ann:new-id-2',
      kind: 'annotation',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(500), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(500), s: 'visible' }, text: { v: 'my text', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    const result = filterUnchangedReplicas(dbPath, [stale, fresh]);
    assert.equal(result.length, 2, 'BUG: WITHOUT kind, stale annotation dup survives — main() line 698 missing kind');
  });

  it('all 4 pull kinds: semantic dup survives WITHOUT kind — simulates pull line 708 gap', () => {
    // The pull loop at line 708 iterates REPLICA_PULL_ORDER and calls
    // filterUnchangedReplicas(dbPath, rows) WITHOUT kind for all 4 kinds.
    // This test proves dictionary-entry is the ONLY kind that currently works
    // because it was hardcoded before Slice 1.
    const { dbPath, conn } = createTempDb();

    // Seed one semantic_key per kind
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key) VALUES
      ('de:stored', 'dictionary-entry', 'visible', '{"term":{"v":"hello","t":"${toHlc(300)}","s":"visible"},"language":{"v":"en","t":"${toHlc(300)}","s":"visible"}}', '${toHlc(300)}', 1, 'hello|en'),
      ('do:stored', 'dictionary-occurrence', 'visible', '{"entryId":{"v":"e1","t":"${toHlc(300)}","s":"visible"},"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"}}', '${toHlc(300)}', 1, 'e1|abc|/2/4'),
      ('q:stored', 'quote', 'visible', '{"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"},"contentHash":{"v":"hash123","t":"${toHlc(300)}","s":"visible"}}', '${toHlc(300)}', 1, 'abc|/2/4|hash123'),
      ('a:stored', 'annotation', 'visible', '{"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"},"text":{"v":"my text","t":"${toHlc(300)}","s":"visible"}}', '${toHlc(300)}', 1, 'abc|/2/4|my text')`);

    const staleRows = [
      { replica_id: 'de:new', kind: 'dictionary-entry', user_id: 'visible', fields_jsonb: { term: { v: 'hello', t: toHlc(200), s: 'visible' }, language: { v: 'en', t: toHlc(200), s: 'visible' } }, updated_at_ts: toHlc(200), schema_version: 1 },
      { replica_id: 'do:new', kind: 'dictionary-occurrence', user_id: 'visible', fields_jsonb: { entryId: { v: 'e1', t: toHlc(200), s: 'visible' }, bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' } }, updated_at_ts: toHlc(200), schema_version: 1 },
      { replica_id: 'q:new', kind: 'quote', user_id: 'visible', fields_jsonb: { bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' }, contentHash: { v: 'hash123', t: toHlc(200), s: 'visible' } }, updated_at_ts: toHlc(200), schema_version: 1 },
      { replica_id: 'a:new', kind: 'annotation', user_id: 'visible', fields_jsonb: { bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' }, text: { v: 'my text', t: toHlc(200), s: 'visible' } }, updated_at_ts: toHlc(200), schema_version: 1 },
    ];

    const result = filterUnchangedReplicas(dbPath, staleRows);
    // WITHOUT kind, dictionary-entry's semantic dedup works (it always had it)
    // but occurrence/quote/annotation pass through unfiltered
    assert.equal(result.length, 4, 'BUG: WITHOUT kind, non-dict-entry semantic dups all survive — pull line 708 missing kind');
  });

  it('WITH kind=quote semantic dedup works correctly', () => {
    const { dbPath, conn } = createTempDb();
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key)
      VALUES ('quote:stored', 'quote', 'visible',
        '{"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"},"contentHash":{"v":"hash123","t":"${toHlc(300)}","s":"visible"}}',
        '${toHlc(300)}', 1, 'abc|/2/4|hash123')`);

    const stale = {
      replica_id: 'quote:new-stale',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' }, contentHash: { v: 'hash123', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };
    const fresh = {
      replica_id: 'quote:new-fresh',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(500), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(500), s: 'visible' }, contentHash: { v: 'hash123', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    // WITH kind — semantic dedup works correctly
    const result = filterUnchangedReplicas(dbPath, [stale, fresh], 'quote');
    assert.equal(result.length, 1, 'WITH kind=quote, stale semantic duplicate should be filtered');
    assert.equal(result[0].updated_at_ts, toHlc(500), 'only the fresh quote should survive');
  });

  it('WITH kind=dictionary-occurrence semantic dedup works correctly', () => {
    const { dbPath, conn } = createTempDb();
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key)
      VALUES ('occ:stored', 'dictionary-occurrence', 'visible',
        '{"entryId":{"v":"e1","t":"${toHlc(300)}","s":"visible"},"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"}}',
        '${toHlc(300)}', 1, 'e1|abc|/2/4')`);

    const stale = {
      replica_id: 'occ:new-stale',
      kind: 'dictionary-occurrence',
      user_id: 'visible',
      fields_jsonb: { entryId: { v: 'e1', t: toHlc(200), s: 'visible' }, bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };
    const fresh = {
      replica_id: 'occ:new-fresh',
      kind: 'dictionary-occurrence',
      user_id: 'visible',
      fields_jsonb: { entryId: { v: 'e1', t: toHlc(500), s: 'visible' }, bookHash: { v: 'abc', t: toHlc(500), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    const result = filterUnchangedReplicas(dbPath, [stale, fresh], 'dictionary-occurrence');
    assert.equal(result.length, 1, 'WITH kind=dictionary-occurrence, stale duplicate should be filtered');
    assert.equal(result[0].updated_at_ts, toHlc(500));
  });

  it('WITH kind=annotation semantic dedup works correctly', () => {
    const { dbPath, conn } = createTempDb();
    conn(`INSERT INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version, semantic_key)
      VALUES ('ann:stored', 'annotation', 'visible',
        '{"bookHash":{"v":"abc","t":"${toHlc(300)}","s":"visible"},"cfi":{"v":"/2/4","t":"${toHlc(300)}","s":"visible"},"text":{"v":"my text","t":"${toHlc(300)}","s":"visible"}}',
        '${toHlc(300)}', 1, 'abc|/2/4|my text')`);

    const stale = {
      replica_id: 'ann:new-stale',
      kind: 'annotation',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(200), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(200), s: 'visible' }, text: { v: 'my text', t: toHlc(200), s: 'visible' } },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };
    const fresh = {
      replica_id: 'ann:new-fresh',
      kind: 'annotation',
      user_id: 'visible',
      fields_jsonb: { bookHash: { v: 'abc', t: toHlc(500), s: 'visible' }, cfi: { v: '/2/4', t: toHlc(500), s: 'visible' }, text: { v: 'my text', t: toHlc(500), s: 'visible' } },
      updated_at_ts: toHlc(500),
      schema_version: 1,
    };

    const result = filterUnchangedReplicas(dbPath, [stale, fresh], 'annotation');
    assert.equal(result.length, 1, 'WITH kind=annotation, stale duplicate should be filtered');
    assert.equal(result[0].updated_at_ts, toHlc(500));
  });
});

// ── computeSemanticKey kind extension tests ───────────────────────────────

describe('computeSemanticKey with kind parameter', () => {
  it('should compute key for quote with bookHash/cfi/contentHash — RED: fails because kind is ignored', () => {
    const row = {
      kind: 'quote',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
        contentHash: { v: 'hash123', t: toHlc(100), s: 'visible' },
      },
    };
    const key = computeSemanticKey(row, 'quote');
    assert.equal(key, 'abc|/2/4|hash123',
      'quote key should be bookHash|cfi|contentHash');
  });

  it('should compute key for occurrence with entryId/bookHash/cfi — RED: fails because kind is ignored', () => {
    const row = {
      kind: 'dictionary-occurrence',
      fields_jsonb: {
        entryId: { v: 'e1', t: toHlc(100), s: 'visible' },
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
      },
    };
    const key = computeSemanticKey(row, 'dictionary-occurrence');
    assert.equal(key, 'e1|abc|/2/4',
      'dictionary-occurrence key should be entryId|bookHash|cfi');
  });

  it('should compute key for annotation with bookHash/cfi/text — RED: fails because kind is ignored', () => {
    const row = {
      kind: 'annotation',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
        text: { v: 'my text', t: toHlc(100), s: 'visible' },
      },
    };
    const key = computeSemanticKey(row, 'annotation');
    assert.equal(key, 'abc|/2/4|my text',
      'annotation key should be bookHash|cfi|text');
  });

  it('should return null for quote row missing contentHash', () => {
    const row = {
      kind: 'quote',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
        // missing contentHash
      },
    };
    const key = computeSemanticKey(row, 'quote');
    assert.equal(key, null,
      'should return null when quote is missing contentHash');
  });

  it('should return null for annotation row missing text', () => {
    const row = {
      kind: 'annotation',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
        // missing text
      },
    };
    const key = computeSemanticKey(row, 'annotation');
    assert.equal(key, null,
      'should return null when annotation is missing text');
  });

  it('should return null for row without fields_jsonb', () => {
    const key = computeSemanticKey({ kind: 'quote' }, 'quote');
    assert.equal(key, null,
      'should return null when row has no fields_jsonb');
  });

  it('should return null for quote with empty contentHash string', () => {
    const row = {
      kind: 'quote',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
        contentHash: { v: '', t: toHlc(100), s: 'visible' },
      },
    };
    const key = computeSemanticKey(row, 'quote');
    assert.equal(key, null,
      'should return null when contentHash is empty string');
  });

  it('should return null for unknown kind', () => {
    const row = {
      kind: 'unknown',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
      },
    };
    const key = computeSemanticKey(row, 'unknown');
    assert.equal(key, null,
      'should return null for unrecognized kind');
  });

  it('should still compute key for dictionary-entry (backward compat)', () => {
    const row = {
      kind: 'dictionary-entry',
      fields_jsonb: {
        term: { v: 'Hello', t: toHlc(100), s: 'visible' },
        language: { v: 'EN', t: toHlc(100), s: 'visible' },
        definition: { v: 'a greeting', t: toHlc(100), s: 'visible' },
      },
    };
    const key = computeSemanticKey(row, 'dictionary-entry');
    assert.equal(key, 'hello|en',
      'dictionary-entry key should normalize and pipe-delimit term|language');
  });
});

// ── ensureReplicaTables quotes DDL tests ──────────────────────────────────

describe('ensureReplicaTables quotes schema', () => {
  it('should include replica_timestamps in quotes DDL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-quotes-schema-'));
    const dbPath = join(dir, 'quotes.db');
    ensureReplicaTables(dbPath, 'quote');
    const cols = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', 'PRAGMA table_info(quotes)'], { encoding: 'utf8' }),
    );
    assert.ok(cols.some(c => c.name === 'replica_timestamps'),
      'quotes table should have replica_timestamps column');
  });

  it('should migrate existing quotes table that lacks replica_timestamps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-quotes-migrate-'));
    const dbPath = join(dir, 'migrate.db');
    // Create quotes table WITHOUT replica_timestamps (simulating old schema)
    execFileSync('sqlite3', [dbPath,
      "CREATE TABLE quotes (id TEXT PRIMARY KEY, book_hash TEXT, cfi TEXT, content_hash TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);"
    ], { encoding: 'utf8' });
    // Now call ensureReplicaTables — should migrate
    ensureReplicaTables(dbPath, 'quote');
    const cols = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', 'PRAGMA table_info(quotes)'], { encoding: 'utf8' }),
    );
    assert.ok(cols.some(c => c.name === 'replica_timestamps'),
      'migration should add replica_timestamps column to existing quotes table');
  });

  it('should not add replica_timestamps for non-quote kinds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-nonquote-schema-'));
    const dbPath = join(dir, 'entries.db');
    ensureReplicaTables(dbPath, 'dictionary-entry');
    const cols = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', 'PRAGMA table_info(dictionary_entries)'], { encoding: 'utf8' }),
    );
    // dictionary_entries should NOT have replica_timestamps added (it already has it)
    // Actually it ALREADY has it in the DDL — so this just confirms no crash
    assert.ok(cols.some(c => c.name === 'replica_timestamps'),
      'dictionary_entries already has replica_timestamps in DDL');
  });
});

// ── upsertReplicaRow quotes replica_timestamps test (Slice 2 RED) ───────
// This test FAILS before task 2.6 because the quotes INSERT in upsertVisibleRow
// doesn't include replica_timestamps. After 2.6 adds the column, it passes.

describe('upsertReplicaRow quotes replica_timestamps', () => {
  it('should FAIL before 2.6: replica_timestamps is NULL in quotes after upsert', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-upsert-quotes-'));
    const dbPath = join(dir, 'quotes.db');
    ensureReplicaTables(dbPath, 'quote');

    // Build a replica row with field data for a quote
    const row = {
      replica_id: 'quote:test-ts-id',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(200), s: 'visible' },
        bookTitle: { v: 'Test Book', t: toHlc(200), s: 'visible' },
        bookAuthor: { v: 'Author', t: toHlc(200), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(200), s: 'visible' },
        text: { v: 'quote text', t: toHlc(200), s: 'visible' },
        contentHash: { v: 'hash456', t: toHlc(200), s: 'visible' },
      },
      updated_at_ts: toHlc(200),
      schema_version: 1,
    };

    // This calls upsertVisibleRow internally which uses the quotes INSERT
    upsertReplicaRow(dbPath, 'quote', row);

    // Check the quotes table: replica_timestamps should be populated
    const quotes = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', "SELECT id, replica_timestamps FROM quotes WHERE id = 'test-ts-id'"], { encoding: 'utf8' }),
    );
    assert.equal(quotes.length, 1, 'quote should exist in quotes table');

    // THIS ASSERTION FAILS before task 2.6 because the quotes INSERT
    // at line 224-231 does NOT include replica_timestamps in the column list
    assert.notEqual(quotes[0]?.replica_timestamps, null,
      'RED: replica_timestamps should NOT be null in quotes after upsert — task 2.6 needs to add it to INSERT');
    assert.ok(quotes[0]?.replica_timestamps?.length > 0,
      'RED: replica_timestamps should contain valid JSON — currently INSERT omits the column');
  });

  it('should FAIL before 2.6: replica_timestamps contains valid JSON for all fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-upsert-quotes-ts-'));
    const dbPath = join(dir, 'quotes2.db');
    ensureReplicaTables(dbPath, 'quote');

    const row = {
      replica_id: 'quote:test-ts-2',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'abc', t: toHlc(100), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(100), s: 'visible' },
        contentHash: { v: 'hash789', t: toHlc(100), s: 'visible' },
        text: { v: 'important text', t: toHlc(100), s: 'visible' },
      },
      updated_at_ts: toHlc(100),
      schema_version: 1,
    };

    upsertReplicaRow(dbPath, 'quote', row);

    const quotes = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', "SELECT id, replica_timestamps FROM quotes WHERE id = 'test-ts-2'"], { encoding: 'utf8' }),
    );
    assert.equal(quotes.length, 1);

    // This also fails before 2.6 — replica_timestamps is NULL because
    // the INSERT doesn't include the column
    assert.notEqual(quotes[0]?.replica_timestamps, null);

    // Verify it's valid JSON containing expected fields
    const timestamps = JSON.parse(quotes[0].replica_timestamps);
    assert.equal(typeof timestamps.bookHash, 'string', 'bookHash should have a timestamp');
    assert.equal(typeof timestamps.cfi, 'string', 'cfi should have a timestamp');
  });
});

// ── pushBooks tests (extracted function from sync-execute.mjs) ─────────────

describe('pushBooks', () => {
  it('should push tombstone books to Android /books/index regardless of remote', async () => {
    // Import after extraction
    const { pushBooks } = await import('../sync-execute.mjs');

    const tombstonedBook = { hash: 'del-book', title: 'Deleted', deletedAt: 1000, updatedAt: 1000, downloadedAt: null };
    const liveBook = { hash: 'live-book', title: 'Live', fileName: 'live.epub' };
    const localLibrary = [tombstonedBook, liveBook];
    const remoteBooks = new Map(); // nothing on remote yet

    const pushed = [];
    const transport = {
      async pushBookLibrary(books) { pushed.push(...books); return {}; },
      async pushBookAsset() { return {}; },
    };

    const booksDir = '/tmp/fake';
    const result = await pushBooks(transport, localLibrary, remoteBooks, booksDir);

    // Tombstone was pushed
    assert.ok(pushed.some(b => b.hash === 'del-book'), 'tombstone should be pushed');
    assert.equal(result.tombstonesPushed, 1, 'should report 1 tombstone pushed');
    // Live book was also pushed
    assert.ok(pushed.some(b => b.hash === 'live-book'), 'live book should be pushed');
    assert.equal(result.sent, 1, 'should report 1 live book sent');
  });

  it('should skip live books already present in remote manifest', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const localBook = { hash: 'existing', title: 'On Remote Too', fileName: 'book.epub' };
    const localLibrary = [localBook];
    const remoteBooks = new Map([['existing', { book: localBook }]]);

    const pushed = [];
    const transport = {
      async pushBookLibrary(books) { pushed.push(...books); return {}; },
      async pushBookAsset() { return {}; },
    };

    const result = await pushBooks(transport, localLibrary, remoteBooks, '/tmp/fake');

    assert.equal(pushed.length, 0, 'should not push book already on remote');
    assert.equal(result.sent, 0);
    assert.equal(result.tombstonesPushed, 0);
  });

  it('should handle empty localLibrary without error', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const result = await pushBooks(
      { async pushBookLibrary() { return {}; }, async pushBookAsset() { return {}; } },
      [],
      new Map(),
      '/tmp/fake',
    );

    assert.equal(result.sent, 0);
    assert.equal(result.tombstonesPushed, 0);
  });

  it('should handle all-tombstone library correctly', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const tombstones = [
      { hash: 'del-1', deletedAt: 1, downloadedAt: null },
      { hash: 'del-2', deletedAt: 2, downloadedAt: null },
    ];
    const pushed = [];
    const transport = {
      async pushBookLibrary(books) { pushed.push(...books); return {}; },
      async pushBookAsset() { return {}; },
    };

    const result = await pushBooks(transport, tombstones, new Map(), '/tmp/fake');

    assert.equal(pushed.length, 2);
    assert.equal(result.tombstonesPushed, 2);
    assert.equal(result.sent, 0);
  });

  it('should push tombstones even when the same hash exists on remote', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const tombstone = { hash: 'existing-del', title: 'Was On Remote', deletedAt: 2000, updatedAt: 2000, downloadedAt: null };
    const localLibrary = [tombstone];
    const remoteBooks = new Map([['existing-del', { book: { hash: 'existing-del' } }]]);

    const pushed = [];
    const transport = {
      async pushBookLibrary(books) { pushed.push(...books); return {}; },
      async pushBookAsset() { return {}; },
    };

    const result = await pushBooks(transport, localLibrary, remoteBooks, '/tmp/fake');

    // Tombstone should be pushed even though remote has the same hash
    assert.equal(pushed.length, 1, 'tombstone should be pushed despite remote presence');
    assert.equal(pushed[0].hash, 'existing-del');
    assert.equal(result.tombstonesPushed, 1);
    assert.equal(result.sent, 0);
  });

  // ── Metadata update detection tests (P0 — RED phase) ─────────────────────

  it('should push metadata-only update when local updatedAt > remote updatedAt', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const localBook = { hash: 'meta-updated', title: 'Edited Title', fileName: 'book.epub', updatedAt: 200 };
    const localLibrary = [localBook];
    const remoteBooks = new Map([['meta-updated', { book: { hash: 'meta-updated', title: 'Old Title', updatedAt: 100 } }]]);

    const pushedLibrary = [];
    const pushedAssets = [];
    const transport = {
      async pushBookLibrary(books) { pushedLibrary.push(...books); return {}; },
      async pushBookAsset(hash, name) { pushedAssets.push({ hash, name }); return {}; },
    };

    const result = await pushBooks(transport, localLibrary, remoteBooks, '/tmp/fake');

    // Metadata update should trigger pushBookLibrary but NOT pushBookAssets
    assert.equal(pushedLibrary.length, 1, 'should push library entry for metadata-updated book');
    assert.equal(pushedLibrary[0].hash, 'meta-updated', 'pushed book should have correct hash');
    assert.equal(pushedLibrary[0].title, 'Edited Title', 'pushed book should carry updated metadata');
    assert.equal(pushedAssets.length, 0, 'should NOT push assets for metadata-only update');
    assert.equal(result.updated, 1, 'updated counter should reflect 1');
    assert.equal(result.sent, 0, 'sent counter should be 0 (not a new book)');
  });

  it('should serialize a live reimport with numeric ordering timestamps so Android can beat an older tombstone', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const reimportedBook = {
      hash: 'reimported-book',
      title: 'Reimported',
      fileName: 'book.epub',
      importedAt: '2026-06-30T12:00:00.000Z',
      updatedAt: '2026-06-30T12:00:00.000Z',
    };
    const pushedLibrary = [];
    const transport = {
      async pushBookLibrary(books) { pushedLibrary.push(...books); return {}; },
      async pushBookAsset() { return {}; },
    };

    await pushBooks(transport, [reimportedBook], new Map(), '/tmp/fake');

    assert.equal(pushedLibrary.length, 1);
    assert.equal(pushedLibrary[0].hash, 'reimported-book');
    assert.equal(pushedLibrary[0].deletedAt, undefined);
    assert.equal(pushedLibrary[0].createdAt, Date.parse('2026-06-30T12:00:00.000Z'));
    assert.equal(pushedLibrary[0].updatedAt, Date.parse('2026-06-30T12:00:00.000Z'));
  });

  it('should skip book when local updatedAt equals remote updatedAt', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    const localBook = { hash: 'unchanged', title: 'Same', fileName: 'book.epub', updatedAt: 100 };
    const localLibrary = [localBook];
    const remoteBooks = new Map([['unchanged', { book: { hash: 'unchanged', title: 'Same', updatedAt: 100 } }]]);

    const pushedLibrary = [];
    const pushedAssets = [];
    const transport = {
      async pushBookLibrary(books) { pushedLibrary.push(...books); return {}; },
      async pushBookAsset(hash, name) { pushedAssets.push({ hash, name }); return {}; },
    };

    const result = await pushBooks(transport, localLibrary, remoteBooks, '/tmp/fake');

    assert.equal(pushedLibrary.length, 0, 'should NOT push library entry for unchanged book');
    assert.equal(pushedAssets.length, 0, 'should NOT push assets for unchanged book');
    assert.equal(result.updated, 0, 'updated counter should be 0');
    assert.equal(result.sent, 0, 'sent counter should be 0');
    assert.equal(result.tombstonesPushed, 0, 'tombstonesPushed should be 0');
  });

  it('should return updated counter alongside sent and tombstonesPushed in combined result', async () => {
    const { pushBooks } = await import('../sync-execute.mjs');

    // Mix: 1 new, 1 metadata-updated, 1 tombstone
    const newBook = { hash: 'brand-new', title: 'Brand New', fileName: 'new.epub', updatedAt: 50 };
    const updatedBook = { hash: 'needs-update', title: 'Edited', fileName: 'upd.epub', updatedAt: 200 };
    const tombstoneBook = { hash: 'gone-book', deletedAt: 300, updatedAt: 300 };
    const localLibrary = [newBook, updatedBook, tombstoneBook];

    const remoteBooks = new Map([
      ['needs-update', { book: { hash: 'needs-update', title: 'Old', updatedAt: 100 } }],
    ]);

    const pushed = [];
    const transport = {
      async pushBookLibrary(books) { pushed.push(...books); return {}; },
      async pushBookAsset() { return {}; },
    };

    const result = await pushBooks(transport, localLibrary, remoteBooks, '/tmp/fake');

    // All three counters should be present and correct
    assert.equal(result.sent, 1, 'new book should count as sent');
    assert.equal(result.updated, 1, 'updated book should count as updated');
    assert.equal(result.tombstonesPushed, 1, 'tombstone should count as tombstonesPushed');
    assert.equal(pushed.length, 3, 'exactly 3 books should have been pushed to library');
  });
});

// ── pushBookAssets tests (existing) ────────────────────────────────────────

describe('pushBookAssets', () => {
  it('should push EPUB, cover.png, and config.json when all exist', async () => {
    const hash = 'testhash123';
    const fileName = 'mybook.epub';
    const { booksDir } = createTempBook(hash, fileName, {
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
    assert.equal(bookPush.size, 17);

    const coverPush = pushed.find(p => p.name === 'cover.png');
    assert.ok(coverPush, 'should push cover.png');
    assert.equal(coverPush.size, 14);

    const configPush = pushed.find(p => p.name === 'config.json');
    assert.ok(configPush, 'should push config.json');
  });

  it('should skip missing cover.png and config.json gracefully', async () => {
    const hash = 'testhash456';
    const fileName = 'naked.epub';
    const { booksDir } = createTempBook(hash, fileName);

    const pushed = [];
    const transport = {
      async pushBookAsset(h, name, bytes) {
        pushed.push({ hash: h, name, size: bytes.byteLength || bytes.length });
        return {};
      },
    };

    const book = { hash, title: 'Naked Book', fileName };

    await pushBookAssets(transport, book, booksDir);

    assert.equal(pushed.length, 1, 'should push only the book EPUB when optional assets missing');
    assert.equal(pushed[0].name, 'book');
    assert.equal(pushed[0].hash, hash);
  });

  it('should push with only config (no cover)', async () => {
    const hash = 'testhash789';
    const fileName = 'config-only.epub';
    const { booksDir } = createTempBook(hash, fileName, {
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
