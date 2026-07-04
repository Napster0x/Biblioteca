#!/usr/bin/env node

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { softDeleteRow, updateRow } from '../sync-dev-sqlite.mjs';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'biblioteca-sync-sqlite-'));
  const dbPath = join(dir, 'test.db');
  try {
    execFileSync('sqlite3', [dbPath, `
      CREATE TABLE dictionary_entries (
        id TEXT PRIMARY KEY,
        term TEXT,
        definition TEXT,
        language TEXT,
        updated_at INTEGER,
        deleted_at INTEGER,
        replica_timestamps TEXT
      );
      INSERT INTO dictionary_entries (id, term, definition, language, updated_at, deleted_at, replica_timestamps)
      VALUES ('entry-1', 'old term', 'old definition', 'es', 100, NULL, '{"updated":"T100"}');
    `], { encoding: 'utf8', stdio: 'pipe' });
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readRows(dbPath, sql) {
  const raw = execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8', stdio: 'pipe' });
  return JSON.parse(raw);
}

describe('updateRow', () => {
  it('updates the specified field', () => {
    withTempDb((dbPath) => {
      const result = updateRow({
        dbPath,
        execFileSync,
        table: 'dictionary_entries',
        rowId: 'entry-1',
        updates: { definition: 'new definition' },
      });

      assert.deepEqual(result, { ok: true, table: 'dictionary_entries', rowId: 'entry-1' });
      const [row] = readRows(dbPath, 'SELECT definition, term, updated_at, replica_timestamps FROM dictionary_entries WHERE id = \'entry-1\'');
      assert.equal(row.definition, 'new definition');
      assert.equal(row.term, 'old term');
      assert.notEqual(row.updated_at, 100);
      assert.match(row.replica_timestamps, /"updated":"T\d+"/);
    });
  });

  it('updates multiple specified fields atomically', () => {
    withTempDb((dbPath) => {
      updateRow({
        dbPath,
        execFileSync,
        table: 'dictionary_entries',
        rowId: 'entry-1',
        updates: { term: 'new term', language: 'en' },
      });

      const [row] = readRows(dbPath, 'SELECT term, language, definition FROM dictionary_entries WHERE id = \'entry-1\'');
      assert.deepEqual(row, { term: 'new term', language: 'en', definition: 'old definition' });
    });
  });

  it('updates rows with an explicit HLC string without generating invalid SQL', () => {
    withTempDb((dbPath) => {
      const hlc = '001905a2fcb00-00000001-visible';
      const result = updateRow({
        dbPath,
        execFileSync,
        table: 'dictionary_entries',
        rowId: 'entry-1',
        updates: { definition: 'hlc string definition' },
        hlcTimestamp: hlc,
      });

      assert.deepEqual(result, { ok: true, table: 'dictionary_entries', rowId: 'entry-1' });
      const [row] = readRows(dbPath, 'SELECT definition, updated_at, replica_timestamps FROM dictionary_entries WHERE id = \'entry-1\'');
      assert.equal(row.definition, 'hlc string definition');
      assert.equal(row.updated_at, hlc);
      assert.equal(JSON.parse(row.replica_timestamps).updated, `T${hlc}`);
    });
  });

  it('throws when the target row does not exist', () => {
    withTempDb((dbPath) => {
      assert.throws(
        () => updateRow({
          dbPath,
          execFileSync,
          table: 'dictionary_entries',
          rowId: 'missing-entry',
          updates: { definition: 'will not apply' },
        }),
        /Row not found: dictionary_entries\.missing-entry/,
      );
    });
  });
});

describe('softDeleteRow', () => {
  it('sets deleted_at_ts-compatible deleted_at and replica timestamp', () => {
    withTempDb((dbPath) => {
      const result = softDeleteRow({
        dbPath,
        execFileSync,
        table: 'dictionary_entries',
        rowId: 'entry-1',
      });

      assert.deepEqual(result, { ok: true, table: 'dictionary_entries', rowId: 'entry-1', deleted: true });
      const [row] = readRows(dbPath, 'SELECT deleted_at, updated_at, replica_timestamps FROM dictionary_entries WHERE id = \'entry-1\'');
      assert.equal(typeof row.deleted_at, 'number');
      assert.equal(row.updated_at, row.deleted_at);
      assert.match(row.replica_timestamps, /"deleted":"T\d+"/);
    });
  });

  it('is idempotent enough for repeated deletes', () => {
    withTempDb((dbPath) => {
      const first = softDeleteRow({ dbPath, execFileSync, table: 'dictionary_entries', rowId: 'entry-1' });
      const second = softDeleteRow({ dbPath, execFileSync, table: 'dictionary_entries', rowId: 'entry-1' });

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      const rows = readRows(dbPath, 'SELECT count(*) AS c, deleted_at FROM dictionary_entries WHERE id = \'entry-1\' AND deleted_at IS NOT NULL');
      assert.equal(rows[0].c, 1);
      assert.equal(typeof rows[0].deleted_at, 'number');
    });
  });

  it('soft-deletes rows with an explicit HLC string without generating invalid SQL', () => {
    withTempDb((dbPath) => {
      const hlc = '001905a2fcb00-00000001-visible';
      const result = softDeleteRow({
        dbPath,
        execFileSync,
        table: 'dictionary_entries',
        rowId: 'entry-1',
        hlcTimestamp: hlc,
      });

      assert.deepEqual(result, { ok: true, table: 'dictionary_entries', rowId: 'entry-1', deleted: true });
      const [row] = readRows(dbPath, 'SELECT deleted_at, updated_at, replica_timestamps FROM dictionary_entries WHERE id = \'entry-1\'');
      assert.equal(row.deleted_at, hlc);
      assert.equal(row.updated_at, hlc);
      assert.equal(JSON.parse(row.replica_timestamps).deleted, `T${hlc}`);
    });
  });

  it('throws when the target row does not exist', () => {
    withTempDb((dbPath) => {
      assert.throws(
        () => softDeleteRow({
          dbPath,
          execFileSync,
          table: 'dictionary_entries',
          rowId: 'missing-entry',
        }),
        /Row not found: dictionary_entries\.missing-entry/,
      );
    });
  });
});
