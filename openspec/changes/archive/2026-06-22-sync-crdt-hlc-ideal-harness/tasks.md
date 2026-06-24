# Tasks: Sync CRDT+HLC Ideal Harness

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900-1,500 across tests, Node CLIs/engines, one route, docs |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 contract → PR2 readiness/orchestration → PR3 cleanup/state → PR4 actions → PR5 trigger/cycle/assert/report → PR6 docs/smoke |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Stabilize current command contracts | PR1 to main | Blocks all later slices. |
| 2 | Readiness + dry-run environment planner | PR2 to main after PR1 | Real-device safe diagnostics only. |
| 3 | Clean/reset + state evidence hardening | PR3 to main after PR2 | Destructive paths remain guarded. |
| 4 | Book/action/edit/delete tooling | PR4 to main after PR3 | Fixture-backed semantic rows. |
| 5 | Trigger/cycle/assert/report semantics | PR5 to main after PR4 | Chained cycles and diagnosis. |
| 6 | Docs + real-device smoke checklist | PR6 to main after PR5 | Operator-facing validation. |

## Phase 1: PR1 — Harness Audit + Command Contract Stabilization

- [x] 1.1 RED: extend `src/__tests__/services/sync/devSyncHarness.test.ts` to enumerate every `dev:sync:*` package script and require existing files (`dev-sync-inject.mjs` mismatch included). Impl: `package.json`, `scripts/dev-sync-*.mjs`. Verify: `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts --run`. Done: commands emit stable JSON `{ok,status,...}`. Auth: none. Auto: yes.
- [x] 1.2 RED: add tests for guard semantics, ADB forward direction, fixture/inject dependencies, claimed highlight creation, and nested trigger failure propagation. Impl: `scripts/sync-dev-env.mjs`, `dev-sync-trigger.mjs`, `dev-sync-cycle.mjs`, `src/app/api/sync-trigger/route.ts`. Done: false success becomes `fail`. Auth: none. Auto: yes.

## Phase 2: PR2 — Real-Device Readiness + Safe Orchestration

- [x] 2.1 RED: mock ADB/fetch tests for serial-scoped `adb forward --list`, Android `/health`, manifest/replicas, desktop health, and discovery/toggle contradictions. Impl: `scripts/dev-sync-doctor.mjs`, `sync-dev-env.mjs`. Verify: same targeted test plus safe `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor --json`. Done: contradictory readiness is `WARN/AMBIGUOUS`, not PASS. Auth: RSA prompt handled by human. Auto: yes for tests/doctor.
- [x] 2.2 RED: planner tests refuse builds, installs, restarts, global kills without explicit token. Impl: new `scripts/dev-sync-plan.mjs` or small planner engine. Verify: targeted test; no process start. Done: dry-run command/manual checklist only. Auth: required to actually start/restart/build. Auto: yes for planner.

## Phase 3: PR3 — Cleanup/Reset Safety + State/Evidence Enrichment

- [x] 3.1 RED: tests prove `clean` is dry-run by default, rejects ambiguous paths, declares deletes/preserves, then verifies clean state. Impl: `scripts/dev-sync-clean.mjs`, `clean-engine.mjs`, `dev-sync-reset.mjs`. Verify: targeted test; optional dry-run `pnpm dev:sync:clean --target all`. Done: missing verification is `FAIL/AMBIGUOUS`. Auth: destructive `--no-dry-run` only. Auto: tests/dry-run yes; destructive no.
- [x] 3.2 RED: fixture snapshots for SQLite rows, replicas, HLC ranges, tombstones, duplicates, unavailable Android evidence. Impl: `sync-dev-state.mjs`, `sync-dev-sqlite.mjs`. Verify: targeted test and safe `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --json`. Done: unavailable evidence degrades honestly. Auth: none. Auto: yes.

## Phase 4: PR4 — Real Books + Dictionary/Quote/Annotation + Edits/Deletes

- [x] 4.1 RED: temp EPUB/library tests for `prepare book --target desktop|android` metadata, hash, assets, paths, and delete-book semantics. Impl: `dev-sync-prepare.mjs`, `prepare-engine.mjs`. Verify: targeted test. Done: real EPUB fixture appears in state. Auth: Android write path only if safe/observable. Auto: desktop yes, Android diagnostic-gated.
- [x] 4.2 RED: tests create book-backed dictionary, quote, annotation records with associated highlight/group evidence. Impl: `dev-sync-fixture.mjs` or new `dev-sync-action.mjs`, `sync-dev-inject.mjs`. Verify: targeted test. Done: action evidence includes target/book/range/ids/HLC. Auth: none for fixtures. Auto: yes.
- [x] 4.3 RED: tests for edits, deletes, tombstones, duplicates, detached/sourceUnavailable rows. Impl: action tooling + SQLite helpers. Verify: targeted test. Done: stale updates cannot resurrect deleted state in fixtures. Auth: none. Auto: yes.

## Phase 5: PR5 — Trigger, Chained Cycle, Semantic Assert, Report

- [x] 5.1 RED: route/CLI/cycle tests reject nested sync errors and partial evidence. Impl: `sync-trigger/route.ts`, `dev-sync-trigger.mjs`, `dev-sync-cycle.mjs`. Verify: targeted test; safe dry-run trigger. Done: nested failures are reported with evidence path. Auth: real sync trigger only when operator says devices are ready. Auto: tests/dry-run yes.
- [x] 5.2 RED: assertion fixtures for convergence, idempotence, duplicate logical rows, HLC newer-wins, tombstone respect, semantic groups, book-delete data survival. Impl: `assert-engine.mjs`, `dev-sync-assert.mjs`. Verify: targeted test. Done: equal counts with missing occurrence fails semantically. Auth: none. Auto: yes.
- [x] 5.3 RED: golden report tests for `PASS/FAIL/WARN/AMBIGUOUS`, diagnosis, probable domain, unavailable evidence, cleanup outcome. Impl: new `report-engine.mjs`, cycle integration. Verify: targeted test. Done: report explains divergence beyond counts. Auth: none. Auto: yes.

## Phase 6: PR6 — Docs + Safe Real-Device Smoke

- [x] 6.1 RED: docs test/check requires command contract, manual-vs-CLI boundary, cleanup checklist, evidence paths, no-build warning. Impl: `docs/sync-dev-harness.md`, maybe `docs/sync-dev-smoke.md`. Verify: targeted test. Done: operator can run commands without hidden UI steps. Auth: none. Auto: yes.
- [x] 6.2 RED: tests/checks for safe smoke script and/or checklist. Impl: `scripts/dev-sync-smoke.mjs` and `dev:sync:smoke` package script. Safe commands include only non-mutating diagnostics by default: `doctor --json`, `state --json`, dry-run clean. Done: evidence plan saved and any `WARN/AMBIGUOUS` documentation required; no builds, installs, restarts, destructive clean, or real sync trigger without authorization. Auth: required for destructive clean, real sync trigger, RSA prompts. Auto: safe diagnostics plan yes; mutation/destructive no.
