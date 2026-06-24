## SDD APPLY Progress: PR5 — Trigger, Chained Cycle, Semantic Assert, Report

**What**: SDD APPLY cumulative progress for `sync-crdt-hlc-ideal-harness` — PR5 (trigger/cycle failure semantics, semantic assertions, golden reports).

**Why**: PR5 is the fifth stacked PR slice. It adds tests and implementation for:
- Task 5.1: nested trigger/cycle failures and partial evidence rejection with evidence paths
- Task 5.2: semantic assertion engine for convergence, idempotence, duplicates, HLC newer-wins, tombstones, semantic groups, and book-delete data survival
- Task 5.3: golden report semantics for `PASS/FAIL/WARN/AMBIGUOUS`, diagnosis, probable domain, unavailable evidence, and cleanup outcome

**Where**:
- `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` — 13 new PR5 tests
- `apps/readest-app/scripts/dev-sync-trigger.mjs` — exported `evaluateTriggerPayload`, added import-safe main guard, nested/partial evidence classification
- `apps/readest-app/scripts/dev-sync-cycle.mjs` — uses trigger evaluation in legacy/step/pipeline cycle paths and reports evidence paths
- `apps/readest-app/src/app/api/sync-trigger/route.ts` — includes trigger evidence path in route responses
- `apps/readest-app/scripts/assert-engine.mjs` — semantic assertion engine added beside existing snapshot comparison
- `apps/readest-app/scripts/dev-sync-assert.mjs` — semantic desktop↔Android CLI mode via `--desktop`/`--android`
- `apps/readest-app/scripts/report-engine.mjs` — new diagnostic report engine
- `apps/readest-app/scripts/dev-sync-report.mjs` — new report CLI
- `apps/readest-app/package.json` — added `dev:sync:report`
- `openspec/changes/archive/2026-06-22-sync-crdt-hlc-ideal-harness/tasks.md` — marked 5.1, 5.2, 5.3 as complete

**Learned**:
- Tests that start an HTTP server in-process must use async child execution (`spawnNode`) instead of `spawnSync`; synchronous spawn blocks the test process event loop, so the test server cannot answer the child request and trigger calls time out.
- `dev-sync-trigger.mjs` previously executed CLI code on ESM import; PR5 added an `isMain` guard so tests and other scripts can import pure evaluation logic without side effects.

## Mode
Strict TDD

## Completed Tasks (this batch)
- [x] 5.1 RED: route/CLI/cycle tests reject nested sync errors and partial evidence.
- [x] 5.2 RED: assertion fixtures for convergence, idempotence, duplicate logical rows, HLC newer-wins, tombstone respect, semantic groups, book-delete data survival.
- [x] 5.3 RED: golden report tests for `PASS/FAIL/WARN/AMBIGUOUS`, diagnosis, probable domain, unavailable evidence, cleanup outcome.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 trigger evaluation | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit | ✅ 132/132 | ✅ Written (missing `evaluateTriggerPayload`) | ✅ 145/145 | ✅ 2 cases (nested failure + partial evidence) | ✅ Import-safe main guard |
| 5.1 cycle nested failure | `src/__tests__/services/sync/devSyncHarness.test.ts` | Integration | ✅ 132/132 | ✅ Written | ✅ 145/145 | ✅ 2 cases (FAIL evidence path + AMBIGUOUS partial evidence) | ✅ Extracted `buildTriggerReport` |
| 5.2 semantic convergence | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit | ✅ 132/132 | ✅ Written (missing `compareSemanticState`) | ✅ 145/145 | ✅ 2 count-equal states with different logical keys | ✅ Shared logical-key helpers |
| 5.2 duplicates/idempotence | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit | ✅ 132/132 | ✅ Written | ✅ 145/145 | ✅ duplicate quote + repeated sync count drift | ✅ Cleaned idempotence state tracking |
| 5.2 HLC/tombstone/groups/book-delete | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit | ✅ 132/132 | ✅ Written | ✅ 145/145 | ✅ 4 invariants across annotations/dictionary/quotes | ✅ Entity config extracted |
| 5.2 assert CLI | `src/__tests__/services/sync/devSyncHarness.test.ts` | Integration | ✅ 132/132 | ✅ Written | ✅ 145/145 | ✅ desktop/android file input divergence | ➖ None needed |
| 5.3 report engine | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit | ✅ 132/132 | ✅ Written (missing `report-engine.mjs`) | ✅ 145/145 | ✅ PASS + FAIL + WARN + AMBIGUOUS golden cases | ✅ Small pure report builder |
| 5.3 report CLI | `src/__tests__/services/sync/devSyncHarness.test.ts` | Integration | ✅ 132/132 | ✅ Written (missing `dev-sync-report.mjs`) | ✅ 145/145 | ✅ FAIL assertion file emits diagnosis + non-zero exit | ➖ None needed |

### Test Summary
- **Tests added**: 13
- **Total tests passing**: 145
- **Layers used**: Unit (9), Integration (4)
- **Approval tests**: None — new behavior, no pure refactor-only task
- **Pure functions created**: `evaluateTriggerPayload`, `compareSemanticState`, `buildSyncReport`

## Verification Commands
- ✅ `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 145/145 passing
- ✅ `BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/dev-sync-trigger.mjs --dry-run --port 3131 --peer usb:localhost:7878` — safe dry-run trigger only; no real sync trigger

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `src/__tests__/services/sync/devSyncHarness.test.ts` | Extended | Added PR5 RED tests for trigger/cycle/assert/report semantics |
| `scripts/dev-sync-trigger.mjs` | Modified | Added pure trigger payload evaluation, evidence path failures, import-safe CLI guard |
| `scripts/dev-sync-cycle.mjs` | Modified | Propagates trigger evaluation into cycle verdicts and evidence reports |
| `src/app/api/sync-trigger/route.ts` | Modified | Includes `evidence.path` on success/failure responses |
| `scripts/assert-engine.mjs` | Extended | Added semantic desktop↔Android assertion invariants |
| `scripts/dev-sync-assert.mjs` | Modified | Added `--desktop`/`--android` semantic assert mode |
| `scripts/report-engine.mjs` | Created | Builds diagnostic reports from assertions/evidence/cleanup |
| `scripts/dev-sync-report.mjs` | Created | CLI wrapper for report engine |
| `package.json` | Modified | Added `dev:sync:report` script |
| `openspec/changes/archive/.../tasks.md` | Updated | Marked 5.1, 5.2, 5.3 as [x] |

## Deviations from Design
None — implementation follows the composable CLI + pure engine design and keeps real sync triggering gated behind operator readiness.

## Issues Found
- Existing tests still print expected negative-path stderr for guarded commands; test run remains green.
- PR5 intentionally does not run a real sync trigger because operator readiness was not provided.

## Remaining Tasks
- [ ] 6.1 RED: docs test/check requires command contract, manual-vs-CLI boundary, cleanup checklist, evidence paths, no-build warning.
- [ ] 6.2 Real-device smoke tasks: safe diagnostics and operator-authorized real-device smoke.

## Workload / PR Boundary
- **Mode**: Stacked PR slice (PR5 of 6)
- **Current work unit**: Trigger/Cycle + Semantic Assert + Report semantics
- **Boundary**: From RED tests for nested/semantic/report failures → Through engines/CLIs → Final passing 145 tests and safe dry-run trigger
- **Estimated review budget impact**: Focused PR5 slice; larger than tiny due semantic engine + tests, but isolated from PR6 docs/smoke work

## Status
5/6 phases complete (PR1-PR5). Tasks 5.1, 5.2, 5.3 complete. Ready for PR5 verify.
