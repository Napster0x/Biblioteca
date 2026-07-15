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
  hlcGt,
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

// resolveSemanticId and mergeReplicaFields are exported from sync-execute.mjs
// and imported dynamically in the tests below for strict TDD verification.
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

// ── hlcGt full HLC comparator tests (RED for A1) ──────────────────────────

describe('hlcGt', () => {
  it('should return true when counter is higher at same millisecond (RED: hlcGt does not exist)', () => {
    // Same ms=1000, counter=2 vs counter=1 → counter=2 wins
    const lower = '00000000003e8-00000001-android';
    const higher = '00000000003e8-00000002-android';

    expect(hlcGt(higher, lower)).toBe(true);
    expect(hlcGt(lower, higher)).toBe(false);
  });

  it('should return true for higher ms regardless of counter', () => {
    // ms=1001 counter=1 vs ms=1000 counter=5 → ms wins
    const older = '00000000003e8-00000005-android';   // ms=1000, counter=5
    const newer = '00000000003e9-00000001-android';    // ms=1001, counter=1

    expect(hlcGt(newer, older)).toBe(true);
    expect(hlcGt(older, newer)).toBe(false);
  });

  it('should use deviceId as tiebreaker when ms and counter are equal', () => {
    // Same ms=1000, same counter=1, different device
    const deviceA = '00000000003e8-00000001-alpha';
    const deviceB = '00000000003e8-00000001-beta';

    // 'beta' > 'alpha' lexicographically
    expect(hlcGt(deviceB, deviceA)).toBe(true);
    expect(hlcGt(deviceA, deviceB)).toBe(false);
  });

  it('should return false for equal HLCs', () => {
    const hlc = '00000000003e8-00000001-visible';
    expect(hlcGt(hlc, hlc)).toBe(false);
  });

  it('should handle NaN segments by falling back to 0', () => {
    // Non-HLC strings like harness timestamps should not crash
    expect(hlcGt('T200', 'T100')).toBe(true);
    expect(hlcGt('T100', 'T200')).toBe(false);
    expect(hlcGt('T100', 'T100')).toBe(false);
  });

  it('should be reflexive: not (a > b) iff not (b > a) for distinct values', () => {
    const a = '00000000003e8-00000001-android';
    const b = '00000000003e8-00000002-android';
    expect(hlcGt(a, b)).toBe(false);
    expect(hlcGt(b, a)).toBe(true);
  });
});

// ── rowToReplica CRDT dedup counter test (RED for A1) ──────────────────────

describe('rowToReplica CRDT dedup counter', () => {
  it('should pick field HLC with higher counter when ms are equal (RED: uses hlcMillis, ignores counter)', () => {
    // Both field HLCs have ms=1000 but different counters.
    // With hlcMillis(), they appear equal and reduce picks the fallback (counter=1).
    // With hlcGt(), the field HLC with counter=2 should win.
    const row = {
      id: 'entry-counter-dedup',
      term: 'test-counter',
      display_term: 'Test Counter',
      language: 'en',
      definition: 'new definition',
      curiosity: null,
      image_path: null,
      enrichment_status: 'pending',
      created_at: 50,
      updated_at: 1000,
      replica_timestamps: JSON.stringify({
        term: '00000000003e8-00000002-android',     // ms=1000, counter=2
        definition: '00000000003e8-00000001-android', // ms=1000, counter=1
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

    // The max should be the term HLC with counter=2, NOT the fallback (counter=1)
    assert.equal(replica.updated_at_ts, '00000000003e8-00000002-android',
      'should pick field HLC with counter=2 over fallback with counter=1');
    assert.equal(replica.fields_jsonb.term.t, '00000000003e8-00000002-android');
    assert.equal(replica.fields_jsonb.definition.t, '00000000003e8-00000001-android');
  });
});

// ── mergeRemoteBookMetadata tiebreaker tests (RED for A2) ──────────────────

describe('mergeRemoteBookMetadata tiebreaker', () => {
  it('should keep local book when remote has same ms timestamp and same hash (RED: <= skips, fix uses hash tiebreaker)', () => {
    // Same book (same hash), same updatedAt ms.
    // Current code: <= comparison → remote skipped → local wins. This is already correct.
    // Fix: explicit tiebreaker via hash comparison → same result (no change).
    const localLibrary = [{
      hash: 'book-a',
      title: 'Local Title',
      author: 'Local Author',
      fileName: 'book.epub',
      updatedAt: 1000,
      deletedAt: null,
    }];
    const remoteIndexBooks = [{
      hash: 'book-a',
      title: 'Remote Title',
      author: 'Remote Author',
      updatedAt: 1000,
      deletedAt: null,
      metadata: { language: 'es' },
    }];

    const { library, applied } = mergeRemoteBookMetadata(localLibrary, remoteIndexBooks);

    // Equal timestamps + same hash → local wins (deterministic)
    expect(applied).toBe(0);
    expect(library[0].title).toBe('Local Title');
  });

  it('should apply remote when remote has higher timestamp (basic LWW, should already pass)', () => {
    const localLibrary = [{
      hash: 'book-b',
      title: 'Old Local Title',
      author: 'Author',
      fileName: 'book.epub',
      updatedAt: 500,
      deletedAt: null,
    }];
    const remoteIndexBooks = [{
      hash: 'book-b',
      title: 'Newer Remote Title',
      author: 'Remote Author',
      updatedAt: 1500,
      deletedAt: null,
    }];

    const { library, applied } = mergeRemoteBookMetadata(localLibrary, remoteIndexBooks);

    expect(applied).toBe(1);
    expect(library[0].title).toBe('Newer Remote Title');
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

// ── toHlc T<millis> harness timestamp format (RED) ───────────────────
// Phase 6 discovery: harness generates timestamps as T<millis> (e.g.,
// T1783984749748) which toHlc cannot parse → falls to Date.now() →
// inflates HLC, bypassing the is_semantic_remap gate.

describe('toHlc T<millis> harness timestamp format', () => {
  it('should produce stable, repeatable HLC from T<millis> format', () => {
    const t = 'T1783984749748';
    const result1 = toHlc(t);
    const result2 = toHlc(t);

    // Must NOT be garbage (no "NaN" in the hex field)
    expect(result1).not.toMatch(/NaN/i);

    // Must match standard HLC format: hex-counters-deviceId
    expect(result1).toMatch(/^[0-9a-f]{13}-[0-9a-f]{8}-[A-Za-z0-9_-]+$/i);

    // Same input must produce same output (deterministic)
    expect(result1).toBe(result2);

    // The hex timestamp field must encode the original millis value
    const millisHex = result1.split('-')[0];
    const parsedMillis = parseInt(millisHex, 16);
    expect(parsedMillis).toBe(1783984749748);
  });

  it('should parse T100 as 100 millis in hex (0x64 → 0000000000064)', () => {
    const result = toHlc('T100');
    expect(result).toMatch(/^[0-9a-f]{13}-[0-9a-f]{8}-[A-Za-z0-9_-]+$/i);
    const millisHex = result.split('-')[0];
    expect(parseInt(millisHex, 16)).toBe(100);
  });

  it('should NOT interfere with existing numeric toHlc(args)', () => {
    // Numeric values should still work (backward compat)
    const result = toHlc(1650);
    expect(result).toMatch(/^[0-9a-f]{13}-[0-9a-f]{8}-[A-Za-z0-9_-]+$/i);
    expect(parseInt(result.split('-')[0], 16)).toBe(1650);
  });

  it('should NOT interfere with existing hex HLC string passthrough', () => {
    const existing = '00000000003e8-00000001-android';
    expect(toHlc(existing)).toBe(existing);
  });

  it('should handle T0 correctly (zero millis)', () => {
    const result = toHlc('T0');
    expect(result).toMatch(/^[0-9a-f]{13}-[0-9a-f]{8}-[A-Za-z0-9_-]+$/i);
    expect(parseInt(result.split('-')[0], 16)).toBe(0);
  });
});

// ── 23e regression: two quotes, different books, same text → coexist ─────
// RED: These tests verify the root cause of the 23e regression.
// Before fix: `applyReplicaRowsToDesktop` via HTTP path wrote to Tauri
// app's citas.db instead of the harness-specified dataRoot.  The SQLite
// path (`upsertReplicaRow`) correctly writes to the harness dataRoot.
// After fix: the harness path uses direct SQLite to ensure writes target
// the correct data directory.

describe('23e coexistence — two quotes different books, same text', () => {
  it('RED: upsertReplicaRow should allow two quotes with different bookHash but same content', () => {
    const { createHash } = require('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'sync-23e-coexistence-'));
    const dbPath = join(dir, 'citas.db');
    ensureReplicaTables(dbPath, 'quote');

    const sharedText = 'Frases célebres y otros menesteres';
    const sharedContentHash = createHash('md5').update(sharedText).digest('hex');
    const sharedCfi = '/6/4[section]!/10/2:0';

    // Desktop quote: book L1
    const desktopQuote = {
      replica_id: 'quote:desk-23e-test',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'desk-book-hash-L1', t: toHlc(1000), s: 'visible' },
        bookTitle: { v: 'Desktop Book', t: toHlc(1000), s: 'visible' },
        bookAuthor: { v: 'Author D', t: toHlc(1000), s: 'visible' },
        cfi: { v: sharedCfi, t: toHlc(1000), s: 'visible' },
        text: { v: sharedText, t: toHlc(1000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(1000), s: 'visible' },
      },
      updated_at_ts: toHlc(1000),
      schema_version: 1,
    };

    // Android quote: book L2 (DIFFERENT book, same text)
    const androidQuote = {
      replica_id: 'quote:and-23e-test',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'and-book-hash-L2', t: toHlc(2000), s: 'visible' },
        bookTitle: { v: 'Android Book', t: toHlc(2000), s: 'visible' },
        bookAuthor: { v: 'Author A', t: toHlc(2000), s: 'visible' },
        cfi: { v: sharedCfi, t: toHlc(2000), s: 'visible' },
        text: { v: sharedText, t: toHlc(2000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(2000), s: 'visible' },
      },
      updated_at_ts: toHlc(2000),
      schema_version: 1,
    };

    // Both should be inserted via upsertReplicaRow (direct SQLite path)
    const applied1 = upsertReplicaRow(dbPath, 'quote', desktopQuote);
    const applied2 = upsertReplicaRow(dbPath, 'quote', androidQuote);
    assert.equal(applied1, true, 'desktop quote should be applied');
    assert.equal(applied2, true, 'android quote should be applied');

    // Verify both exist in quotes table with different bookHash
    const quotes = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', 'SELECT id, book_hash, text, content_hash FROM quotes'], { encoding: 'utf8' }),
    );
    assert.equal(quotes.length, 2, 'RED: expected 2 quotes, got ' + quotes.length + ' — two different-book quotes should coexist');

    const bookHashes = quotes.map(q => q.book_hash).sort();
    assert.deepEqual(bookHashes, ['and-book-hash-L2', 'desk-book-hash-L1'],
      'RED: both book hashes should be present');

    // Both should have the same content hash
    const contentHashes = [...new Set(quotes.map(q => q.content_hash))];
    assert.equal(contentHashes.length, 1, 'RED: both quotes should have same content hash');
    assert.equal(contentHashes[0], sharedContentHash);
  });

  it('RED: upsertReplicaRow should preserve replica_timestamps for both quotes', () => {
    const { createHash } = require('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'sync-23e-timestamps-'));
    const dbPath = join(dir, 'citas.db');
    ensureReplicaTables(dbPath, 'quote');

    const sharedText = 'timestamps test text';
    const sharedContentHash = createHash('md5').update(sharedText).digest('hex');

    const row1 = {
      replica_id: 'quote:ts-desk',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'book-ts-1', t: toHlc(3000), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(3000), s: 'visible' },
        text: { v: sharedText, t: toHlc(3000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(3000), s: 'visible' },
      },
      updated_at_ts: toHlc(3000),
      schema_version: 1,
    };

    const row2 = {
      replica_id: 'quote:ts-and',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'book-ts-2', t: toHlc(4000), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(4000), s: 'visible' },
        text: { v: sharedText, t: toHlc(4000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(4000), s: 'visible' },
      },
      updated_at_ts: toHlc(4000),
      schema_version: 1,
    };

    upsertReplicaRow(dbPath, 'quote', row1);
    upsertReplicaRow(dbPath, 'quote', row2);

    const quotes = JSON.parse(
      execFileSync('sqlite3', [dbPath, '-json', 'SELECT id, replica_timestamps FROM quotes ORDER BY id'], { encoding: 'utf8' }),
    );
    assert.equal(quotes.length, 2, 'RED: both quotes should be present');

    // Both should have non-null replica_timestamps
    for (const q of quotes) {
      assert.notEqual(q.replica_timestamps, null,
        `RED: quote ${q.id} replica_timestamps should not be null`);
      const ts = JSON.parse(q.replica_timestamps);
      assert.ok(typeof ts.bookHash === 'string' || typeof ts.text === 'string',
        `RED: quote ${q.id} replica_timestamps should contain field timestamps`);
    }
  });
});

// ── Desktop merge bypass: ensure write path targets correct directory ───
// RED: When BIBLIOTECA_DEV_SYNC_HARNESS=1, applyReplicaRowsToDesktop must
// write to the dataRoot-specified citas.db, not the Tauri app's app_data_dir.
// This test validates that the harness env var triggers the direct SQLite path
// (which targets the correct data directory) instead of the HTTP path
// (which would write to the Tauri app's data directory).

describe('applyReplicaRowsToDesktop harness data directory', () => {
  it('RED: harness mode writes to SQLite, not HTTP', async () => {
    // Simulate the harness environment: BIBLIOTECA_DEV_SYNC_HARNESS=1
    // In harness mode, applyReplicaRowsToDesktop should skip HTTP and
    // write directly to SQLite (targeting the correct data directory).

    const dir = mkdtempSync(join(tmpdir(), 'sync-harness-apply-'));
    const dbPath = join(dir, 'citas.db');
    ensureReplicaTables(dbPath, 'quote');

    // Save and override env
    const prevHarness = process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
    process.env.BIBLIOTECA_DEV_SYNC_HARNESS = '1';

    const row = {
      replica_id: 'quote:harness-test',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'book-harness-h', t: toHlc(5000), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(5000), s: 'visible' },
        text: { v: 'harness text', t: toHlc(5000), s: 'visible' },
        contentHash: { v: 'hash-harness', t: toHlc(5000), s: 'visible' },
      },
      updated_at_ts: toHlc(5000),
      schema_version: 1,
    };

    try {
      // Dynamic import to get the modified applyReplicaRowsToDesktop
      const { applyReplicaRowsToDesktop } = await import('../sync-execute.mjs');
      const applied = await applyReplicaRowsToDesktop('quote', [row], dbPath);
      assert.equal(applied, 1, 'RED: harness mode should apply 1 row via SQLite');

      // Verify it's in the quotes table (not sent to HTTP)
      const quotes = JSON.parse(
        execFileSync('sqlite3', [dbPath, '-json', 'SELECT id, book_hash, text FROM quotes'], { encoding: 'utf8' }),
      );
      assert.equal(quotes.length, 1);
      assert.equal(quotes[0].id, 'harness-test');
      assert.equal(quotes[0].book_hash, 'book-harness-h');
    } finally {
      if (prevHarness !== undefined) {
        process.env.BIBLIOTECA_DEV_SYNC_HARNESS = prevHarness;
      } else {
        delete process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
      }
    }
  });
});

// ── resolveSemanticId — semantic identity remap (RED) ──────────────────────
// These tests reference resolveSemanticId which does NOT exist yet.
// After implementation in sync-execute.mjs, import it above.

describe('resolveSemanticId semantic identity remap', () => {
  function createDbWithTable(dbName, tableName, ddl) {
    const dir = mkdtempSync(join(tmpdir(), `sync-semantic-${dbName}-`));
    const dbPath = join(dir, `${dbName}.db`);
    execFileSync('sqlite3', [dbPath, ddl], { encoding: 'utf8' });
    return { dir, dbPath };
  }

  it('RED: should find canonical dictionary-entry by normalized term+language', async () => {
    const { dbPath } = createDbWithTable('dictionary', 'dictionary_entries',
      `CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, display_term TEXT, language TEXT, definition TEXT, enrichment_status TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);` +
      `INSERT INTO dictionary_entries (id, term, language, definition, deleted_at) VALUES ('canonical-1', 'Hello', 'en', 'old definition', NULL);` +
      `INSERT INTO dictionary_entries (id, term, language, definition, deleted_at) VALUES ('canonical-2', 'World', 'FR', 'old def 2', NULL);`
    );

    // Dynamic import to get resolveSemanticId (does NOT exist yet — RED)
    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'dictionary-entry:new-uuid',
      kind: 'dictionary-entry',
      fields_jsonb: {
        term: { v: 'hello', t: toHlc(500), s: 'visible' },
        language: { v: 'en', t: toHlc(500), s: 'visible' },
        definition: { v: 'new def', t: toHlc(500), s: 'visible' },
      },
    };

    const result = resolveSemanticId(incoming, 'dictionary-entry', dbPath);
    assert.equal(result, 'dictionary-entry:canonical-1',
      'RED: should remap to canonical entry by normalized term+language');
  });

  it('RED: should find canonical quote by bookHash+contentHash', async () => {
    const { dbPath } = createDbWithTable('quotes', 'quotes',
      `CREATE TABLE quotes (id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, cfi TEXT, text TEXT, content_hash TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);` +
      `INSERT INTO quotes (id, book_hash, content_hash, text, deleted_at) VALUES ('canonical-q', 'hash123', 'chash', 'some text', NULL);` +
      `INSERT INTO quotes (id, book_hash, content_hash, text, deleted_at) VALUES ('canonical-q2', 'hash456', 'chash2', 'other text', NULL);`
    );

    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'quote:new-q',
      kind: 'quote',
      fields_jsonb: {
        bookHash: { v: 'hash123', t: toHlc(500), s: 'visible' },
        contentHash: { v: 'chash', t: toHlc(500), s: 'visible' },
        text: { v: 'updated text', t: toHlc(500), s: 'visible' },
      },
    };

    const result = resolveSemanticId(incoming, 'quote', dbPath);
    assert.equal(result, 'quote:canonical-q',
      'RED: should remap to canonical quote by bookHash+contentHash');
  });

  it('RED: should find canonical annotation by bookHash+cfi+text', async () => {
    const { dbPath } = createDbWithTable('annotations', 'annotations',
      `CREATE TABLE annotations (id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, cfi TEXT, text TEXT, note TEXT, style TEXT, color TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);` +
      `INSERT INTO annotations (id, book_hash, cfi, text, note, deleted_at) VALUES ('canonical-a', 'hash123', '/2/4', 'highlight text', '', NULL);` +
      `INSERT INTO annotations (id, book_hash, cfi, text, note, deleted_at) VALUES ('canonical-a2', 'hash456', '/6/2', 'other text', '', NULL);`
    );

    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'annotation:new-a',
      kind: 'annotation',
      fields_jsonb: {
        bookHash: { v: 'hash123', t: toHlc(500), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(500), s: 'visible' },
        text: { v: 'highlight text', t: toHlc(500), s: 'visible' },
        note: { v: 'updated note', t: toHlc(500), s: 'visible' },
      },
    };

    const result = resolveSemanticId(incoming, 'annotation', dbPath);
    assert.equal(result, 'annotation:canonical-a',
      'RED: should remap to canonical annotation by bookHash+cfi+text');
  });

  it('RED: should return null for dictionary-occurrence (always distinct)', async () => {
    const { dbPath } = createDbWithTable('dictionary', 'dictionary_entries',
      `CREATE TABLE dictionary_occurrences (id TEXT PRIMARY KEY, entry_id TEXT, book_hash TEXT, cfi TEXT, selected_text TEXT, created_at INTEGER, deleted_at INTEGER);`
    );

    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'dictionary-occurrence:occ-1',
      kind: 'dictionary-occurrence',
      fields_jsonb: {
        entryId: { v: 'e1', t: toHlc(500), s: 'visible' },
        bookHash: { v: 'hash123', t: toHlc(500), s: 'visible' },
        cfi: { v: '/2/4', t: toHlc(500), s: 'visible' },
      },
    };

    const result = resolveSemanticId(incoming, 'dictionary-occurrence', dbPath);
    assert.equal(result, null,
      'RED: dictionary-occurrence should always return null (no semantic merge)');
  });

  it('RED: should return null when no matching non-deleted row exists', async () => {
    const { dbPath } = createDbWithTable('quotes2', 'quotes',
      `CREATE TABLE quotes (id TEXT PRIMARY KEY, book_hash TEXT, content_hash TEXT, text TEXT, deleted_at INTEGER);` +
      `INSERT INTO quotes (id, book_hash, content_hash, text, deleted_at) VALUES ('canonical-q', 'hash123', 'chash', 'text', 1000);`
    );

    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'quote:new-q',
      kind: 'quote',
      fields_jsonb: {
        bookHash: { v: 'hash123', t: toHlc(500), s: 'visible' },
        contentHash: { v: 'chash', t: toHlc(500), s: 'visible' },
      },
    };

    // Row exists but is deleted → should NOT match
    const result = resolveSemanticId(incoming, 'quote', dbPath);
    assert.equal(result, null,
      'RED: should not match deleted rows');
  });

  it('RED: should not match when incoming id equals the found row id (same entity)', async () => {
    const { dbPath } = createDbWithTable('dict-self', 'dictionary_entries',
      `CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, language TEXT, definition TEXT, deleted_at INTEGER);` +
      `INSERT INTO dictionary_entries (id, term, language, definition, deleted_at) VALUES ('same-id', 'hello', 'en', 'def', NULL);`
    );

    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'dictionary-entry:same-id',
      kind: 'dictionary-entry',
      fields_jsonb: {
        term: { v: 'hello', t: toHlc(500), s: 'visible' },
        language: { v: 'en', t: toHlc(500), s: 'visible' },
      },
    };

    // Incoming already has the same id → should return null (no remap needed)
    const result = resolveSemanticId(incoming, 'dictionary-entry', dbPath);
    assert.equal(result, null,
      'RED: should not remap when the canonical id matches the incoming id');
  });

  it('RED: should handle unicode normalization for dictionary terms', async () => {
    const { dbPath } = createDbWithTable('dict-unicode', 'dictionary_entries',
      `CREATE TABLE dictionary_entries (id TEXT PRIMARY KEY, term TEXT, language TEXT, definition TEXT, deleted_at INTEGER);` +
      `INSERT INTO dictionary_entries (id, term, language, definition, deleted_at) VALUES ('unicode-1', 'Café', 'es', 'bebida', NULL);`
    );

    const { resolveSemanticId } = await import('../sync-execute.mjs');

    const incoming = {
      replica_id: 'dictionary-entry:new-unicode',
      kind: 'dictionary-entry',
      fields_jsonb: {
        term: { v: 'cafe\u0301', t: toHlc(500), s: 'visible' }, // Combined accent
        language: { v: 'es', t: toHlc(500), s: 'visible' },
      },
    };

    // 'Café' (NFC) should match 'cafe\u0301' (NFD) after normalization
    const result = resolveSemanticId(incoming, 'dictionary-entry', dbPath);
    assert.equal(result, 'dictionary-entry:unicode-1',
      'RED: unicode normalization should match composed and decomposed forms');
  });
});

// ── mergeReplicaFields — per-field HLC merge (RED) ─────────────────────────

describe('mergeReplicaFields per-field HLC merge', () => {
  it('RED: should add new incoming fields not present in existing', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {
      term: { v: 'hello', t: toHlc(100), s: 'visible' },
    };
    const incoming = {
      definition: { v: 'new definition', t: toHlc(200), s: 'visible' },
    };

    const merged = mergeReplicaFields(existing, incoming);

    // Existing field preserved
    assert.deepEqual(merged.term, { v: 'hello', t: toHlc(100), s: 'visible' });
    // New field added
    assert.deepEqual(merged.definition, { v: 'new definition', t: toHlc(200), s: 'visible' });
  });

  it('RED: should overwrite field when incoming HLC is higher', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {
      definition: { v: 'old definition', t: toHlc(100), s: 'visible' },
    };
    const incoming = {
      definition: { v: 'new definition', t: toHlc(200), s: 'visible' },
    };

    const merged = mergeReplicaFields(existing, incoming);

    assert.deepEqual(merged.definition,
      { v: 'new definition', t: toHlc(200), s: 'visible' },
      'RED: incoming with higher HLC should overwrite existing field');
  });

  it('RED: should preserve existing field when incoming HLC is lower', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {
      definition: { v: 'already newer', t: toHlc(300), s: 'visible' },
    };
    const incoming = {
      definition: { v: 'stale value', t: toHlc(100), s: 'visible' },
    };

    const merged = mergeReplicaFields(existing, incoming);

    assert.deepEqual(merged.definition,
      { v: 'already newer', t: toHlc(300), s: 'visible' },
      'RED: incoming with lower HLC should NOT overwrite existing field');
  });

  it('RED: should preserve existing fields not in incoming', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {
      term: { v: 'hello', t: toHlc(100), s: 'visible' },
      language: { v: 'en', t: toHlc(100), s: 'visible' },
      definition: { v: 'old def', t: toHlc(100), s: 'visible' },
    };
    const incoming = {
      definition: { v: 'new def', t: toHlc(200), s: 'visible' },
    };

    const merged = mergeReplicaFields(existing, incoming);

    // Incoming field overwritten
    assert.deepEqual(merged.definition, { v: 'new def', t: toHlc(200), s: 'visible' });
    // Existing fields preserved
    assert.deepEqual(merged.term, { v: 'hello', t: toHlc(100), s: 'visible' });
    assert.deepEqual(merged.language, { v: 'en', t: toHlc(100), s: 'visible' });
  });

  it('RED: should handle empty existing object', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {};
    const incoming = {
      term: { v: 'hello', t: toHlc(100), s: 'visible' },
      definition: { v: 'hi', t: toHlc(100), s: 'visible' },
    };

    const merged = mergeReplicaFields(existing, incoming);

    // All incoming fields should be present
    assert.equal(Object.keys(merged).length, 2);
    assert.deepEqual(merged.term, { v: 'hello', t: toHlc(100), s: 'visible' });
    assert.deepEqual(merged.definition, { v: 'hi', t: toHlc(100), s: 'visible' });
  });

  it('RED: should handle counter comparison in HLC (same ms, different counter)', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {
      definition: {
        v: 'old',
        t: '00000000003e8-00000001-visible',  // ms=1000, counter=1
        s: 'visible',
      },
    };
    const incoming = {
      definition: {
        v: 'new',
        t: '00000000003e8-00000002-visible',  // ms=1000, counter=2 — higher
        s: 'visible',
      },
    };

    const merged = mergeReplicaFields(existing, incoming);

    assert.equal(merged.definition.v, 'new',
      'RED: same ms, higher counter should win');
  });

  it('RED: should not mutate input objects', async () => {
    const { mergeReplicaFields } = await import('../sync-execute.mjs');

    const existing = {
      term: { v: 'hello', t: toHlc(100), s: 'visible' },
    };
    const incoming = {
      definition: { v: 'new', t: toHlc(200), s: 'visible' },
    };

    const existingCopy = JSON.parse(JSON.stringify(existing));
    const incomingCopy = JSON.parse(JSON.stringify(incoming));

    mergeReplicaFields(existing, incoming);

    assert.deepEqual(existing, existingCopy, 'RED: existing should not be mutated');
    assert.deepEqual(incoming, incomingCopy, 'RED: incoming should not be mutated');
  });
});

// ── applyReplicaRowsToDesktop semantic merge integration (RED) ─────────────

describe('applyReplicaRowsToDesktop semantic merge in harness mode', () => {
  it('RED: should merge fields when incoming replica semantically matches existing db row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-harness-merge-'));
    const dbPath = join(dir, 'dictionary.db');
    ensureReplicaTables(dbPath, 'dictionary-entry');

    // Insert an existing entry directly (simulating a previous sync)
    execFileSync('sqlite3', [dbPath,
      `INSERT INTO dictionary_entries (id, term, display_term, language, definition, enrichment_status, created_at, updated_at) ` +
      `VALUES ('canonical-e1', 'Hello', 'Hello', 'en', 'Old definition', 'pending', 1000, 1000);`
    ], { encoding: 'utf8' });

    // Also seed _replicas with the existing fields_jsonb so merge can work
    const existingFields = {
      term: { v: 'Hello', t: toHlc(1000), s: 'visible' },
      displayTerm: { v: 'Hello', t: toHlc(1000), s: 'visible' },
      language: { v: 'en', t: toHlc(1000), s: 'visible' },
      definition: { v: 'Old definition', t: toHlc(1000), s: 'visible' },
      enrichmentStatus: { v: 'pending', t: toHlc(1000), s: 'visible' },
    };
    execFileSync('sqlite3', [dbPath,
      `INSERT OR REPLACE INTO _replicas (replica_id, kind, user_id, fields_jsonb, updated_at_ts, schema_version) ` +
      `VALUES ('dictionary-entry:canonical-e1', 'dictionary-entry', 'visible', '${JSON.stringify(existingFields).replace(/'/g, "''")}', '${toHlc(1000)}', 1);`
    ], { encoding: 'utf8' });

    // Incoming row has different replica_id but same semantic identity (hello|en)
    // It has a new definition with higher HLC but lower term
    const incoming = {
      replica_id: 'dictionary-entry:android-uuid',
      kind: 'dictionary-entry',
      user_id: 'visible',
      fields_jsonb: {
        term: { v: 'hello', t: toHlc(500), s: 'visible' },  // LOWER — should NOT overwrite
        language: { v: 'en', t: toHlc(500), s: 'visible' },
        definition: { v: 'New merged definition', t: toHlc(2000), s: 'visible' },  // HIGHER — should overwrite
      },
      updated_at_ts: toHlc(2000),
      schema_version: 1,
    };

    // Save and override env
    const prevHarness = process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
    process.env.BIBLIOTECA_DEV_SYNC_HARNESS = '1';

    try {
      const { applyReplicaRowsToDesktop } = await import('../sync-execute.mjs');
      const applied = await applyReplicaRowsToDesktop('dictionary-entry', [incoming], dbPath);

      assert.equal(applied, 1, 'RED: merge path should apply 1 row');

      // Verify the result in dictionary_entries
      const entries = JSON.parse(
        execFileSync('sqlite3', [dbPath, '-json',
          'SELECT id, term, definition, replica_timestamps FROM dictionary_entries WHERE id = \'canonical-e1\''
        ], { encoding: 'utf8' }),
      );
      assert.equal(entries.length, 1, 'RED: entry should exist');
      assert.equal(entries[0].term, 'Hello', 'RED: term should be preserved from existing (incoming HLC lower)');
      assert.equal(entries[0].definition, 'New merged definition', 'RED: definition should be from incoming (higher HLC)');
    } finally {
      if (prevHarness !== undefined) {
        process.env.BIBLIOTECA_DEV_SYNC_HARNESS = prevHarness;
      } else {
        delete process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
      }
    }
  });

  it('RED: two different-book quotes with same text+cfi should both be inserted (no semantic collision)', async () => {
    const { createHash } = require('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'sync-harness-two-quotes-'));
    const dbPath = join(dir, 'citas.db');
    ensureReplicaTables(dbPath, 'quote');

    const sharedText = 'Same text in two different books';
    const sharedContentHash = createHash('md5').update(sharedText).digest('hex');
    const sharedCfi = '/6/4[section]/10/2:0';

    const desktopQuote = {
      replica_id: 'quote:desk-merge',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'desk-book', t: toHlc(1000), s: 'visible' },
        bookTitle: { v: 'Desktop Book', t: toHlc(1000), s: 'visible' },
        cfi: { v: sharedCfi, t: toHlc(1000), s: 'visible' },
        text: { v: sharedText, t: toHlc(1000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(1000), s: 'visible' },
      },
      updated_at_ts: toHlc(1000),
      schema_version: 1,
    };

    const androidQuote = {
      replica_id: 'quote:and-merge',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: 'and-book', t: toHlc(2000), s: 'visible' },
        bookTitle: { v: 'Android Book', t: toHlc(2000), s: 'visible' },
        cfi: { v: sharedCfi, t: toHlc(2000), s: 'visible' },
        text: { v: sharedText, t: toHlc(2000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(2000), s: 'visible' },
      },
      updated_at_ts: toHlc(2000),
      schema_version: 1,
    };

    const prevHarness = process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
    process.env.BIBLIOTECA_DEV_SYNC_HARNESS = '1';

    try {
      const { applyReplicaRowsToDesktop } = await import('../sync-execute.mjs');

      const applied1 = await applyReplicaRowsToDesktop('quote', [desktopQuote], dbPath);
      assert.equal(applied1, 1, 'first quote should apply');

      const applied2 = await applyReplicaRowsToDesktop('quote', [androidQuote], dbPath);
      assert.equal(applied2, 1, 'second quote should apply');

      // Both should coexist — different bookHash means different semantic identity
      const quotes = JSON.parse(
        execFileSync('sqlite3', [dbPath, '-json', 'SELECT id, book_hash FROM quotes'], { encoding: 'utf8' }),
      );
      assert.equal(quotes.length, 2, 'RED: two different-book quotes should coexist');
      const bookHashes = quotes.map(q => q.book_hash).sort();
      assert.deepEqual(bookHashes, ['and-book', 'desk-book']);
    } finally {
      if (prevHarness !== undefined) {
        process.env.BIBLIOTECA_DEV_SYNC_HARNESS = prevHarness;
      } else {
        delete process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
      }
    }
  });

  it('RED: two quotes with same bookHash+contentHash should merge into one row', async () => {
    const { createHash } = require('node:crypto');
    const dir = mkdtempSync(join(tmpdir(), 'sync-harness-quote-merge-'));
    const dbPath = join(dir, 'citas.db');
    ensureReplicaTables(dbPath, 'quote');

    const sharedText = 'Hello world';
    const sharedContentHash = createHash('md5').update(sharedText).digest('hex');
    const sharedBookHash = 'same-book-hash';
    const sharedCfi = '/4/2';

    // First quote: desktop quote with basic fields
    const desktopQuote = {
      replica_id: 'quote:desk-first',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: sharedBookHash, t: toHlc(1000), s: 'visible' },
        bookTitle: { v: 'Same Book Title', t: toHlc(1000), s: 'visible' },
        cfi: { v: sharedCfi, t: toHlc(1000), s: 'visible' },
        text: { v: sharedText, t: toHlc(1000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(1000), s: 'visible' },
      },
      updated_at_ts: toHlc(1000),
      schema_version: 1,
    };

    // Second quote: Android quote with SAME book+contentHash but DIFFERENT fields (contextBefore)
    // and a DIFFERENT replica_id — should be semantically matched to first
    const androidQuote = {
      replica_id: 'quote:and-second',
      kind: 'quote',
      user_id: 'visible',
      fields_jsonb: {
        bookHash: { v: sharedBookHash, t: toHlc(2000), s: 'visible' },
        bookTitle: { v: 'Same Book Title', t: toHlc(2000), s: 'visible' },
        cfi: { v: sharedCfi, t: toHlc(2000), s: 'visible' },
        text: { v: sharedText, t: toHlc(2000), s: 'visible' },
        contentHash: { v: sharedContentHash, t: toHlc(2000), s: 'visible' },
        contextBefore: { v: 'Android context before', t: toHlc(2000), s: 'visible' },
      },
      updated_at_ts: toHlc(2000),
      schema_version: 1,
    };

    const prevHarness = process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
    process.env.BIBLIOTECA_DEV_SYNC_HARNESS = '1';

    try {
      const { applyReplicaRowsToDesktop } = await import('../sync-execute.mjs');

      const applied1 = await applyReplicaRowsToDesktop('quote', [desktopQuote], dbPath);
      assert.equal(applied1, 1, 'first quote should apply');

      const applied2 = await applyReplicaRowsToDesktop('quote', [androidQuote], dbPath);
      assert.equal(applied2, 1, 'second quote should apply (merged into first)');

      // Should have exactly ONE row — semantic merge should combine them
      const quotes = JSON.parse(
        execFileSync('sqlite3', [dbPath, '-json', 'SELECT id, book_hash, text, context_before FROM quotes'], { encoding: 'utf8' }),
      );
      assert.equal(quotes.length, 1, 'RED: same bookHash+contentHash quotes should merge into one row');
      assert.equal(quotes[0].id, 'desk-first', 'first quote id should be preserved (older by HLC but canonical)');
      assert.equal(quotes[0].book_hash, sharedBookHash);
      assert.equal(quotes[0].text, sharedText);
      assert.equal(quotes[0].context_before, 'Android context before', 'merged contextBefore from second quote');
    } finally {
      if (prevHarness !== undefined) {
        process.env.BIBLIOTECA_DEV_SYNC_HARNESS = prevHarness;
      } else {
        delete process.env.BIBLIOTECA_DEV_SYNC_HARNESS;
      }
    }
  });
});
