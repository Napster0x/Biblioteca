## SDD APPLY Progress: PR6 — Docs + Safe Real-Device Smoke

**What**: SDD APPLY cumulative progress for `sync-crdt-hlc-ideal-harness` — PR6 (operator docs and safe smoke plan).

**Why**: PR6 is the final stacked slice. It closes the operator-facing boundary by documenting command contracts, manual-vs-CLI responsibility, cleanup/evidence expectations, and a safe smoke CLI that never builds, installs, restarts, destructively cleans, or triggers real sync by default.

**Where**:
- `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` — 4 PR6 tests for docs contract, safe smoke plan, evidence plan persistence, and package script registration.
- `apps/readest-app/docs/sync-dev-harness.md` — added manual-vs-CLI boundary, evidence paths, cleanup checklist, and no-build/no-install/no-restart/no-trigger warnings.
- `apps/readest-app/docs/sync-dev-smoke.md` — documented safe default smoke commands and WARN/AMBIGUOUS evidence handling.
- `apps/readest-app/scripts/dev-sync-smoke.mjs` — emits JSON/text safe smoke plan and optional plan evidence without running mutating commands.
- `apps/readest-app/package.json` — added `dev:sync:smoke` script.
- `openspec/changes/archive/2026-06-22-sync-crdt-hlc-ideal-harness/tasks.md` — marked 6.1 and 6.2 complete.

**Learned**:
- The restored PR6 smoke script only listed descriptive smoke cases and did not have a package script; PR6 converted it into a safe default checklist/plan while preserving non-execution of real sync.
- Evidence plan persistence uses `BIBLIOTECA_DEV_SYNC_SMOKE_DIR` so tests can verify saved artifacts without writing to the default `/tmp/biblioteca-dev-sync/smoke` location.

## Mode
Strict TDD

## Completed Tasks (this batch)
- [x] 6.1 RED: docs test/check requires command contract, manual-vs-CLI boundary, cleanup checklist, evidence paths, no-build warning.
- [x] 6.2 RED: tests/checks for safe smoke script/checklist; default smoke plan contains only non-mutating diagnostics.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 6.1 docs contract | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/docs check | ✅ 143/143 | ✅ Written (missing required doc content) | ✅ 146/146 | ✅ Multiple required terms: command contract, manual boundary, cleanup, evidence, no-build/no-danger warnings | ✅ Added focused operator sections |
| 6.2 safe smoke plan | `src/__tests__/services/sync/devSyncHarness.test.ts` | Integration CLI | ✅ 143/143 | ✅ Written (`--json` output was not JSON) | ✅ 146/146 | ✅ Default plan plus blocked operation assertions | ✅ Pure `createSmokePlan`/`createSafeTasks` helpers |
| 6.2 evidence persistence | `src/__tests__/services/sync/devSyncHarness.test.ts` | Integration CLI | ✅ 146/146 | ✅ Written (custom evidence dir ignored) | ✅ 147/147 | ✅ Alternate `BIBLIOTECA_DEV_SYNC_SMOKE_DIR` path verifies non-mutating saved plan | ✅ Plan file includes resolved `planPath` |
| 6.2 package script | `src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/config | ✅ 143/143 | ✅ Written (`dev:sync:smoke` missing) | ✅ 146/146 | ➖ Single structural contract | ➖ None needed |

### Test Summary
- **Tests added**: 4
- **Total tests passing**: 147
- **Layers used**: Unit/docs/config (2), Integration CLI (2)
- **Approval tests**: None — new docs/smoke behavior, no refactor-only task
- **Pure functions created**: `createSafeTasks`, `createSmokePlan`

## Verification Commands
- ✅ Baseline before PR6 changes: `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 143/143 passing
- ✅ RED after first PR6 tests: `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 3 new PR6 failures
- ✅ GREEN after implementation: `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 146/146 passing
- ✅ TRIANGULATE RED: `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — evidence-dir test failed as expected
- ✅ Final post-refactor GREEN: `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 147/147 passing
- ✅ PR6 resume audit rerun: `npx vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 147/147 passing

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `src/__tests__/services/sync/devSyncHarness.test.ts` | Extended | Added PR6 docs/smoke tests |
| `docs/sync-dev-harness.md` | Modified | Added operator command contract, manual-vs-CLI boundary, cleanup checklist, evidence paths, and no-build/no-danger warnings |
| `docs/sync-dev-smoke.md` | Modified | Documented safe smoke defaults and evidence handling |
| `scripts/dev-sync-smoke.mjs` | Modified | Added JSON safe smoke plan and optional evidence-plan persistence |
| `package.json` | Modified | Added `dev:sync:smoke` script |
| `openspec/changes/archive/.../tasks.md` | Updated | Marked 6.1 and 6.2 as complete |

## Deviations from Design
None — implementation stays a composable CLI/checklist, not a Markdown runner or hidden UI automation runner. Real sync trigger remains operator-authorized only.

## Issues Found
- Existing negative-path tests print expected stderr for guarded reset/prepare/fixture/clean commands; final test run remains green.
- No real device diagnostics were executed because the task constraints did not authorize Android install/redeploy/restart or real sync trigger; PR6 provides the safe commands/checklist for an operator to run.
- Resume audit found PR6 source/docs/tests/tasks already complete; no additional source implementation was required.

## Remaining Tasks
None for `sync-crdt-hlc-ideal-harness` implementation. Ready for verify/archive of PR6/final change.

## Workload / PR Boundary
- **Mode**: Stacked PR slice (PR6 of 6)
- **Current work unit**: Docs + Safe Real-Device Smoke
- **Boundary**: From restored PR6 docs/smoke files → Through tests/docs/smoke CLI/package script → Final passing 147 tests
- **Estimated review budget impact**: Focused final operator-facing slice; no production sync logic changes.

## Status
All 14/14 tasks complete across PR1–PR6. Ready for final verify.
