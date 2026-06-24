# Design: Fix Caso 8 — Sync Idempotence

## Technical Approach

Surgical ~15-line change in `sync-execute.mjs`. Add `filterUnchangedReplicas(dbPath, replicas)` before each of the four `putReplicas()` calls in `main()`. The helper reuses existing `newerOrEqualReplicaExists()` and `tableExists()` to skip replicas already present in Desktop `_replicas` with equal-or-higher `updated_at_ts`. After each successful push, write `_replicas` metadata immediately via existing `writeReplicaMetadata()`. No Android-side changes. No new abstractions.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Filter before each `putReplicas()` (surgical) | Minimal diff; reuses existing helpers; no new abstractions | **Chosen** |
| Phase-separated cursor with pre-sync snapshot | More explicit; adds cursor tracking; over-engineered for scope | Rejected |
| Android-side `since` parameter for pull | Fixes pull echo, not push over-send; adds complexity | Rejected |

**Rationale**: The primary root cause is push sending all rows every sync. A pre-push filter is the minimal, direct fix. It reuses proven infrastructure and keeps the change reversible.

## Data Flow

```
readVisibleRows() ─→ filterUnchangedReplicas(dbPath, replicas)
    │                        │
    │                  tableExists('_replicas')?
    │                   ├── no  → return all (bootstrapping)
    │                   └── yes → filter via newerOrEqualReplicaExists()
    │                        │
    └── filtered rows ──→ putReplicas() ──→ after success: ensureDesktopReplicaTables() + writeReplicaMetadata() per row
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Add `filterUnchangedReplicas()` helper (~8 lines). Apply filter before each `putReplicas()` call in `main()`. Write `_replicas` metadata post-push. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | Add RED-phase idempotence test: first sync pushes all, second sync pushes zero. Add modified-row re-push test. |

## filterUnchangedReplicas Signature and Location

```
function filterUnchangedReplicas(dbPath, replicas)   → inserted after line 296 (before main)
  if !tableExists(dbPath, '_replicas') → return replicas;   // bootstrapping
  return replicas.filter(r => !newerOrEqualReplicaExists(dbPath, r.replica_id, r.updated_at_ts));
```

`newerOrEqualReplicaExists` (line 215) is reused without modification — it does a HLC string `>=` comparison which is correct for lexicographic-ordered HLCs. `tableExists` (line 113) guards against missing `_replicas` table on first sync.

Filter application in `main()` — before each `putReplicas()`:
- Line ~456: `dictionaryRows.entries` filtered via `desktopReplicaDbPath(dataRoot, 'dictionary-entry')`
- Line ~457: `dictionaryRows.occurrences` filtered via same dbPath
- Line ~462: `quoteRows` filtered via `desktopReplicaDbPath(dataRoot, 'quote')`
- Line ~467: `annotationRows` filtered via `desktopReplicaDbPath(dataRoot, 'annotation')`

## _replicas Write After Push

After each successful `putReplicas()`, write `_replicas` for every pushed row. Pattern per kind:
```
const dbPath = desktopReplicaDbPath(env.desktop.dataRoot, kind);
ensureDesktopReplicaTables(dbPath, kind);  // ensures _replicas exists
for (const row of filteredRows) writeReplicaMetadata(dbPath, row);
```

All required fields (`replica_id`, `kind`, `user_id`, `fields_jsonb`, `updated_at_ts`, etc.) are present in the replica rows produced by `rowToReplica()`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (RED) | Sync idempotence: run sync-execute twice, assert second run produces 0/0 per kind | `spawnNode` + mock server, seed Desktop DB with `createDictionaryReplicaDb`-style fixtures |
| Integration (RED) | First sync bootstrapping: empty `_replicas` still pushes all rows | Same harness, verify first sync attempted != 0 |
| Integration (RED) | Modified row re-push: change a row's timestamp between syncs, verify only that row re-pushes | Inject modified `updated_at` in visible row between syncs |

**New describe block**: `'sync-execute idempotence'` with three test cases. Uses existing pattern: `spawnNode(syncExecuteScript, ...)`, mock HTTP server, `parseLastJsonObject()`, `replicaPuts` capture array.

## Edge Cases

| Edges | Handling |
|-------|----------|
| Empty `_replicas` on first sync | `tableExists` guard returns all replicas unfiltered — correct bootstrapping |
| Dictionary-occurrence ordering | `putReplicas` entry before occurrence preserved; filter operates independently per kind |
| Quote vs annotation kind separation | `desktopReplicaDbPath()` maps to separate DB files (`citas.db`, `annotations.db`); filter scoped per dbPath |
| Newer HLC on Desktop (row was modified after last pull) | `newerOrEqualReplicaExists` returns false → row passes filter → re-pushed correctly |
| Identical HLC (no change) | `newerOrEqualReplicaExists` returns true → row skipped → idempotent |
| `_replicas` table missing after push | `ensureDesktopReplicaTables` called before metadata write; idempotent DDL |

## Open Questions

None.
