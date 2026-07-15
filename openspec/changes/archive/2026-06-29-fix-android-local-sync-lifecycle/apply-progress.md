# Apply Progress — fix-android-local-sync-lifecycle

## Scope Applied

- Slice 1 — JS diagnostics helpers/tests only. Native Rust lifecycle changes and Phase 2 preflight gating were intentionally deferred to later slices.
- Slice 2 — Native lifecycle ensure/logging/tests only. Doctor Phase 2 preflight gating and docs/manual verification remained deferred.
- Slice 3 — Doctor Phase 2 preflight gate plus docs/manual verification support. No additional native lifecycle scope, foreground service behavior, route changes, or CRDT behavior changes were added.
- Verification fix batch — Fixed only verification CRITICAL issues and directly tied low-risk warnings: hardened stale-server test detail matching, enforced `phase2.preflight` at actual Phase 2 execution boundaries, and removed focused Biome unused warnings in touched scripts.

## Mode

Strict TDD (from `sdd/biblioteca/testing-capabilities` and launch prompt).

## Completed Tasks

- [x] 1.1 RED: Added `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` cases for package override/candidates, no package `FAIL`, PID absent, forward parsing, refused, timeout, and HTTP status classification.
- [x] 1.2 GREEN: Exported pure helpers from `apps/readest-app/scripts/sync-dev-env.mjs` for package target resolution, PID parsing, serial-scoped `adb forward --list` reuse, and Android `/health` failure classification.
- [x] 1.3 REFACTOR: Preserved existing doctor/environment consumers and added diagnostic fields without removing existing `ok/status/environment/checks/actions` output shape.
- [x] 2.1 RED: Added focused doctor tests requiring a `phase2.preflight` gate with explicit `android.process`, `android.health`, package, forward, manifest, and desktop health evidence.
- [x] 2.2 GREEN: Updated `apps/readest-app/scripts/dev-sync-doctor.mjs` to emit `android.package`, `android.process`, `phase2.preflight`, selected package/serial evidence, and blocked Phase 2 readiness when required checks fail or warn.
- [x] 2.3 REFACTOR: Normalized diagnostic actions so package-not-found, app-process-absent, port-refused, and timeout produce distinct recovery guidance.
- [x] 3.1 RED: Added focused Rust lifecycle tests for `SyncServer::health_status(...)`, duplicate ensure skip, stale existing-server health failure, and the existing loopback bind preservation test.
- [x] 3.2 GREEN: Added `ensure_local_sync_server(...)` in `apps/readest-app/src-tauri/src/lib.rs` and routed both the command path and Android auto-start through it.
- [x] 3.3 GREEN: Exposed minimal server health facts (`port`, `Healthy|Unhealthy`, detail) and persisted/logged lifecycle reports with `[local-sync:lifecycle]` evidence.
- [x] 3.4 REFACTOR: Removed the duplicate Android auto-start `SyncServer::start(...)` path and replaced auto-start `println!` evidence with `log::*`; no foreground service behavior was added.
- [x] 4.1 Updated `apps/readest-app/docs/sync-dev-harness.md` with Phase 2 preflight, package override, PID/listener recovery, native rebuild boundary, and escalation criteria.
- [x] 4.2 Recorded manual verification commands: `pnpm dev:sync:doctor --json`, `adb shell pidof`, `adb forward --list`, and `/health` curl evidence.
- [x] 4.3 Verified the slice against specs with focused tests: Phase 2 blocks on missing/failed readiness, reports package/serial evidence, and separates `app-process-absent`, `port-refused`, and `timeout` actions.
- [x] 5.1 Verification fix: Hardened `ensure_local_sync_server_reports_stale_existing_server_without_rebinding` so stale sockets may report `Server not listening`, `Connection refused`, or `Connection reset` while still requiring `FailedHealthCheck` + `Unhealthy`.
- [x] 5.2 Verification fix RED: Added `apps/readest-app/scripts/__tests__/phase2-preflight.test.mjs` before implementation; initial focused run failed because `sync-phase2-preflight.mjs` did not exist.
- [x] 5.3 Verification fix GREEN: Added `apps/readest-app/scripts/sync-phase2-preflight.mjs` and wired `dev-sync-cycle.mjs`, `run-all-cases.mjs`, and `sync-execute.mjs` to block before case actions/sync triggers unless doctor JSON contains `phase2.preflight: pass`.
- [x] 5.4 Verification fix REFACTOR: Removed low-risk focused Biome warnings in touched files, including unused `errorCount`, unused `adbForwardCheck` parameter, and newly surfaced unused imports/parameters in the same enforcement boundary.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Unit | ⚠️ Initial broad Vitest command hit unrelated pre-existing suite failures; focused existing env model later passed 3/3 | ✅ Import failed on missing `classifyAndroidHealthFailure` export | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 6/6 | ✅ Package selection, no package, PID absent, forward match/mismatch, refused, timeout, and HTTP status cases | ✅ Converted tests to Vitest imports so the project runner recognizes them |
| 1.2 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Unit | ✅ `pnpm exec vitest run "src/__tests__/services/sync/devSyncHarness.test.ts" -t "dev sync environment model"` passed 3/3 after helper changes | ✅ Tests referenced missing package/PID/health helpers first | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 6/6 | ✅ Separate branch coverage for override, installed candidate, no candidate, PID present/absent, refused, timeout, HTTP status | ✅ Helpers are pure and isolated in `sync-dev-env.mjs` |
| 1.3 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` + existing env model test | Unit | ✅ Existing env model passed 3/3 focused | ✅ Vitest initially reported no suite for `node:test` imports | ✅ Vitest-recognized test file passed 6/6 | ✅ Existing env model tests prove default package/server/USB tunnel contracts still hold | ✅ Added `packageCandidates` additively; no existing consumer fields removed |
| 2.1 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Unit | ✅ Existing focused doctor helper suite passed 6/6 before Phase 2 gate assertions | ✅ New tests failed on missing `buildPhase2PreflightGate` and `normalizeDiagnosticAction` exports | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 9/9 | ✅ Covered all-pass gate and absent-process gate failure with required evidence | ✅ Imported `dev-sync-doctor.mjs` without CLI side effects via an import guard |
| 2.2 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Unit | ✅ Same focused doctor safety net | ✅ Gate tests required explicit required checks before Phase 2 could proceed | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 9/9 | ✅ Required package, process, forward, Android health, Android manifest, and desktop health all must pass | ✅ Kept existing `ok/status/environment/checks/actions` shape and added evidence fields only |
| 2.3 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Unit | ✅ Existing action output shape preserved through focused test run | ✅ Action tests failed until distinct absent-process, port-refused, and timeout messages existed | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 9/9 | ✅ Separate recovery actions for app-process-absent, port-refused, and timeout | ✅ Centralized action normalization in `normalizeDiagnosticAction(...)` |
| 3.1 | `apps/readest-app/src-tauri/src/local_sync_server.rs`, `apps/readest-app/src-tauri/src/lib.rs` | Rust unit/integration | ✅ `cargo test -p Biblioteca local_sync_server::tests::server_bind_address_is_loopback_for_usb_forward_only --lib` passed 1/1; ✅ `cargo test -p Biblioteca tests::usb_only_local_sync_command_set_excludes_mdns_discovery --lib` passed 1/1 | ✅ Tests referenced missing `SyncServer::health_status`, `SyncServerHealthStatus`, `ensure_local_sync_server`, and `LocalSyncEnsureOutcomeKind` | ✅ Focused Rust lifecycle tests passed after implementation | ✅ Covered healthy server report, stale stopped server failure, first ensure start, repeated ensure skip, and preserved loopback bind test | ✅ Accepted OS-specific stale socket details (`not listening`, `Connection refused`, or `Connection reset`) while keeping status assertion strict |
| 3.2 | `apps/readest-app/src-tauri/src/lib.rs` | Rust unit/integration | ✅ Same focused lib safety net passed before production changes | ✅ Duplicate ensure test failed on missing helper/outcome types | ✅ `cargo test -p Biblioteca tests::ensure_local_sync_server --lib` passed 2/2 | ✅ First call starts; second call skips with `auto-start` source and healthy evidence; stale existing server reports failed health without rebinding | ✅ Command path now delegates to the helper and maps failed reports back to command errors |
| 3.3 | `apps/readest-app/src-tauri/src/local_sync_server.rs`, `apps/readest-app/src-tauri/src/lib.rs` | Rust unit/integration | ✅ Existing loopback bind and command-set safety nets passed | ✅ Health-report tests failed on missing lifecycle facts | ✅ `cargo test -p Biblioteca local_sync_server::tests::lifecycle_health_report --lib` passed 2/2 | ✅ Healthy and stale/unhealthy branches both assert concrete port/status/detail behavior | ✅ Lifecycle reports are stored in `LocalSyncState::last_lifecycle` and logged with stable `[local-sync:lifecycle]` prefix |
| 3.4 | `apps/readest-app/src-tauri/src/lib.rs` | Rust unit/integration | ✅ Focused ensure tests covered command/auto-start helper behavior before refactor | ✅ Existing duplicate startup path remained outside the helper | ✅ `cargo test -p Biblioteca tests::ensure_local_sync_server --lib` passed 2/2 after refactor | ✅ Tests exercise helper reuse through source labels, which protects against divergent command vs auto-start behavior | ✅ Android auto-start now uses `ensure_local_sync_server(...)` and `log::*`; foreground service intentionally not introduced |
| 4.1 | `apps/readest-app/docs/sync-dev-harness.md` | Docs | ✅ Phase 2 gate tests passed before docs update | N/A — docs-only task; implementation evidence is covered by 2.1-2.3 | ✅ Docs updated after passing gate tests | ✅ Docs cover package override, PID/listener recovery, rebuild boundary, and escalation criteria | ✅ Used progressive disclosure: quick gate path → required checks → recovery reference |
| 4.2 | `apps/readest-app/docs/sync-dev-harness.md` | Docs | ✅ Phase 2 gate tests passed before manual command documentation | N/A — docs-only task | ✅ Manual commands recorded in docs | ✅ Commands include doctor JSON, `adb shell pidof`, `adb forward --list`, and `/health` curl | ✅ Commands are grouped as a checklist instead of prose-only recall |
| 4.3 | `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` + docs | Unit/Docs | ✅ Focused doctor and env-model suites passed after implementation | ✅ Spec-mapping tests failed until preflight gate/action behavior existed | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 9/9; ✅ env model passed 3/3 | ✅ Verified block/pass gate, selected package/serial fields, and distinct `app-process-absent`, `port-refused`, `timeout` actions | ✅ Recorded native rebuild/redeploy as pending for real-device validation; no build run |
| 5.1 | `apps/readest-app/src-tauri/src/lib.rs` | Rust unit/integration | ✅ Baseline `cargo test -p Biblioteca tests::ensure_local_sync_server --lib` passed 2/2 on this host before changing the brittle assertion | ✅ Verification report identified the assertion as failing on other valid stale-socket details | ✅ `cargo test -p Biblioteca tests::ensure_local_sync_server --lib` passed 2/2 after accepting valid OS/timing-dependent unhealthy details | ✅ Preserves strict `FailedHealthCheck` + `Unhealthy` assertions and triangulates detail variants from prior evidence | ✅ Assertion now reports unexpected detail in failure output |
| 5.2 | `apps/readest-app/scripts/__tests__/phase2-preflight.test.mjs` | Unit | ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 9/9 before new tests | ✅ `pnpm exec vitest run "scripts/__tests__/phase2-preflight.test.mjs"` failed because `sync-phase2-preflight.mjs` did not exist | ✅ New focused preflight suite passed 3/3 | ✅ PASS gate, failed gate, missing gate, and failing doctor with JSON stdout are all covered | ✅ Enforcement logic isolated in a small helper module |
| 5.3 | `apps/readest-app/scripts/sync-phase2-preflight.mjs`, `dev-sync-cycle.mjs`, `run-all-cases.mjs`, `sync-execute.mjs` | Unit/CLI boundary | ✅ Existing focused doctor helper suite passed before enforcement wiring | ✅ New tests required preflight blocking before case execution could be considered valid | ✅ `pnpm exec vitest run "scripts/__tests__/phase2-preflight.test.mjs" "scripts/__tests__/dev-sync-doctor.test.mjs"` passed 12/12 | ✅ Doctor exit-code failures with parseable JSON still block with readiness-domain evidence | ✅ Shared helper avoids three divergent interpretations of `phase2.preflight` |
| 5.4 | `apps/readest-app/scripts/dev-sync-doctor.mjs`, `dev-sync-cycle.mjs`, `run-all-cases.mjs`, `sync-execute.mjs` | Lint | ✅ Focused Biome lint reported unused variables/parameters before cleanup | ✅ Warnings identified in verification were reproduced in the same file boundary | ✅ Focused Biome lint over changed scripts passed with no diagnostics | ✅ Removed only unused variables/imports/parameters; no behavior change beyond preflight enforcement | ✅ Left unrelated Rust `JsonShadow` warning untouched as out of scope |

## Test Summary

- **Total tests written**: 13 cumulative focused tests (9 JS doctor/helper tests from Slices 1 and 3; 4 Rust lifecycle tests from Slice 2).
- **Total tests passing**: 12 focused Vitest JS doctor/preflight tests; 18 focused Node `sync-execute` tests; 3 focused existing JS env model tests; 4 focused new Rust lifecycle tests; 2 focused existing Rust safety-net tests.
- **Layers used**: Unit (JS helper/gate/action + Rust helper assertions), docs verification, and Rust integration-style local loopback checks.
- **Approval tests**: Existing env model test preserved JS environment contract; existing Rust loopback bind and USB command-set tests preserved native safety boundaries.
- **Pure functions created**: 3 JS helpers from Slice 1; Slice 3 added pure `buildPhase2PreflightGate(...)` and `normalizeDiagnosticAction(...)`; Slice 2 added structured Rust lifecycle report types/helpers around existing server behavior.

## Verification Commands

- ❌ RED evidence: `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"` failed 3 new tests before implementation because `buildPhase2PreflightGate` and `normalizeDiagnosticAction` did not exist.
- ✅ `pnpm exec vitest run "scripts/__tests__/dev-sync-doctor.test.mjs"`
- ✅ `pnpm exec vitest run "src/__tests__/services/sync/devSyncHarness.test.ts" -t "dev sync environment model"`
- ✅ `cargo test -p Biblioteca local_sync_server::tests::server_bind_address_is_loopback_for_usb_forward_only --lib`
- ✅ `cargo test -p Biblioteca tests::usb_only_local_sync_command_set_excludes_mdns_discovery --lib`
- ✅ `cargo test -p Biblioteca local_sync_server::tests::lifecycle_health_report --lib`
- ✅ `cargo test -p Biblioteca tests::ensure_local_sync_server --lib`
- ❌ RED evidence: `pnpm exec vitest run "scripts/__tests__/phase2-preflight.test.mjs"` failed before implementation because `sync-phase2-preflight.mjs` did not exist.
- ✅ `pnpm exec vitest run "scripts/__tests__/phase2-preflight.test.mjs" "scripts/__tests__/dev-sync-doctor.test.mjs"`
- ✅ `node --test "scripts/__tests__/sync-execute.test.mjs"`
- ✅ `pnpm exec biome lint "scripts/__tests__/phase2-preflight.test.mjs" "scripts/__tests__/dev-sync-doctor.test.mjs" "scripts/sync-phase2-preflight.mjs" "scripts/dev-sync-doctor.mjs" "scripts/dev-sync-cycle.mjs" "scripts/run-all-cases.mjs" "scripts/sync-execute.mjs"`
- ⚠️ `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts --run -t "dev sync environment model"` was not a valid focused invocation in this repo and ran broad tests with unrelated pre-existing failures; it was superseded by the focused `pnpm exec vitest run ... -t ...` command above.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Modified | Added focused Phase 2 preflight gate/action tests while retaining diagnostics helper coverage. |
| `apps/readest-app/scripts/dev-sync-doctor.mjs` | Modified | Added import-safe exports, package/process checks, Phase 2 preflight gate, classified Android health failures, and normalized recovery actions. |
| `apps/readest-app/docs/sync-dev-harness.md` | Modified | Documented Phase 2 gate, package override, manual evidence commands, recovery table, rebuild boundary, and foreground-service escalation criteria. |
| `apps/readest-app/scripts/sync-dev-env.mjs` | Modified | Added package candidate metadata and pure helper exports for package/PID/HTTP diagnostics. |
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modified | Added `SyncServerHealth`/`SyncServerHealthStatus`, `health_status(...)`, and focused lifecycle health tests while preserving loopback binding. |
| `apps/readest-app/src-tauri/src/lib.rs` | Modified | Added shared `ensure_local_sync_server(...)`, lifecycle report state/logging, command delegation, Android auto-start delegation, and focused ensure tests. |
| `apps/readest-app/scripts/__tests__/phase2-preflight.test.mjs` | Created | Added focused tests for Phase 2 preflight enforcement PASS/block/failing-doctor JSON behavior. |
| `apps/readest-app/scripts/sync-phase2-preflight.mjs` | Created | Added shared doctor JSON preflight assertion/enforcement helper. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Enforces `phase2.preflight` before step/pipeline/single-step case actions or sync triggers. |
| `apps/readest-app/scripts/run-all-cases.mjs` | Modified | Enforces `phase2.preflight` before resetting/running Phase 2 cases. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Enforces `phase2.preflight` before direct sync execution and removes unused focused-lint parameters/imports. |
| `openspec/changes/fix-android-local-sync-lifecycle/tasks.md` | Modified | Marked Phase 1, Phase 2, Phase 3, and Phase 4 tasks complete. |
| `openspec/changes/fix-android-local-sync-lifecycle/apply-progress.md` | Modified | Merged Slice 1 and Slice 2 progress with Slice 3 gate/docs progress and TDD evidence. |

## Deviations from Design

None — implementation matches the Slice 3 Phase 2 gate/docs boundary. Foreground service behavior was intentionally not added. No Android native rebuild/redeploy was run.

## Issues Found

- The project-level `pnpm test -- ...` focused command can be misinterpreted and run a broad suite; use `pnpm exec vitest run <file> -t <pattern>` for precise app Vitest runs.
- `scripts/__tests__/sync-execute.test.mjs` uses Node's built-in `node:test`; running it under Vitest executes assertions but ends with "No test suite found". Use `node --test "scripts/__tests__/sync-execute.test.mjs"` for focused verification.
- Stale stopped loopback sockets can surface as `Server not listening`, `Connection refused`, or `Connection reset by peer` depending on timing/OS socket state. The lifecycle report normalizes this to `Unhealthy` while preserving the raw detail for diagnostics.
- Native changes require a later Android rebuild/redeploy before real-device doctor evidence can prove the new lifecycle logs on device. No build or redeploy was run in this slice.
- Real-device Phase 2 evidence remains manual/pending: `pnpm dev:sync:doctor --json`, `adb shell pidof`, `adb forward --list`, and `curl http://localhost:7878/health` should be captured after an authorized rebuild/redeploy.

## Remaining Tasks

- [ ] Manual device validation after authorized Android rebuild/redeploy: capture doctor JSON, PID, forward list, and `/health` evidence.

## Workload / PR Boundary

- Mode: stacked PR slice via `auto-chain`
- Current work unit: Verification fix batch — CRITICAL verification fixes only
- Boundary: Starts at failed verification findings; ends with stale lifecycle assertion hardening, Phase 2 execution-boundary preflight enforcement, and focused unused-warning cleanup. No additional native lifecycle scope, route changes, CRDT behavior changes, foreground service behavior, build, redeploy, or real-device execution included.
- Estimated review budget impact: Small stacked verification-fix slice on top of prior implementation; focused changed files only.

## Status

17/17 tasks complete for implementation including verification-fix batch. Ready for `sdd-verify`; manual Android device validation remains pending until a human authorizes rebuild/redeploy.
