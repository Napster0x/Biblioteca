# Tasks: Fix Semantic Dedup Sync

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~210 (~60 prod, ~150 test) |
| 400-line budget risk | Low |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Schema + Keys) → PR 2 (Pipeline Wiring) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema fix + semantic key extension + standalone module changes | PR 1 | Base: main. ~50 lines. Tests included. |
| 2 | Wire kind in push/pull loops + integration tests | PR 2 | Base: main. ~160 lines. Depends on PR 1 but merges direct to main. |

## Phase 1: Schema & Key Computation (Slice 1 — PR 1)

- [x] 1.1 **RED**: Write failing tests for `computeSemanticKey` quote/occurrence/annotation, and `ensureReplicaTables` quotes DDL missing `replica_timestamps`
- [x] 1.2 Extend `computeSemanticKey(row, kind)` in `sync-filter-standalone.mjs` with if/else chain for all 4 kinds
- [x] 1.3 Add `kind` param to `newerOrEqualSemanticReplicaExists(dbPath, key, ts, kind)` and use it in WHERE clause
- [x] 1.4 Change `filterUnchangedReplicas` pass-2 guard from `kind === 'dictionary-entry'` to `if (kind)`; forward kind to `computeSemanticKey` + `newerOrEqualSemanticReplicaExists`
- [x] 1.5 Change `writeReplicaMetadata` guard to `row.kind && row?.fields_jsonb ? computeSemanticKey(row, row.kind) : null`
- [x] 1.6 Add `replica_timestamps TEXT` to quotes DDL + `maybeAddReplicaTimestampsToQuotes` migration in `ensureReplicaTables`
- [x] 1.7 Remove `kind === 'quote' ? null :` guard in `upsertVisibleRow` (line 196); always compute `replicaTimestampJson(row)`

## Phase 2: Sync Pipeline Wiring (Slice 2 — PR 2)

- [x] 2.1 **RED**: Write failing tests for push-side (occurrence/quote/annotation) and pull-side (all 4 kinds) kind pass-through
- [x] 2.2 Push side: pass `'dictionary-occurrence'` to `filterUnchangedReplicas` at line 676
- [x] 2.3 Push side: pass `'quote'` to `filterUnchangedReplicas` at line 687
- [x] 2.4 Push side: pass `'annotation'` to `filterUnchangedReplicas` at line 698
- [x] 2.5 Pull side: pass `kind` from loop variable at line 708
- [x] 2.6 Add `replica_timestamps` to quotes INSERT column list and VALUES in `upsertVisibleRow`
- [x] 2.7 **GREEN**: Verify all 52 tests pass (combine with Slice 1's 43)
