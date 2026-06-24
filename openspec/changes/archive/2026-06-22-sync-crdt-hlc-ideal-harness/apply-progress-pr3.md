# Apply Progress — sync-crdt-hlc-ideal-harness — PR3

## Scope Applied

PR3 / slice 3 only: Cleanup/Reset Safety (task 3.1) + State/Evidence Enrichment (task 3.2).

## Mode

Strict TDD (confirmed by Engram `sdd/biblioteca/testing-capabilities`).

## Completed Tasks

### PR3 (this slice — cleanup + state enrichment)

- [x] 3.1 Tests prove `dev-sync-clean.mjs` is dry-run by default, rejects ambiguous paths via reset delegation, declares deletes/preservations in dry-run output, and verifies clean state afterward. Implementation already existed; added 3 integration tests for the CLI wrapper behavior.
- [x] 3.2 Fixture snapshots for SQLite rows, replicas, HLC ranges, tombstones, duplicates, unavailable Android evidence. Implementation already existed; added 2 tests for full evidence model completeness and duplicate row handling.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 dry-run default | `devSyncHarness.test.ts` | CLI integration | ✅ 111/111 | ✅ Written | ✅ Passed | ✅ Combined with deletes/preserves | ➖ None needed |
| 3.1 ambiguous paths | `devSyncHarness.test.ts` | CLI integration | ✅ 111/111 | ✅ Written | ✅ Passed | ✅ Combined with rejection reason | ➖ None needed |
| 3.1 declares/preserves | `devSyncHarness.test.ts` | CLI integration | ✅ 111/111 | ✅ Written | ✅ Passed | ✅ 3+ preserved items verified | ➖ None needed |
| 3.2 evidence model | `devSyncHarness.test.ts` | Unit | ✅ 111/111 | ✅ Written | ✅ Passed | ➖ Single scenario (full model) | ➖ None needed |
| 3.2 duplicate rows | `devSyncHarness.test.ts` | Unit | ✅ 111/111 | ✅ Written | ✅ Passed | ➖ Single scenario (2 dupes) | ➖ None needed |

## Test Summary

- **Total tests written for PR3**: 5 (3 clean CLI + 2 state enrichment)
- **Total tests passing**: 116/116 in targeted harness file (baseline 111, +5 new)
- **Layers used**: CLI integration (3), Unit (2)
- **Approval tests**: None — no existing code was modified
- **Pure functions exercised**: `verifyCleanState` (clean-engine.mjs), `captureDesktopState` (sync-dev-state.mjs)

## Verification

- ✅ Safety net: `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 111 passed before changes
- ✅ After PR3 changes: `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 116 passed
- ✅ Safe non-mutating state check: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --json` produces valid JSON with `warn` status (expected — no real Android device)
- ✅ Dry-run clean verified through tests (never executed against real devices)
- No builds run.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Added 5 new tests: 3 for clean CLI (dry-run default, ambiguous paths, declare deletes/preserves) and 2 for state enrichment (full evidence model, duplicate SQLite rows). |

## Deviations from Design

None — implementation matches design. All dev-sync-clean.mjs, clean-engine.mjs, sync-dev-state.mjs, and sync-dev-sqlite.mjs already implemented the target behavior; this PR3 slice adds the missing RED test coverage.

## Issues Found

- `dev-sync-clean.mjs` wraps reset errors in its JSON output (`{ reset: { error: "..." } }`) rather than propagating them to stderr. Tests that verify error messages must use `spawnSync` + parse JSON, not `runNode` + `toThrow()`.
- Engram topic_key upsert overwrites previous content — confirmed as known behavior from PR2 discovery.
- No blocking issues.

## Remaining Tasks

- [ ] 4.1 Real books + book-backed actions (dictionary, quote, annotation)
- [ ] 4.2 Edit/delete/tombstone/duplicate semantics
- [ ] 5.1 Trigger/cycle/assert/report semantics
- [ ] 6.1-6.2 Docs + real-device smoke

## Workload / PR Boundary

- **Mode**: stacked PR slice (`auto-chain`, `stacked-to-main`).
- **Current work unit**: PR3 — Cleanup/Reset Safety + State/Evidence Enrichment.
- **Boundary**: Ends at clean CLI integration tests (dry-run, ambiguous paths, verification) and state enrichment tests (full evidence model, duplicate rows). No realistic user actions, semantic assertions, report architecture, or real-device smoke.
- **Estimated review budget impact**: ~120 lines (5 new tests + this artifact).

## Status

6/12 planned tasks complete (PR1: 2, PR2: 2, PR3: 2). 116 tests passing. Ready for PR4.
