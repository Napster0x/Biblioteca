# Apply Progress: fix-semantic-dedup-sync — Complete (Slice 1 + Slice 2)

**Mode**: Strict TDD
**Delivery**: auto-chain, stacked-to-main
**Slices**: PR 1 of 2 (Schema & Key Computation) + PR 2 of 2 (Pipeline Wiring)

## Completed Tasks

### Phase 1: Schema & Key Computation (Slice 1)
- [x] 1.1 **RED**: Write failing tests for `computeSemanticKey` quote/occurrence/annotation, and `ensureReplicaTables` quotes DDL missing `replica_timestamps`
- [x] 1.2 Extend `computeSemanticKey(row, kind)` in `sync-filter-standalone.mjs` with if/else chain for all 4 kinds
- [x] 1.3 Add `kind` param to `newerOrEqualSemanticReplicaExists(dbPath, key, ts, kind)` and use it in WHERE clause
- [x] 1.4 Change `filterUnchangedReplicas` pass-2 guard from `kind === 'dictionary-entry'` to `if (kind)`; forward kind to `computeSemanticKey` + `newerOrEqualSemanticReplicaExists`
- [x] 1.5 Change `writeReplicaMetadata` guard to `row.kind && row?.fields_jsonb ? computeSemanticKey(row, row.kind) : null`
- [x] 1.6 Add `replica_timestamps TEXT` to quotes DDL + `maybeAddReplicaTimestampsToQuotes` migration in `ensureReplicaTables`
- [x] 1.7 Remove `kind === 'quote' ? null :` guard in `upsertVisibleRow` (line 196); always compute `replicaTimestampJson(row)`

### Phase 2: Sync Pipeline Wiring (Slice 2)
- [x] 2.1 **RED**: Write failing tests for push-side (occurrence/quote/annotation) and pull-side (all 4 kinds) kind pass-through
- [x] 2.2 Push side: pass `'dictionary-occurrence'` to `filterUnchangedReplicas` at line 676
- [x] 2.3 Push side: pass `'quote'` to `filterUnchangedReplicas` at line 687
- [x] 2.4 Push side: pass `'annotation'` to `filterUnchangedReplicas` at line 698
- [x] 2.5 Pull side: pass `kind` from loop variable at line 708
- [x] 2.6 Add `replica_timestamps` to quotes INSERT column list and VALUES in `upsertVisibleRow`
- [x] 2.7 **GREEN**: Verify all 52 tests pass (combine with Slice 1's 43)

## TDD Cycle Evidence (Slice 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `sync-execute.test.mjs` | Unit | ✅ 43/43 | ✅ Written | ✅ 9 tests | ✅ 7+2 cases | ➖ None needed |
| 2.2 | N/A (prod change) | — | ✅ 43/43 | ✅ Test gap proved | ✅ Kind wired | — | — |
| 2.3 | N/A (prod change) | — | ✅ 43/43 | ✅ Test gap proved | ✅ Kind wired | — | — |
| 2.4 | N/A (prod change) | — | ✅ 43/43 | ✅ Test gap proved | ✅ Kind wired | — | — |
| 2.5 | N/A (prod change) | — | ✅ 43/43 | ✅ Test gap proved | ✅ Kind wired | — | — |
| 2.6 | `sync-execute.test.mjs` | Integration | ✅ 43/43 | ✅ 2 tests failed | ✅ 2 tests pass | ✅ 2 cases | ➖ None needed |
| 2.7 | `sync-execute.test.mjs` | — | ✅ 43/43 | ✅ RED confirmed | ✅ 52/52 pass | — | — |

## Test Summary

- **Total tests written (Slice 2)**: 9
- **Total tests passing**: 52 (43 original + 9 new)
- **RED→GREEN transition**: upsertReplicaRow quotes tests failed before 2.6, passed after
- **Layers used**: Unit (7), Integration (2)
- **Pure functions extended**: None new — tests cover integration behavior

## Deviations from Design

- Exported `upsertReplicaRow` in sync-execute.mjs (1-char change: added `export` keyword) to enable direct testing of the upsert flow. Not in original design but required for proper unit test coverage.

## Issues Found

None.

## Files Changed (Slice 2)

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Added kind to 4 `filterUnchangedReplicas` calls (lines 676, 687, 698, 708); added `replica_timestamps` to quotes INSERT; exported `upsertReplicaRow` for testing |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modified | Added 9 new tests: 7 kind pass-through gap tests + 2 upsertReplicaRow quotes replica_timestamps tests |
| `openspec/changes/fix-semantic-dedup-sync/tasks.md` | Modified | Marked Phase 2 tasks 2.1-2.7 as complete |

## Workload / PR Boundary

- **Mode**: stacked PR slice (PR 2 of 2, stacked-to-main)
- **Current work unit**: Phase 2 — Sync Pipeline Wiring
- **Boundary**: sync-execute.mjs push/pull calls + upsertVisibleRow quotes + tests
- **Estimated review budget impact**: ~50 lines prod + ~180 lines test (within 400-line budget)

## Status

**14/14 tasks complete (across both slices). Ready for verify.**
