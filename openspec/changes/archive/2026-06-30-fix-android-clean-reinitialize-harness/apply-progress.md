# Apply Progress — fix-android-clean-reinitialize-harness

## Scope Applied

PR 1 / Work Unit 1 completed the shared bounded Android clean-reinitialize helper and focused unit tests. PR 2 / Work Unit 2 wires reset/cycle/up/preflight paths to that helper contract and adds focused integration coverage. The verification-fix batch fixed the focused Biome warning and added the missing clean-success → fresh preflight PASS → case branch ordering integration coverage. Manual Android validation task 4.2 is now closed with bounded real-device reset, doctor, and minimal Phase 2 smoke commands. Phase 2 semantic case fixes remain out of scope.

## Mode

Strict TDD (from user launch prompt and `sdd/biblioteca/testing-capabilities`).

## Completed Tasks

- [x] 1.1 Create `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` failing tests for command order: forward → push → mkdir → cp → start → readiness waits.
- [x] 1.2 Add failing helper tests for bounded exits and diagnostics: forward, settings, process, health, manifest, replica API.
- [x] 1.3 Add failing integration tests for `dev-sync-reset.mjs` and `dev-sync-cycle.mjs` not reporting ready when reinit fails.
- [x] 2.1 Create `apps/readest-app/scripts/android-clean-reinit.mjs` with injectable `runAdb`, `fetch`, `sleep`, timeout options, and `REPLICA_KINDS` readiness.
- [x] 2.2 Implement `reinitializeAndroidAfterClean()` to restore `Readest/settings.json`, launch `.MainActivity`, verify PID, `/health`, `/books/manifest`, and `/replicas/*`.
- [x] 2.3 Return `{ ok, stages, diagnostics, ready }` with the design diagnostic classes and no unbounded waits.
- [x] 3.1 Modify `apps/readest-app/scripts/dev-sync-reset.mjs` to call reinit after successful Android `pm clear` and include result/errors in JSON output.
- [x] 3.2 Modify `apps/readest-app/scripts/dev-sync-cycle.mjs` so `--clean-android` uses the reset/helper lifecycle instead of health-only cleanup.
- [x] 3.3 Modify `apps/readest-app/scripts/dev-sync-up.mjs` to reuse helper primitives where practical without changing desktop startup behavior.
- [x] 3.4 Keep `apps/readest-app/scripts/sync-phase2-preflight.mjs` read-only, but require fresh PASS after clean/reinit before each Phase 2 case.
- [x] 4.1 Run the final focused command after PR 2 wiring.
- [x] 4.2 Manual Android, bounded only: bounded ADB shell/forward passed; real `dev:sync:reset -- --target all --confirm DELETE_DEV_SYNC_STATE --no-dry-run` reinitialized Android successfully; `dev:sync:doctor -- --json` reported `phase2.preflight: pass`; minimal Phase 2 smoke branch returned `verdict: pass`.
- [x] 5.1 Fix focused Biome `noUnusedFunctionParameters` warning in `apps/readest-app/scripts/dev-sync-reset.mjs`.
- [x] 5.2 Add narrow passing integration coverage for clean/reinitialize success → fresh preflight PASS → case branch starts.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Unit | N/A (new helper) | ✅ Written first; initial focused command failed before helper existed | ✅ `pnpm exec vitest run scripts/__tests__/android-clean-reinit.test.mjs` passed 3/3 | ✅ Command-order test covers full success path and ordered HTTP probes | ✅ Helper kept injectable and script-local |
| 1.2 | `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Unit | N/A (new helper) | ✅ Diagnostics tests written before production helper | ✅ `pnpm exec vitest run scripts/__tests__/android-clean-reinit.test.mjs` passed 3/3 | ✅ Failure matrix covers forward, settings, process, health, manifest, and replica API classes | ✅ Bounded polling extracted via finite attempt helper |
| 1.3 | `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs` | Script integration | ✅ Existing helper/preflight tests green before PR 2 edits | ✅ Import/call-site tests failed because reset/cycle were not helper-wired/import-safe | ✅ Focused integration test passed after reset/cycle wiring | ✅ Covers reset process-absent failure and cycle manifest failure propagation | ✅ Shared failure formatting and injectable reset runner keep test seams narrow |
| 2.1 | `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Unit | N/A (new module) | ✅ Tests imported missing `android-clean-reinit.mjs` and `REPLICA_KINDS` first | ✅ Helper exports satisfied focused tests | ✅ Tests verify injected `runAdb`, `fetch`, `sleep`, timeout options, and replica list | ✅ Defaults isolated from injected test dependencies |
| 2.2 | `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Unit | N/A (new module) | ✅ Success-path test specified settings restore, start, PID, health, manifest, replicas first | ✅ Focused helper test passed | ✅ HTTP probe order exercises all required readiness domains | ✅ Stage helpers keep orchestration readable |
| 2.3 | `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Unit | N/A (new module) | ✅ Tests asserted result shape and diagnostic classes first | ✅ Focused helper test passed | ✅ Multiple failures force real classification instead of hardcoded success | ✅ No unbounded loops; readiness uses computed finite attempts |
| 3.1 | `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs` | Script integration | ✅ `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs` RED confirmed missing reset export/wiring | ✅ Reset test written first for pm-clear → reinit failure JSON/errors | ✅ Reset returns `reinitialize`, marks `ok:false`, and names failing stage | ✅ Uses process-absent failure plus existing helper diagnostics matrix | ✅ Reset accepts injected `runAdb`/timeouts while CLI keeps bounded defaults |
| 3.2 | `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs` | Script integration | ✅ Same focused RED run confirmed cycle was not helper-wired/import-safe | ✅ Cycle test written first for reset reinit diagnostics blocking case execution | ✅ `spawnAndroidClean()` propagates helper diagnostics from reset | ✅ Manifest failure proves non-health readiness domains block the cycle | ✅ Removed duplicated force-stop/settings/health-only lifecycle from cycle |
| 3.3 | `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs` | Script integration | ✅ Reset/cycle integration tests were green before adding up test | ✅ Up readiness test failed before `prepareAndroidForSync()` existed | ✅ Up now delegates Android readiness to the shared helper and reports failure diagnostics | ✅ Replica API failure path prevents health-only false readiness | ✅ Desktop startup/toggle flow remains unchanged; only Android readiness path changed |
| 3.4 | `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs`, `apps/readest-app/scripts/__tests__/phase2-preflight.test.mjs` | Script integration | ✅ Existing preflight tests green before cycle edit | ✅ Cycle clean test specified no success when reset reinit fails; existing preflight tests already block non-PASS gates | ✅ Cycle runs fresh preflight after successful clean/reinit and before case branches | ✅ Clean failure and existing PASS/FAIL preflight cases cover both gates | ✅ `sync-phase2-preflight.mjs` remains read-only/blocking; recovery stays in reset/up/cycle |
| 4.1 | Focused Vitest command | Verification | ✅ Baseline from PR 1: helper/preflight tests green | ✅ New integration test failed before implementation | ✅ `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs scripts/__tests__/android-clean-reinit.test.mjs scripts/__tests__/phase2-preflight.test.mjs` passed 9/9 | ✅ Final command includes helper, integration, and preflight coverage | ➖ No production refactor after final green |
| 5.1 | Focused Biome lint | Lint fix | ✅ Verification reported one existing warning at `dev-sync-reset.mjs:345` | ➖ Lint-only cleanup; no new production behavior test needed | ✅ `pnpm exec biome lint ...` passed with no warnings after removing unused parameter | ➖ Single static warning, no branching behavior | ✅ Removed unused parameter and updated call sites only |
| 5.2 | `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs` | Script integration | ✅ Existing focused integration tests were 3/3 before adding the warning regression test | ✅ New test failed first: `preparePhase2CaseExecution is not a function` | ✅ `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs` passed 4/4 | ✅ Ordering assertion proves clean/reinitialize, then fresh preflight PASS, then case branch start | ✅ Extracted a narrow preparation seam reused by `main()` |

## Test Summary

- **Total tests written**: 7 Vitest tests across helper unit coverage and PR 2/verification-fix integration coverage (3 PR 1 helper tests + 4 PR 2/cycle integration tests).
- **Total tests passing**: 10/10 across focused helper, reset/cycle/up integration, and preflight files.
- **Layers used**: Unit (helper), script integration (reset/cycle/up/preflight call-site behavior).
- **Approval tests**: None — behavior changed under new spec rather than pure refactoring.
- **Pure functions created**: PR 1 helper utilities plus PR 2 `formatReinitializeFailure()` and narrow import-safe call-site seams.

## Verification Commands

- RED PR 2: `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs` from `apps/readest-app` failed before call-site exports/wiring (`cleanAndroid is not a function`, `spawnAndroidClean is not a function`, later `prepareAndroidForSync is not a function`).
- GREEN PR 2: `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs` from `apps/readest-app` → 1 file, 3 tests passed.
- Focused regression/final: `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs scripts/__tests__/android-clean-reinit.test.mjs scripts/__tests__/phase2-preflight.test.mjs` from `apps/readest-app` → 3 files, 9 tests passed.
- RED verification fix: `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs` from `apps/readest-app` failed 1/4 because `preparePhase2CaseExecution` did not exist yet.
- GREEN verification fix: `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs` from `apps/readest-app` → 1 file, 4 tests passed.
- Focused lint: `pnpm exec biome lint scripts/android-clean-reinit.mjs scripts/dev-sync-reset.mjs scripts/dev-sync-cycle.mjs scripts/dev-sync-up.mjs scripts/sync-phase2-preflight.mjs scripts/__tests__/android-clean-reinit.test.mjs scripts/__tests__/android-clean-reinit-integration.test.mjs scripts/__tests__/phase2-preflight.test.mjs` from `apps/readest-app` → 8 files checked, no warnings.
- Focused regression/final after verification fix: `pnpm exec vitest run scripts/__tests__/android-clean-reinit-integration.test.mjs scripts/__tests__/android-clean-reinit.test.mjs scripts/__tests__/phase2-preflight.test.mjs` from `apps/readest-app` → 3 files, 10 tests passed.
- Manual ADB readiness: `timeout 15s adb shell echo adb-ok && timeout 15s adb forward tcp:7878 tcp:7878` from `apps/readest-app` → `adb-ok`, `7878`.
- Manual Android reset/reinit: `timeout 180s env BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:reset -- --target all --confirm DELETE_DEV_SYNC_STATE --no-dry-run` from `apps/readest-app` → Android `pm clear io.github.Napster0x.biblioteca`, `reinitialize.ok: true`, all stages passed (`adb.forward`, `settings.inject`, `android.start`, `android.process`, `android.health`, `android.manifest`, 4 replica APIs).
- Manual doctor: `timeout 60s env BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor -- --json` from `apps/readest-app` → `phase2.preflight` status `pass` (overall doctor status `warn` only because Android sqlite3 CLI is unavailable for row-level capture).
- Minimal Phase 2 smoke: `timeout 60s env BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle -- --case-ref SDD-4.2-SMOKE --case-name clean-reinit-readiness --steps '[]'` from `apps/readest-app` → `verdict: pass`, report `/tmp/biblioteca-dev-sync/dev-sync-cycle-1782770380412.json`.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Created in PR 1 | Added focused Vitest coverage for command order, bounded diagnostics, and readiness domains. |
| `apps/readest-app/scripts/android-clean-reinit.mjs` | Created in PR 1 | Added injectable Android post-clean reinitialize helper with bounded process/HTTP readiness and structured diagnostics. |
| `apps/readest-app/scripts/__tests__/android-clean-reinit-integration.test.mjs` | Created/modified | Added focused script integration coverage for reset, cycle, and up failure behavior when shared readiness fails, plus the clean-success → fresh preflight PASS → case branch ordering regression. |
| `apps/readest-app/scripts/dev-sync-reset.mjs` | Modified | Calls `reinitializeAndroidAfterClean()` after successful `pm clear`, includes `reinitialize` diagnostics in JSON, fails the reset when Android is not ready, and no longer carries the unused `confirm` parameter. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Routes `--clean-android` through reset/helper diagnostics, removes duplicate health-only Android lifecycle, runs fresh preflight after clean before case execution, and exposes a narrow preparation seam for focused ordering coverage. |
| `apps/readest-app/scripts/dev-sync-up.mjs` | Modified | Reuses the shared helper for Android settings/start/readiness while preserving desktop startup behavior. |
| `apps/readest-app/scripts/sync-phase2-preflight.mjs` | Unchanged | Preserved as a read-only blocker; cycle now calls it after clean/reinit. |
| `openspec/changes/fix-android-clean-reinitialize-harness/tasks.md` | Updated | Marked PR 2 wiring and focused verification tasks complete. |
| `openspec/changes/fix-android-clean-reinitialize-harness/apply-progress.md` | Updated | Merged PR 1 and PR 2 Strict TDD progress. |

## Deviations from Design

None — implementation follows the design boundary: reset/up/cycle own recovery; `sync-phase2-preflight.mjs` remains read-only and only blocks case execution.

## Issues Found

- The PR 1 note still applies: `pnpm test -- scripts/... --watch=false` can expand beyond the intended focused files in this environment, so direct Vitest focused commands were used for bounded TDD cycles.
- The working tree already contained many unrelated modified/untracked files before this apply slice; this work intentionally changed only the files listed above.
- Manual Android validation is complete: bounded real-device reset/reinitialize, doctor `phase2.preflight: pass`, and minimal Phase 2 smoke branch all passed.
- The prior focused Biome warning and missing passing-order integration coverage are now resolved.

## Remaining Tasks

None for this change. Full 30-case Phase 2 semantics remain intentionally outside this SDD change scope.

## Workload / PR Boundary

- **Mode**: chained PR slice (`auto-chain`, `stacked-to-main`).
- **Current work unit**: Unit 2 — reset/cycle/up/preflight wiring to the shared helper contract.
- **Boundary**: Starts from the PR 1 helper; ends with reset/cycle/up consuming helper readiness and focused integration tests. Does not broaden into Phase 2 semantic case fixes.
- **Estimated review budget impact**: Focused PR 2 slice; test + wiring changes remain within the forecasted chained work unit.

## Status

14/14 tasks complete. Ready for archive; Phase 2 semantic case fixes remain intentionally deferred.
