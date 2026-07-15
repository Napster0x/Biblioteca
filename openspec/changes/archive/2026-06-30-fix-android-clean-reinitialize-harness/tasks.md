# Tasks: Fix Android Clean Reinitialize Harness

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 260-380 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 helper+tests → PR 2 reset/cycle/up/preflight wiring |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Bounded Android clean-reinit helper with diagnostics | PR 1 | Base main; includes unit tests first. |
| 2 | Wire reset/cycle/up/preflight paths to the helper contract | PR 2 | Stacked on PR 1; includes integration tests and manual validation plan. |

## Phase 1: Tests First

- [x] 1.1 Create `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` failing tests for command order: forward → push → mkdir → cp → start → readiness waits.
- [x] 1.2 Add failing helper tests for bounded exits and diagnostics: forward, settings, process, health, manifest, replica API.
- [x] 1.3 Add failing integration tests for `dev-sync-reset.mjs` and `dev-sync-cycle.mjs` not reporting ready when reinit fails.

## Phase 2: Shared Helper

- [x] 2.1 Create `apps/readest-app/scripts/android-clean-reinit.mjs` with injectable `runAdb`, `fetch`, `sleep`, timeout options, and `REPLICA_KINDS` readiness.
- [x] 2.2 Implement `reinitializeAndroidAfterClean()` to restore `Readest/settings.json`, launch `.MainActivity`, verify PID, `/health`, `/books/manifest`, and `/replicas/*`.
- [x] 2.3 Return `{ ok, stages, diagnostics, ready }` with the design diagnostic classes and no unbounded waits.

## Phase 3: Harness Integration

- [x] 3.1 Modify `apps/readest-app/scripts/dev-sync-reset.mjs` to call reinit after successful Android `pm clear` and include result/errors in JSON output.
- [x] 3.2 Modify `apps/readest-app/scripts/dev-sync-cycle.mjs` so `--clean-android` uses the reset/helper lifecycle instead of health-only cleanup.
- [x] 3.3 Modify `apps/readest-app/scripts/dev-sync-up.mjs` to reuse helper primitives where practical without changing desktop startup behavior.
- [x] 3.4 Keep `apps/readest-app/scripts/sync-phase2-preflight.mjs` read-only, but require fresh PASS after clean/reinit before each Phase 2 case.

## Phase 4: Verification Plan

- [x] 4.1 Run focused tests: `pnpm test -- scripts/__tests__/android-clean-reinit.test.mjs scripts/__tests__/phase2-preflight.test.mjs --watch=false` from `apps/readest-app`.
- [x] 4.2 Manual Android, bounded only: run `pnpm dev:sync:reset -- --target all --confirm DELETE_DEV_SYNC_STATE --no-dry-run`, then `pnpm dev:sync:doctor`, then one Phase 2 CICLO case; stop on first timeout/FAIL.

## Verification Fix Batch

- [x] 5.1 Fix focused Biome `noUnusedFunctionParameters` warning in `apps/readest-app/scripts/dev-sync-reset.mjs`.
- [x] 5.2 Add narrow passing integration coverage for clean/reinitialize success → fresh preflight PASS → case branch starts.
