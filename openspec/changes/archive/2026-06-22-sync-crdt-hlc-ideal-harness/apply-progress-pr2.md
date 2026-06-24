# Apply Progress — sync-crdt-hlc-ideal-harness

## Scope Applied

PR2 / slice 2 only: Real-Device Readiness (doctor) + Safe Orchestration (planner).

## Mode

Strict TDD (confirmed by Engram sdd/biblioteca/testing-capabilities).

## Completed Tasks

### PR1 (previous slice — contract stabilization)

- [x] 1.1 Enumerated `dev:sync:*` package scripts and required every declared Node `.mjs` entrypoint to exist; corrected `dev:sync:inject` to the existing `scripts/sync-dev-inject.mjs` implementation.
- [x] 1.2 Stabilized PR1 blocking contracts: inject CLI failure JSON, serial-scoped ADB forward contract metadata, trigger CLI nested failure propagation, sync-trigger route nested failure propagation, and deterministic reset marker guard coverage.
- [x] PR1 verification fix: removed TypeScript strictness failures from `devSyncHarness.test.ts` and `sync-trigger/route.ts`.

### PR2 (this slice — readiness + orchestration)

- [x] 2.1 Added `parseAdbForwardList` to `sync-dev-env.mjs` — pure function that parses `adb forward --list` output with serial-scoped matching. Added `detectToggleContradiction` and `parseToggleState` for settings.json toggle vs. health contradiction detection. Added `adb.forward` and `discovery.toggle` checks to doctor. 14 new tests confirm serial-scoped tunnel matching, empty/missing tunnel detection, and toggle/health contradiction reporting as WARN/AMBIGUOUS.
- [x] 2.2 Created `scripts/dev-sync-plan.mjs` — dry-run environment planner that refuses build, install, restart, and kill without explicit `--authorize BIBLIOTECA_DEV_SYNC_PLAN` token. Added `dev:sync:plan` package script. 7 new tests verify blocked/authorized behavior, dry-run listing mode, and package declaration.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `devSyncHarness.test.ts` | Unit (pure fn) + CLI script | ✅ 90/90 passing | ✅ 14 tests written before implementation (parseAdbForwardList, parseToggleState, detectToggleContradiction + adb.forward check + planner tests) | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 111/111 passed | ✅ 5 parseAdbForwardList cases (happy, missing, empty, serial-scoped, serial mismatch) + 5 detectToggleContradiction cases (off/down clean, on/up clean, on/desktop-down AMBIGUOUS, on/android-down AMBIGUOUS, both-down AMBIGUOUS) + 3 parseToggleState cases (enabled, missing localSync, null/empty) | ✅ Pure functions extracted, minimal implementation |
| 2.2 | `devSyncHarness.test.ts` | CLI script | ✅ 104/104 passing (after 2.1) | ✅ 7 tests written before implementation (refuse build/install/restart/kill + dry-run listing + authorized mode + package script) | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 111/111 passed | ✅ 5 operation refusal cases (build, install, restart, kill, listing-mode) + authorized mode back-to-back | ✅ Minimal planner, no process start, checklist-only |

## Test Summary

- **Total tests written for PR2**: 21 (14 doctor + 7 planner)
- **Total tests passing**: 111/111 in targeted harness file
- **Layers used**: Unit (pure functions), CLI script integration
- **Approval tests**: Existing 90 tests preserved
- **Pure functions created**: 3 (`parseAdbForwardList`, `parseToggleState`, `detectToggleContradiction`)

## Verification

- ✅ Safety net established: 90/90 before PR2 changes
- ✅ After all PR2 changes: `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 111 passed
- ✅ Planner direct verification: `pnpm exec node scripts/dev-sync-plan.mjs --json` produces valid JSON with 4 blocked steps
- ✅ Planner authorized: `pnpm exec node scripts/dev-sync-plan.mjs --json --authorize BIBLIOTECA_DEV_SYNC_PLAN` → all steps pass
- ✅ New `dev:sync:plan` package script declared
- No builds run.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/sync-dev-env.mjs` | Modified | Added `parseAdbForwardList()`, `parseToggleState()`, `detectToggleContradiction()` pure functions. |
| `apps/readest-app/scripts/dev-sync-doctor.mjs` | Modified | Added `adbForwardCheck()` and `toggleContradictionCheck()`; wired `adb.forward` and `discovery.toggle` check entries. |
| `apps/readest-app/scripts/dev-sync-plan.mjs` | Created | New dry-run environment planner. Lists build/install/restart/kill operations; requires `--authorize BIBLIOTECA_DEV_SYNC_PLAN` for dangerous ops. |
| `apps/readest-app/package.json` | Modified | Added `dev:sync:plan` script entry. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Added 21 new tests: `dev sync doctor ADB forward check` (5), `dev sync toggle contradiction detection` (9), `dev sync planner engine` (7). |
| `openspec/changes/sync-crdt-hlc-ideal-harness/apply-progress.md` | Created | This file — PR2 apply progress. |

## Deviations from Design

None — implementation matches design. Pure functions in sync-dev-env.mjs enabled testable doctor logic without spawning ADB or HTTP calls.

## Issues Found

- The Engram upsert for apply-progress (topic_key-based) overwrote the PR1 progress content. Fixed by using mem_update to replace with merged content containing both PR1 and PR2 data.
- No blocking issues.

## Remaining Tasks

- [ ] 3.1 Cleanup/reset safety + state/evidence enrichment
- [ ] 3.2 Fixture snapshots for SQLite rows, replicas, HLC ranges
- [ ] 4.1-4.3 Real books + dictionary/quote/annotation + edits/deletes
- [ ] 5.1-5.3 Trigger/cycle/assert/report semantics
- [ ] 6.1-6.2 Docs + real-device smoke

## Workload / PR Boundary

- **Mode**: stacked PR slice (`auto-chain`, `stacked-to-main`).
- **Current work unit**: PR2 — Real-Device Readiness + Safe Orchestration.
- **Boundary**: Ends at doctor readiness diagnostics (adb.forward + discovery.toggle checks) and planner dry-run checklist. No realistic user actions, semantic assertions, process orchestration, or report architecture.
- **Estimated review budget impact**: ~280 lines (21 tests + ~90 lines impl + ~50 lines artifacts).

## Status

4/12 planned tasks complete (PR1: 2 + verification fix; PR2: 2). 111 tests passing. Ready for PR3.
