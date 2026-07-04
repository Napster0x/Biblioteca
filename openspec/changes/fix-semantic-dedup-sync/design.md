# Design: Fix Semantic Dedup Sync

## Technical Approach

Wire the existing `computeSemanticKey()` / `filterUnchangedReplicas()` dedup pipeline into ALL push/pull calls in `sync-execute.mjs`, extend `computeSemanticKey` to handle 3 additional replica kinds, fix the quotes DDL to include `replica_timestamps`, and add ~5-6 failing tests first (strict TDD). No new modules. No logic rewrites. Pure wiring + extension.

**Decision record**: every change below is 1:1 traceable to scenarios in `semantic-dedup-sync/spec.md`.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| Semantic key branching | `computeSemanticKey(row, kind)` with if/else chain per kind | Generic hash-of-fields; separate key functions per kind | Explicit per-kind formula is traceable to spec. Hash collisions risk convergence bugs. |
| Kind column in semantic WHERE | Pass `kind` to `newerOrEqualSemanticReplicaExists` to filter `WHERE semantic_key = ? AND kind = ?` | Omit kind; global uniqueness of keys | Key overlap across kinds (identical `book_hash\|cfi\|text` for quote vs annotation) would collapse distinct data. Kind disambiguation is required. |
| Quotes schema fix | Add `replica_timestamps TEXT` to DDL + ALTER TABLE migration | Leave null; only fix in new DBs | Existing citas.db on real devices need migration. Without it, `upsertVisibleRow` for quotes drops field-level HLC timestamps, breaking convergence. |
| `upsertVisibleRow` quotes | Remove `kind === 'quote' ? null` guard, compute `replicaTimestampJson(row)` for all kinds | Keep null and add no-op | Same rationale: field-level HLC preservation for convergence. |
| Pass 2 semantic dedup guard | `if (kind)` instead of `if (kind === 'dictionary-entry')` in `filterUnchangedReplicas` | Guard per kind; no guard | Minimal change: if kind is falsy (legacy/undefined), semantic dedup is skipped. If truthy, compute + match for all kinds. |

## Data Flow

```
sync-execute.mjs push/pull loops
    │
    ├── filterUnchangedReplicas(dbPath, rows, kind)
    │       │
    │       ├── Pass 1: newerOrEqualReplicaExists    (all kinds, exact replica_id)
    │       └── Pass 2: newerOrEqualSemanticReplicaExists  (all kinds, semantic_key + kind)
    │               │
    │               ├── computeSemanticKey(row, kind)
    │               │     ├── 'dictionary-entry'       → normalizeTerm(term)|normalizeTerm(language)
    │               │     ├── 'dictionary-occurrence'  → entryId|bookHash|cfi
    │               │     ├── 'quote'                  → bookHash|cfi|contentHash
    │               │     └── 'annotation'             → bookHash|cfi|text
    │               │
    │               └── WHERE semantic_key = ? AND kind = ?  (parameterized, not hardcoded)
    │
    └── writeReplicaMetadata(dbPath, row)
            └── computeSemanticKey(row, row.kind)  → persisted in _replicas.semantic_key
```

## File Changes

### 1. `apps/readest-app/scripts/sync-filter-standalone.mjs` (modify — 7 hunks)

| Lines | Change |
|-------|--------|
| 34–40 | `computeSemanticKey(row)` → `computeSemanticKey(row, kind)`. Add if/else chain for 4 kinds. |
| 84–88 | `newerOrEqualSemanticReplicaExists(dbPath, key, ts)` → add `kind` param, use it in `WHERE kind = ${sqlValue(kind)}`. |
| 99–111 | `filterUnchangedReplicas`: remove `kind === 'dictionary-entry'` guard on pass 2. Change to `if (kind)`. Also forward `kind` to `computeSemanticKey(r, kind)` and `newerOrEqualSemanticReplicaExists(dbPath, sk, r.updated_at_ts, kind)`. |
| 117–120 | `writeReplicaMetadata`: remove `kind === 'dictionary-entry'` guard. Change to `row.kind && row?.fields_jsonb ? computeSemanticKey(row, row.kind) : null`. |
| 150–156 | Add `replica_timestamps TEXT` to quotes DDL after `content_hash`. |
| 172–184 | In `ensureReplicaTables`: after `maybeAddSemanticKeyColumn`, add `if (kind === 'quote') maybeAddReplicaTimestampsToQuotes(dbPath)`. |
| New (after 199) | Add `maybeAddReplicaTimestampsToQuotes(dbPath)` — PRAGMA table_info check + ALTER TABLE ADD COLUMN. |

### 2. `apps/readest-app/scripts/sync-execute.mjs` (modify — 4 hunks)

| Lines | Change |
|-------|--------|
| 196 | Remove `kind === 'quote' ? null :` — always compute `replicaTimestampJson(row)`. |
| 224–231 | Add `replica_timestamps` to quotes INSERT column list and VALUES. |
| 676 | `filterUnchangedReplicas(dictDbPath, dictionaryRows.occurrences)` → add `'dictionary-occurrence'`. |
| 687 | `filterUnchangedReplicas(quoteDbPath, quoteRows)` → add `'quote'`. |
| 698 | `filterUnchangedReplicas(annotationDbPath, annotationRows)` → add `'annotation'`. |
| 708 | `filterUnchangedReplicas(dbPath, rows)` → add `kind` from loop variable. |

### 3. `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` (modify — add tests)

| Tests | What |
|-------|------|
| `computeSemanticKey` for quote | row with bookHash/cfi/contentHash → `'abc\|/2/4\|hash123'` |
| `computeSemanticKey` for occurrence | row with entryId/bookHash/cfi → `'e1\|abc\|/2/4'` |
| `computeSemanticKey` for annotation | row with bookHash/cfi/text → `'abc\|/2/4\|my text'` |
| `computeSemanticKey` returns null for missing fields | Each kind, row without required fields |
| `filterUnchangedReplicas` without kind (current broken) | Semantic duplicates pass through for non-dict-entry kinds |
| `filterUnchangedReplicas` with kind (fixed) | Semantic duplicates filtered for quote/occurrence/annotation |
| Quotes DDL includes replica_timestamps | Fresh DB from `ensureReplicaTables` checked via PRAGMA |

## Interfaces / Contracts

### `computeSemanticKey(row, kind)`

| Param | Type | Description |
|-------|------|-------------|
| `row` | `object` | Replica row with `fields_jsonb` |
| `kind` | `string` | One of `dictionary-entry`, `dictionary-occurrence`, `quote`, `annotation` |
| Returns | `string \| null` | Pipe-delimited key, or null if missing required fields |

### `newerOrEqualSemanticReplicaExists(dbPath, semanticKey, updatedAtTs, kind)`

| Param | Type | Description |
|-------|------|-------------|
| `dbPath` | `string` | Path to sqlite DB |
| `semanticKey` | `string` | Computed semantic key |
| `updatedAtTs` | `string` | HLC timestamp to compare |
| `kind` | `string` | Replica kind for WHERE clause disambiguation |
| Returns | `boolean` | Whether a newer-or-equal row exists with same semantic_key AND kind |

### Output: quotes table schema (migrated)

```sql
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT, cfi TEXT,
  section_href TEXT, page INTEGER, text TEXT, context_before TEXT, context_after TEXT,
  content_hash TEXT, replica_timestamps TEXT,
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER
);
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `computeSemanticKey` for all 4 kinds | Pure function, no DB needed. Test valid input → key, missing field → null. |
| Unit | `filterUnchangedReplicas` kind pass-through | Temp sqlite DB with seeded _replicas. Call with/without kind; assert filter behavior. |
| Unit | Quotes DDL + migration | Temp sqlite DB. Call `ensureReplicaTables('quote')`, check PRAGMA table_info. Then manually CREATE a quotes table without replica_timestamps, call again, verify migration. |
| Integration | Push pipeline kind wiring | Import `sync-execute.mjs` functions, verify kind reaches `filterUnchangedReplicas`. |
| Harness | Cases 16–17 on real device | Run `dev-sync-fixture --case16` and `--case17` after code changes. |

## Slicing Recommendation

The change is ~210 lines total (~60 prod, ~150 test). Auto-chain stacked-to-main as configured. Two slices:

| Slice | Scope | Est. lines |
|-------|-------|-----------|
| 1 | `sync-filter-standalone.mjs`: extend `computeSemanticKey`, `filterUnchangedReplicas`, `writeReplicaMetadata` + `newerOrEqualSemanticReplicaExists` for all 4 kinds. Fix quotes DDL + migration. | ~50 |
| 2 | `sync-execute.mjs`: wire kind in all 4 push calls + pull loop + fix `upsertVisibleRow` quotes. All new tests in `sync-execute.test.mjs`. | ~160 |

## Migration / Rollout

- **Quotes schema**: ALTER TABLE migration for existing citas.db. Fresh DBs get the correct DDL via `CREATE TABLE IF NOT EXISTS`.
- **Reversibility**: Revert sync-execute.mjs and sync-filter-standalone.mjs to undo all behavior changes. The quotes DDL migration is additive (ADD COLUMN) — rolling back does not require removing the column.

## Open Questions

- None. All spec scenarios are fully resolved in the decisions above.

---

## Key Learnings

- `computeSemanticKey` currently ignores the `kind` parameter entirely — it's a **breaking call signature change** that must be coordinated with all callers in both `.mjs` files.
- `newerOrEqualSemanticReplicaExists` hardcodes `kind = 'dictionary-entry'` in SQL — extending it without the WHERE clause would cause **cross-kind semantic key collisions** (e.g., a quote `bookHash|cfi|text` matching an annotation with the same values).
- Quotes DDL is the ONLY app table missing `replica_timestamps`. The `annotation` table already has it. This is likely an oversight from when quotes were added later than the other 3 replica kinds.
- The `upsertVisibleRow` function (line 196) explicitly sets timestamps to `null` for quotes as a workaround for the missing column — removing this workaround is tied to the schema fix.
