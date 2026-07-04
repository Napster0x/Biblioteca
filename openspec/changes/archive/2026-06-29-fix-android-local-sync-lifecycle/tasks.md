# Tasks: Fix Android Local Sync Lifecycle

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450-650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 diagnostics helpers → PR 2 native lifecycle → PR 3 docs/preflight polish |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Diagnose package/PID/forward/HTTP failures | PR 1 to main | JS tests first; unlock absent-process/refused/timeout evidence. |
| 2 | Make native local server ensure idempotent | PR 2 to main after PR 1 | Rust tests first; no route or CRDT changes. |
| 3 | Gate/document Phase 2 reruns | PR 3 to main after PR 2 | Harness output/docs/manual checklist together. |

## Phase 1: JS Diagnostics TDD

- [x] 1.1 RED: Add `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` cases for package override/candidates, no package `FAIL`, PID absent, forward parsing, refused, and timeout.
- [x] 1.2 GREEN: Export pure helpers from `apps/readest-app/scripts/sync-dev-env.mjs` for package resolution, PID parsing, `adb forward --list`, and HTTP failure classification.
- [x] 1.3 REFACTOR: Keep helper outputs stable for `ok/status/environment/checks/actions` without changing existing harness consumers.

## Phase 2: Doctor Preflight Gate TDD

- [x] 2.1 RED: Extend doctor tests to require `android.process` and `android.health` evidence before Phase 2 case execution.
- [x] 2.2 GREEN: Update `apps/readest-app/scripts/dev-sync-doctor.mjs` to stop Phase 2 on failed/ambiguous package, process, forward, desktop health, Android health, or reachability.
- [x] 2.3 REFACTOR: Normalize diagnostic actions so wrong package, absent process, port refused, and timeout are distinct.

## Phase 3: Native Lifecycle TDD

- [x] 3.1 RED: Add Rust tests in `apps/readest-app/src-tauri/src/local_sync_server.rs`/`lib.rs` for duplicate ensure skip, stale health failure, and loopback bind preservation.
- [x] 3.2 GREEN: Add `ensure_local_sync_server(...)` in `apps/readest-app/src-tauri/src/lib.rs` used by command and Android auto-start.
- [x] 3.3 GREEN: Expose minimal port/health lifecycle facts in `apps/readest-app/src-tauri/src/local_sync_server.rs`; log `[local-sync:lifecycle]` start/skip/failed/health.
- [x] 3.4 REFACTOR: Remove duplicate startup paths and `println!` lifecycle evidence without adding foreground service behavior.

## Phase 4: Docs and Manual Verification

- [x] 4.1 Update `apps/readest-app/docs/sync-dev-harness.md` with package override, PID/listener recovery, native rebuild boundary, and escalation criteria.
- [x] 4.2 Record manual verification commands: `pnpm dev:sync:doctor --json`, `adb shell pidof`, `adb forward --list`, and `/health` curl evidence.
- [x] 4.3 Verify tasks against specs: Phase 2 blocks on no package/process, reports selected package/serial, and separates `app-process-absent`, `port-refused`, and `timeout`.

## Verification Fix Batch

- [x] 5.1 Fix stale local-sync lifecycle assertion to accept OS/timing-dependent unhealthy details while preserving strict `Unhealthy` status evidence.
- [x] 5.2 Add focused Phase 2 preflight enforcement tests for PASS, failed, missing, and failing-doctor JSON paths.
- [x] 5.3 Enforce `phase2.preflight` before Phase 2 case actions/sync triggers in `dev-sync-cycle.mjs`, `run-all-cases.mjs`, and `sync-execute.mjs`.
- [x] 5.4 Remove low-risk focused Biome warnings in touched scripts: unused `errorCount`, unused `adbForwardCheck` parameter, and newly surfaced unused imports/parameters in the same enforcement boundary.
