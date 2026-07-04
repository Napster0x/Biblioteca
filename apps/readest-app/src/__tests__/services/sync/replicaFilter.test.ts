/**
 * Tests for replicaFilter.ts — shared TS module for replica dedup.
 *
 * Mirrors the Rust test vectors so both implementations produce identical results.
 * Run with: pnpm exec vitest run src/__tests__/services/sync/replicaFilter.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReplicaRow, Hlc } from '@/types/replica';

import {
  normalizeTerm,
  computeSemanticKey,
  filterUnchangedReplicas,
  writeReplicaMetadata,
  ensureReplicaTables,
  __setExecFileSync,
} from '@/services/sync/replicaFilter';

// ── Helpers ────────────────────────────────────────────────────────────

function makeHlc(ms: number, counter = 1, device = 'test'): Hlc {
  return `${ms.toString(16).padStart(13, '0')}-${counter.toString(16).padStart(8, '0')}-${device}` as Hlc;
}

const dbPath = '/tmp/test-readest/dictionary.db';

/** Create a mock execFileSync based on SQL pattern handlers. */
function createMockSqlite(handlers: Record<string, string>) {
  return vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
    const sql = args[args.length - 1]; // SQL is always the last arg
    for (const [pattern, result] of Object.entries(handlers)) {
      if (sql.includes(pattern)) return result;
    }
    return '[]\n';
  });
}

/** Build a minimal ReplicaRow for testing. */
function makeRow(
  overrides: Partial<ReplicaRow> & { replica_id: string; updated_at_ts: Hlc },
): ReplicaRow {
  return {
    user_id: 'test-user',
    kind: 'dictionary-entry',
    fields_jsonb: {},
    manifest_jsonb: null,
    deleted_at_ts: null,
    reincarnation: null,
    schema_version: 1,
    ...overrides,
  };
}

// ── Tests: normalizeTerm ───────────────────────────────────────────────

describe('normalizeTerm', () => {
  it('normalizes to lowercase', () => {
    expect(normalizeTerm('Hello')).toBe('hello');
  });

  it('preserves NFC composed characters', () => {
    expect(normalizeTerm('Café')).toBe('café');
  });

  it('strips soft hyphens (U+00AD)', () => {
    expect(normalizeTerm('hell\u{00AD}o')).toBe('hello');
  });

  it('returns empty string for null input', () => {
    expect(normalizeTerm(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(normalizeTerm(undefined)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(normalizeTerm('')).toBe('');
  });
});

// ── Tests: computeSemanticKey ──────────────────────────────────────────

describe('computeSemanticKey', () => {
  it('returns null when fields_jsonb is undefined', () => {
    expect(computeSemanticKey({}, 'dictionary-entry')).toBeNull();
  });

  it('returns null when term is missing', () => {
    expect(
      computeSemanticKey({ fields_jsonb: { language: { v: 'en' } } }, 'dictionary-entry'),
    ).toBeNull();
  });

  it('returns null when term is empty string', () => {
    expect(
      computeSemanticKey(
        { fields_jsonb: { term: { v: '' }, language: { v: 'en' } } },
        'dictionary-entry',
      ),
    ).toBeNull();
  });

  it('returns null when term is white-space only', () => {
    expect(
      computeSemanticKey(
        { fields_jsonb: { term: { v: '   ' }, language: { v: 'en' } } },
        'dictionary-entry',
      ),
    ).toBeNull();
  });

  it('returns null when term is a non-string value', () => {
    expect(
      computeSemanticKey({ fields_jsonb: { term: { v: 42 } } }, 'dictionary-entry'),
    ).toBeNull();
  });

  it('returns key with term and language', () => {
    const key = computeSemanticKey(
      {
        fields_jsonb: { term: { v: 'Hello' }, language: { v: 'en' } },
      },
      'dictionary-entry',
    );
    expect(key).toBe('hello|en');
  });

  it('returns key with term only (language defaults to empty)', () => {
    const key = computeSemanticKey({ fields_jsonb: { term: { v: 'Hello' } } }, 'dictionary-entry');
    expect(key).toBe('hello|');
  });

  it('normalizes both term and language', () => {
    const key = computeSemanticKey(
      {
        fields_jsonb: { term: { v: 'Café' }, language: { v: 'FR' } },
      },
      'dictionary-entry',
    );
    expect(key).toBe('café|fr');
  });

  it('strips soft hyphens from both term and language', () => {
    const key = computeSemanticKey(
      {
        fields_jsonb: { term: { v: 'hell\u{00AD}o' }, language: { v: 'e\u{00AD}n' } },
      },
      'dictionary-entry',
    );
    expect(key).toBe('hello|en');
  });
});

// ── Tests: newerOrEqualReplicaExists & newerOrEqualSemanticReplicaExists ──
// These are tested via filterUnchangedReplicas which exercises them internally.

describe('filterUnchangedReplicas', () => {
  const hlc100 = makeHlc(100);
  const hlc200 = makeHlc(200);
  const hlc300 = makeHlc(300);

  beforeEach(() => {
    __setExecFileSync(null);
  });

  it('returns all rows when _replicas table does not exist', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'": '[]\n',
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({ replica_id: 'r1', updated_at_ts: hlc100 }),
      makeRow({ replica_id: 'r2', updated_at_ts: hlc200 }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'dictionary-entry');
    expect(result).toHaveLength(2);
    expect(result[0].replica_id).toBe('r1');
    expect(result[1].replica_id).toBe('r2');
  });

  it('removes rows with exact replica_id match and equal HLC', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r1'":
          JSON.stringify([{ updated_at_ts: hlc100 }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r2'": '[]\n',
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({ replica_id: 'r1', kind: 'dictionary-entry', updated_at_ts: hlc100 }),
      makeRow({ replica_id: 'r2', kind: 'dictionary-entry', updated_at_ts: hlc200 }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'dictionary-entry');
    // r1: exists with equal HLC (100 >= 100) → removed
    // r2: no match in _replicas → kept
    expect(result).toHaveLength(1);
    expect(result[0].replica_id).toBe('r2');
  });

  it('removes rows with exact replica_id match and higher stored HLC', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r1'":
          JSON.stringify([{ updated_at_ts: hlc300 }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r2'": '[]\n',
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({ replica_id: 'r1', kind: 'annotation', updated_at_ts: hlc100 }),
      makeRow({ replica_id: 'r2', kind: 'annotation', updated_at_ts: hlc200 }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'annotation');
    // r1: stored HLC 300 > incoming 100 → removed
    // r2: no match → kept
    expect(result).toHaveLength(1);
    expect(result[0].replica_id).toBe('r2');
  });

  it('keeps rows with newer incoming HLC (incoming wins)', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r1'":
          JSON.stringify([{ updated_at_ts: hlc100 }]) + '\n',
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({ replica_id: 'r1', kind: 'annotation', updated_at_ts: hlc200 }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'annotation');
    // r1: incoming HLC 200 > stored 100 → kept (newer incoming)
    expect(result).toHaveLength(1);
    expect(result[0].replica_id).toBe('r1');
  });

  // ── Semantic key dedup (dict-entry only) ──

  it('removes dict-entry rows with same semantic_key and equal HLC', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
        // Pass 1: no replica_id match
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r1'": '[]\n',
        // Pass 2: semantic match found with equal HLC
        "SELECT updated_at_ts FROM _replicas WHERE semantic_key = 'hello|en'":
          JSON.stringify([{ updated_at_ts: hlc100 }]) + '\n',
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({
        replica_id: 'r1',
        kind: 'dictionary-entry',
        updated_at_ts: hlc100,
        fields_jsonb: {
          term: { v: 'Hello', t: hlc100, s: 'test' },
          language: { v: 'en', t: hlc100, s: 'test' },
        },
      }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'dictionary-entry');
    // Pass 1: no replica_id match → keep
    // Pass 2: semantic_key 'hello|en' exists with equal HLC → removed
    expect(result).toHaveLength(0);
  });

  it('keeps dict-entry rows with same semantic_key but newer incoming HLC', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r1'": '[]\n',
        "SELECT updated_at_ts FROM _replicas WHERE semantic_key = 'hello|en'":
          JSON.stringify([{ updated_at_ts: hlc100 }]) + '\n',
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({
        replica_id: 'r1',
        kind: 'dictionary-entry',
        updated_at_ts: hlc200,
        fields_jsonb: {
          term: { v: 'Hello', t: hlc200, s: 'test' },
          language: { v: 'en', t: hlc200, s: 'test' },
        },
      }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'dictionary-entry');
    // Incoming HLC 200 > stored 100 → kept
    expect(result).toHaveLength(1);
    expect(result[0].replica_id).toBe('r1');
  });

  it('does not apply semantic pass for non-dict-entry kinds', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
        "SELECT updated_at_ts FROM _replicas WHERE replica_id = 'r1'": '[]\n',
        // Even if semantic_key would match, non-dict-entry kinds skip pass 2
      }),
    );

    const rows: ReplicaRow[] = [
      makeRow({
        replica_id: 'r1',
        kind: 'annotation',
        updated_at_ts: hlc100,
        fields_jsonb: {
          term: { v: 'Hello', t: hlc100, s: 'test' },
          language: { v: 'en', t: hlc100, s: 'test' },
        },
      }),
    ];

    const result = filterUnchangedReplicas(dbPath, rows, 'annotation');
    // Annotation kind → no semantic pass → kept
    expect(result).toHaveLength(1);
  });

  it('handles empty array gracefully', () => {
    __setExecFileSync(
      createMockSqlite({
        "FROM sqlite_master WHERE type = 'table' AND name = '_replicas'":
          JSON.stringify([{ name: '_replicas' }]) + '\n',
      }),
    );

    const result = filterUnchangedReplicas(dbPath, [], 'dictionary-entry');
    expect(result).toHaveLength(0);
  });
});

// ── Tests: writeReplicaMetadata ────────────────────────────────────────

describe('writeReplicaMetadata', () => {
  const hlc200 = makeHlc(200);

  beforeEach(() => {
    __setExecFileSync(null);
  });

  it('computes semantic_key for dictionary-entry rows', () => {
    let capturedSql = '';
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        capturedSql = args[args.length - 1];
        return '';
      }),
    );

    const row = makeRow({
      replica_id: 'dict:abc',
      kind: 'dictionary-entry',
      updated_at_ts: hlc200,
      fields_jsonb: {
        term: { v: 'Hello', t: hlc200, s: 'test' },
        language: { v: 'en', t: hlc200, s: 'test' },
      },
    });

    writeReplicaMetadata(dbPath, row);

    // Verify INSERT OR REPLACE includes semantic_key 'hello|en'
    expect(capturedSql).toContain('INSERT OR REPLACE INTO _replicas');
    expect(capturedSql).toContain("'hello|en'");
    expect(capturedSql).toContain("'dict:abc'");
    expect(capturedSql).toContain("'dictionary-entry'");
  });

  it('sets semantic_key to NULL for non-dict-entry rows', () => {
    let capturedSql = '';
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        capturedSql = args[args.length - 1];
        return '';
      }),
    );

    const row = makeRow({
      replica_id: 'ann:xyz',
      kind: 'annotation',
      updated_at_ts: hlc200,
      fields_jsonb: { bookHash: { v: 'abc', t: hlc200, s: 'test' } },
    });

    writeReplicaMetadata(dbPath, row);

    // semantic_key is NULL for annotation
    expect(capturedSql).toContain('INSERT OR REPLACE INTO _replicas');
    expect(capturedSql).toContain('NULL');
    expect(capturedSql).toContain("'ann:xyz'");
    expect(capturedSql).toContain("'annotation'");
  });

  it('handles null fields_jsonb gracefully', () => {
    let capturedSql = '';
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        capturedSql = args[args.length - 1];
        return '';
      }),
    );

    const row = makeRow({
      replica_id: 'dict:null-fields',
      kind: 'dictionary-entry',
      updated_at_ts: hlc200,
      fields_jsonb: {} as never, // empty fields
    });

    writeReplicaMetadata(dbPath, row);

    expect(capturedSql).toContain('INSERT OR REPLACE INTO _replicas');
    // No semantic_key computed (no term in fields_jsonb)
  });
});

// ── Tests: ensureReplicaTables ─────────────────────────────────────────

describe('ensureReplicaTables', () => {
  beforeEach(() => {
    __setExecFileSync(null);
  });

  it('creates _replicas table and app table for dictionary-entry', () => {
    const executedSqls: string[] = [];
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        executedSqls.push(args[args.length - 1]);
        // For PRAGMA check, return existing columns
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'semantic_key' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    ensureReplicaTables(dbPath, 'dictionary-entry');

    const allSql = executedSqls.join(' ');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS _replicas');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS dictionary_entries');
    expect(allSql).toContain('CREATE INDEX IF NOT EXISTS idx_replicas_kind_updated_at');
  });

  it('creates _replicas table and app table for annotation', () => {
    const executedSqls: string[] = [];
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        executedSqls.push(args[args.length - 1]);
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'semantic_key' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    ensureReplicaTables(dbPath, 'annotation');

    const allSql = executedSqls.join(' ');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS _replicas');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS annotations');
  });

  it('creates _replicas table and app table for quote', () => {
    const executedSqls: string[] = [];
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        executedSqls.push(args[args.length - 1]);
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'semantic_key' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    ensureReplicaTables(dbPath, 'quote');

    const allSql = executedSqls.join(' ');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS _replicas');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS quotes');
  });

  it('creates _replicas table and app table for dictionary-occurrence', () => {
    const executedSqls: string[] = [];
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        executedSqls.push(args[args.length - 1]);
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'semantic_key' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    ensureReplicaTables(dbPath, 'dictionary-occurrence');

    const allSql = executedSqls.join(' ');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS _replicas');
    expect(allSql).toContain('CREATE TABLE IF NOT EXISTS dictionary_occurrences');
  });

  it('migrates semantic_key column if missing', () => {
    const executedSqls: string[] = [];
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        executedSqls.push(args[args.length - 1]);
        // PRAGMA returns columns WITHOUT semantic_key
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'replica_id' }, { name: 'kind' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    ensureReplicaTables(dbPath, 'dictionary-entry');

    const allSql = executedSqls.join(' ');
    expect(allSql).toContain('ALTER TABLE _replicas ADD COLUMN semantic_key TEXT');
  });

  it('is idempotent when called twice', () => {
    let callCount = 0;
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        callCount++;
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'semantic_key' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    ensureReplicaTables(dbPath, 'dictionary-entry');
    const firstCount = callCount;

    ensureReplicaTables(dbPath, 'dictionary-entry');
    // Second call should execute same number of SQL statements (no error)
    expect(callCount).toBe(firstCount * 2);
  });

  it('does not throw for unknown kind', () => {
    __setExecFileSync(
      vi.fn((_cmd: string, args: readonly string[], _opts?: { encoding?: string }) => {
        if (args[args.length - 1].includes('PRAGMA table_info')) {
          return JSON.stringify([{ name: 'semantic_key' }]) + '\n';
        }
        return '[]\n';
      }),
    );

    expect(() => ensureReplicaTables(dbPath, 'unknown-kind')).not.toThrow();
  });
});
