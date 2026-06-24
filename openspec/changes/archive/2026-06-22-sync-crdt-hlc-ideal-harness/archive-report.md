# Archive Report — sync-crdt-hlc-ideal-harness

**Archived**: 2026-06-22
**Change**: sync-crdt-hlc-ideal-harness
**PR slices archived**: PR1 (Harness Audit + Command Contract Stabilization) + PR2 (Real-Device Readiness + Safe Orchestration) + PR3 (Cleanup/Reset Safety + State/Evidence Enrichment) + PR4 (Real Books + Dictionary/Quote/Annotation + Edits/Deletes) + PR5 (Trigger, Chained Cycle, Semantic Assert, Report) + PR6 (Docs + Safe Real-Device Smoke)
**Mode**: hybrid (Engram + openspec)
**Last updated**: 2026-06-23 (PR6 final archive)

---

## Engram Observation IDs (Traceability)

| Artifact | Engram ID | Topic Key |
|----------|-----------|-----------|
| Proposal | #1011 | `sdd/sync-crdt-hlc-ideal-harness/proposal` |
| Spec | #1014 | `sdd/sync-crdt-hlc-ideal-harness/spec` |
| Design | #1017 | `sdd/sync-crdt-hlc-ideal-harness/design` |
| Tasks | #1021 | `sdd/sync-crdt-hlc-ideal-harness/tasks` |
| Apply Progress (PR1+PR2 cumulative) | #1023 | `sdd/sync-crdt-hlc-ideal-harness/apply-progress` |
| Verify Report (PR1) | #1026 | `sdd/sync-crdt-hlc-ideal-harness/verify-report` |
| Archive Report | — (this file) | `sdd/sync-crdt-hlc-ideal-harness/archive-report` |
| Apply Progress (PR3) | #1038 | `sdd/sync-crdt-hlc-ideal-harness/apply-progress-pr3` |
| Verify Report (PR3) | #1040 | `sdd/sync-crdt-hlc-ideal-harness/verify-report-pr3` |
| Apply Progress (PR4) | #1043 | `sdd/sync-crdt-hlc-ideal-harness/apply-progress-pr4` |
| Verify Report (PR4) | #1046 | `sdd/sync-crdt-hlc-ideal-harness/verify-report-pr4` |
| Apply Progress (PR5) | #1051 | `sdd/sync-crdt-hlc-ideal-harness/apply-progress-pr5` |
| Verify Report (PR5) | #1055 | `sdd/sync-crdt-hlc-ideal-harness/verify-report-pr5` |
| Apply Progress (PR6) | #1063 | `sdd/sync-crdt-hlc-ideal-harness/apply-progress-pr6` |
| Verify Report (PR6) | #1065 | `sdd/sync-crdt-hlc-ideal-harness/verify-report-pr6` |

---

## PR2 Completeness

| Metric | Value |
|--------|-------|
| Total tasks across all phases | 12 |
| PR2 tasks | 2 (2.1, 2.2) |
| PR2 tasks complete | 2 ✅ |
| Cumulative tasks complete (PR1+PR2) | 4/12 ✅ |
| Remaining tasks (PR3–PR6) | 8 ⏳ |

### Completed PR2 Tasks

- **[x] 2.1** — Added `parseAdbForwardList`, `parseToggleState`, `detectToggleContradiction` pure functions in `sync-dev-env.mjs`. Wired `adb.forward` and `discovery.toggle` checks into doctor diagnostics. 14 tests cover serial-scoped tunnel matching, empty/missing tunnel detection, toggle/health contradiction reporting as WARN/AMBIGUOUS, and health version parsing.
- **[x] 2.2** — Created `scripts/dev-sync-plan.mjs` — dry-run environment planner that refuses build, install, restart, and kill without explicit `--authorize BIBLIOTECA_DEV_SYNC_PLAN` token. Added `dev:sync:plan` package script. 7 tests verify blocked/authorized behavior, dry-run listing mode, and package declaration.

### Verification Result

**PASS** (from verify report PR2)

- ✅ Behavioral tests: 111/111 pass in focused Vitest (90 PR1 baseline + 21 PR2 new tests).
- ✅ All 22 spec scenarios for PR2 scope are COMPLIANT with passing behavioral tests.
- ✅ TDD Compliance: 6/6 checks passed. RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR evidence complete in filesystem apply-progress.
- ✅ Assertion quality: zero banned patterns. All PR2 tests exercise real code paths with specific value assertions.
- ✅ PR2 boundary respected: readiness diagnostics (ADB forward, toggle contradiction, health version) + safe planner only. No cleanup/actions/semantic asserts.
- ⚠️ Full `tsgo --noEmit` still fails on out-of-scope files (noise, not a PR2 issue).

---

## PR3 Completeness

| Metric | Value |
|--------|-------|
| Total tasks across all phases | 12 |
| PR3 tasks | 2 (3.1, 3.2) |
| PR3 tasks complete | 2 ✅ |
| Cumulative tasks complete (PR1+PR2+PR3) | 6/12 ✅ |
| Remaining tasks (PR4–PR6) | 6 ⏳ |

### Completed PR3 Tasks

- **[x] 3.1** — RED tests prove `dev-sync-clean.mjs` is dry-run by default, rejects ambiguous paths via reset delegation (home dir, missing markers), declares deletes/preservations in dry-run output, and verifies clean state afterward. 3 integration tests added for CLI wrapper behavior.
- **[x] 3.2** — Fixture snapshots for SQLite rows, replicas, HLC ranges, tombstones, duplicates, unavailable Android evidence. 2 unit tests added for full evidence model completeness and duplicate row handling.

### Verification Result

**PASS** (from verify report PR3)

- ✅ Behavioral tests: 116/116 pass in focused Vitest (111 PR2 baseline + 5 PR3 new tests).
- ✅ All 23 spec scenarios for PR3 scope are COMPLIANT with passing behavioral tests.
- ✅ TDD Compliance: 6/6 checks passed. RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR evidence complete.
- ✅ Assertion quality: zero banned patterns. All PR3 tests exercise real code paths with specific value assertions.
- ✅ PR3 boundary respected: cleanup/reset safety (dry-run, ambiguous paths, declare deletes, verify clean) + state evidence (SQLite rows, replicas, HLC, tombstones, duplicates, degradation) only. No realistic user actions, semantic assertions, report architecture, or real-device smoke.
- ✅ Safety constraints followed: no builds, no commits, no destructive cleanup, no Android deploy.

---

## PR4 Completeness

| Metric | Value |
|--------|-------|
| Total tasks across all phases | 12 |
| PR4 tasks | 3 (4.1, 4.2, 4.3) |
| PR4 tasks complete | 3 ✅ |
| Cumulative tasks complete (PR1+PR2+PR3+PR4) | 9/12 ✅ |
| Remaining tasks (PR5–PR6) | 3 ⏳ |

### Completed PR4 Tasks

- **[x] 4.1** — EPUB preparation engine (`prepare-engine.mjs`) and CLI (`dev-sync-prepare.mjs`) with EPUB import, hash verification, library metadata. 9 tests cover engine + CLI behavior with real EPUB fixtures.
- **[x] 4.2** — Action fixture engine: `injectDictionary`, `injectQuote`, `injectAnnotation` in `dev-sync-fixture.mjs` with `injectOpts` forwarding and `resolveDefaults` fallback. CLI integration via `--dict`, `--quote`, `--note` flags with JSON output. TABLE_DB_KIND mapping for correct SQLite DB routing. 10 tests cover fixture engine + CLI + guard behavior.
- **[x] 4.3** — Edit/delete/tombstone semantics: `updateRow` (HLC bump via `replica_timestamps`), `softDeleteRow` (tombstone via `deleted_at`), `findDuplicates` (group column matching), `isStaleUpdate` (HLC comparison). Graceful degradation for detached/sourceUnavailable rows. 6 unit tests cover all operations.

### Verification Result

**PASS** (from verify report PR4)

- ✅ Behavioral tests: 132/132 pass in focused Vitest (116 PR3 baseline + 16 PR4 new tests).
- ✅ All 5 spec scenarios for PR4 scope are COMPLIANT with passing behavioral tests.
- ✅ TDD Compliance: 6/6 checks passed. RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR evidence complete in `apply-progress-pr4.md`.
- ✅ Assertion quality: zero banned patterns. Zero mocks in PR4 tests — real sqlite3 CLI and DB operations.
- ✅ PR4 boundary respected: real books + action fixtures + edits/deletes/tombstones only. No trigger/cycle/assert/report (PR5), no docs/real-device smoke (PR6).
- ✅ Safety constraints followed: no builds, no commits, no destructive cleanup, no Android deploy.
- ⚠️ 1 lint suggestion: unused `target` parameter in `resolveDefaults(target, table)` — minor, not a blocker.

---

## PR5 Completeness

| Metric | Value |
|--------|-------|
| Total tasks across all phases | 14 |
| PR5 tasks | 3 (5.1, 5.2, 5.3) |
| PR5 tasks complete | 3 ✅ |
| Cumulative tasks complete (PR1+PR2+PR3+PR4+PR5) | 12/14 ✅ |
| Remaining tasks (PR6) | 2 ⏳ |

### Completed PR5 Tasks

- **[x] 5.1** — Trigger/route/cycle semantics reject nested sync errors and partial evidence. `evaluateTriggerPayload` reports nested failure details and evidence paths, and cycle reports mark insufficient evidence as `AMBIGUOUS` instead of false success.
- **[x] 5.2** — Semantic assertion engine compares desktop↔Android state beyond counts: convergence, idempotence, duplicate logical rows, HLC newer-wins, tombstones, semantic highlight groups, and book-delete data survival.
- **[x] 5.3** — Diagnostic report engine and CLI produce `PASS/FAIL/WARN/AMBIGUOUS` verdicts with diagnosis, probable domain, evidence paths, unavailable evidence, cleanup outcome, and non-zero CLI exit for failing reports.

### Verification Result

**PASS** (from verify report PR5)

- ✅ Behavioral tests: 143/143 pass in focused Vitest after PR6 source residue was removed/quarantined.
- ✅ All 14 PR5 scenarios are COMPLIANT with passing behavioral tests.
- ✅ TDD Compliance: 6/6 checks passed; PR5 apply progress includes RED/GREEN/TRIANGULATE/REFACTOR evidence.
- ✅ Assertion quality: PR5 tests assert real trigger/cycle/report/semantic behavior; no tautologies or production-code-free tests found.
- ✅ PR5 boundary respected: trigger/cycle/assert/report only. PR6 docs/smoke artifacts are intentionally quarantined at `/tmp/opencode/pr6-hold/` and must only be restored in PR6.
- ✅ Safety constraints followed: no build, no commit, no destructive cleanup, no Android install/redeploy, no real sync trigger.
- ⚠️ The PR5 verify artifact reports “Overall tasks complete 11/13”, but the tasks artifact is the source of truth and contains 14 tasks total with 12 complete after PR5. The correct cumulative count is **12/14**.

---

## PR6 Completeness — Final Slice

| Metric | Value |
|--------|-------|
| Total tasks across all phases | 14 |
| PR6 tasks | 2 (6.1, 6.2) |
| PR6 tasks complete | 2 ✅ |
| Cumulative tasks complete (PR1+PR2+PR3+PR4+PR5+PR6) | 14/14 ✅ |
| Remaining tasks | 0 ✅ |

### Completed PR6 Tasks

- **[x] 6.1** — Operator docs now cover command contract, manual-vs-CLI boundary, cleanup checklist, evidence paths, and explicit no-build/no-install/no-redeploy/no-restart/no-trigger warnings.
- **[x] 6.2** — Safe smoke CLI and package script emit a non-mutating diagnostics plan by default (`doctor --json`, `state --json`, dry-run clean), can persist an evidence plan, and document WARN/AMBIGUOUS handling without running real sync or destructive actions.

### Verification Result

**PASS** (from verify report PR6)

- ✅ Behavioral tests: 147/147 pass in focused Vitest.
- ✅ PR6 tasks 6.1 and 6.2 are marked complete in the tasks artifact.
- ✅ Smoke JSON plan contains only non-mutating diagnostics by default.
- ✅ Evidence persistence writes only `plan.json` under the smoke evidence directory and does not execute mutating commands.
- ✅ PR6 boundary respected: docs + safe smoke only; no production sync logic changes, build, install, restart, destructive cleanup, or real sync trigger.
- ✅ No CRITICAL or WARNING findings in PR6 verification.

---

## Spec Sync

| Domain | Action | Details |
|--------|--------|---------|
| `sync-crdt-hlc-real-device-harness` | No change needed | PR6 did not add new requirements beyond the existing source-of-truth spec. Main spec at `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` already covers the final operator responsibility model, safe orchestration, evidence model, reporting, delivery constraints, and non-goal boundaries. Delta and main spec are identical. |

**Source of truth**: `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md`

---

## Archive Contents

| Artifact | Status | Details |
|----------|--------|---------|
| `exploration.md` | ✅ Archived | Pre-change exploration analysis (unchanged). |
| `proposal.md` | ✅ Archived | Problem statement, scope, approach, risks, success criteria. |
| `specs/sync-crdt-hlc-real-device-harness/spec.md` | ✅ Archived → Main spec | Final source-of-truth behavior for the real-device harness. |
| `design.md` | ✅ Archived | Architecture decisions, data flow, file changes, interfaces, testing strategy. |
| `tasks.md` | ✅ Archived (updated) | 14 tasks across 6 PRs; 14 completed (PR1+PR2+PR3+PR4+PR5+PR6), 0 pending. |
| `apply-progress.md` | ✅ Archived (PR1) | TDD cycle evidence, test summary, changed files, deviations, issues, remaining tasks for PR1. |
| `apply-progress-pr2.md` | ✅ Archived (PR2) | PR2-specific apply progress with TDD cycle evidence for tasks 2.1, 2.2. |
| `verify-report.md` | ✅ Archived (PR1) | Full PR1 verification: PASS WITH WARNINGS. |
| `verify-report-pr2.md` | ✅ Archived (PR2) | Full PR2 verification: PASS. 111/111 tests, 22/22 spec scenarios compliant. |
| `archive-report.md` | ✅ Current | This document — cumulative PR1+PR2+PR3+PR4+PR5+PR6 final archive report. |
| `apply-progress-pr3.md` | ✅ Archived (PR3) | PR3-specific apply progress with TDD cycle evidence for tasks 3.1, 3.2. |
| `verify-report-pr3.md` | ✅ Archived (PR3) | Full PR3 verification: PASS. 116/116 tests, 23/23 spec scenarios compliant. |
| `apply-progress-pr4.md` | ✅ Archived (PR4) | PR4-specific apply progress with TDD cycle evidence for tasks 4.1, 4.2, 4.3. |
| `verify-report-pr4.md` | ✅ Archived (PR4) | Full PR4 verification: PASS. 132/132 tests, 5/5 spec scenarios compliant. |
| `apply-progress-pr5.md` | ✅ Archived (PR5) | PR5-specific apply progress with TDD cycle evidence for tasks 5.1, 5.2, 5.3. |
| `verify-report-pr5.md` | ✅ Archived (PR5) | Full PR5 verification: PASS. 143/143 tests, 14/14 PR5 scenarios compliant. |
| `apply-progress-pr6.md` | ✅ Archived (PR6) | PR6-specific apply progress with TDD cycle evidence for tasks 6.1 and 6.2. |
| `verify-report-pr6.md` | ✅ Archived (PR6) | Full PR6 verification: PASS. 147/147 tests; 14/14 total tasks complete. |

**Archived to**: `openspec/changes/archive/2026-06-22-sync-crdt-hlc-ideal-harness/`

---

## Discoveries & Learnings

### PR2 Resolved

- Added pure functions `parseAdbForwardList`, `parseToggleState`, `detectToggleContradiction` in `sync-dev-env.mjs` enabling testable doctor diagnostics without spawning ADB or HTTP calls.
- Planner replaces automatic process control with safe dry-run checklist model requiring explicit `--authorize` token.
- Toggle state is stored in `settings.json` as `localSync.enabled` — pattern consistent across desktop and Android.
- Doctor now detects contradictory toggle/health states and reports as WARN/AMBIGUOUS rather than false PASS.

### PR3 Resolved

- All 5 PR3 tests pass: 3 clean CLI integration tests (dry-run default, ambiguous path rejection, declare deletes/preserves) + 2 state enrichment tests (full evidence model, duplicate SQLite rows).
- `dev-sync-clean.mjs` wraps reset errors in JSON output (`{ reset: { error: "..." } }`) rather than propagating them to stderr — a subtle design choice that tests must accommodate via `spawnSync` + JSON parsing.
- Evidence enrichment now covers SQLite table metadata, HLC ranges, tombstones per table, replicas per kind, duplicate rows, and graceful degradation when `sqlite3` CLI or replica API is unavailable.

### PR4 Resolved

- `dev-sync-fixture.mjs` had module-level CLI code that ran on import (`requireDevHarness` + `process.exit`), preventing vitest from importing the module. Fixed by wrapping CLI code in `isMain` guard.
- The inject functions (`injectDictionary`, `injectQuote`, `injectAnnotation`) were not exported — added `export` keyword.
- The inject functions called `injectRows` without required params — added `injectOpts` parameter with `resolveDefaults()` fallback.
- Created `TABLE_DB_KIND` mapping to resolve which SQLite DB file each table belongs to (`dictionary_entries`/`dictionary_occurrences` → `dictionary.db`, `quotes` → `citas.db`, `annotations` → `annotations.db`).
- Tests that dynamically import `.mjs` ESM modules in vitest must use `pathToFileURL(...).href` to get correct resolution.
- Reusable `epub-helper.ts` with `createEpubZip` and `createMinimalEpub` created for tests, using Python zipfile.
- All 132 tests passing (116 baseline + 16 new).

### PR5 Resolved

- PR5 added 13 focused tests for trigger/cycle failure semantics, semantic assertions, and golden report behavior. The final PR5 verify run passed 143/143 after PR6 residue was removed/quarantined.
- Tests that start an in-process HTTP server must use asynchronous child execution (`spawnNode`) instead of `spawnSync`; a synchronous child blocks the test process event loop and prevents the test server from answering trigger requests.
- `dev-sync-trigger.mjs` needed an `isMain` guard so tests and other scripts can import `evaluateTriggerPayload` without accidentally executing CLI behavior.
- Trigger and cycle evaluation now reject nested sync execution failures and partial evidence with explicit evidence paths, preventing false `PASS` results.
- Semantic assertions now compare logical state rather than only counts, including convergence, duplicate logical rows, idempotent repeated sync, HLC newer-wins, tombstones, semantic groups, and book-delete survival.
- Report generation now preserves `PASS/FAIL/WARN/AMBIGUOUS`, diagnosis, probable domain, unavailable evidence, cleanup outcome, and evidence paths. The CLI exits non-zero for failing report input.
- PR6 artifacts are intentionally quarantined at `/tmp/opencode/pr6-hold/`; do not restore them until the PR6 slice.

### PR6 Resolved

- PR6 added 4 focused docs/smoke tests and the final targeted run passed 147/147.
- Operator docs now separate manual responsibilities from safe CLI automation and explicitly block hidden build/install/redeploy/restart/destructive-clean/real-sync behavior.
- `dev-sync-smoke.mjs` is a plan/checklist CLI, not a Markdown runner or hidden automation runner; default tasks are non-mutating diagnostics only.
- Smoke evidence plan persistence uses `BIBLIOTECA_DEV_SYNC_SMOKE_DIR`, allowing tests to verify saved artifacts without writing to the default `/tmp/biblioteca-dev-sync/smoke` location.

### Cumulative Known Issues (from PR1+PR2+PR3+PR4+PR5+PR6)

- Engram topic_key upsert for `sdd/sync-crdt-hlc-ideal-harness/apply-progress` overwrote PR1 content when PR2 saved. Filesystem copy at `openspec/changes/sync-crdt-hlc-ideal-harness/apply-progress.md` has the complete TDD Cycle Evidence table and is the canonical source. See discovery #1033.
- Route-level sync trigger (`sync-trigger/route.ts`) propagates nested `sync-execute` failures as HTTP 500 — fixed in PR1.
- TypeScript strictness failures in `devSyncHarness.test.ts` and `route.ts` — all resolved in PR1.
- Full `tsgo --noEmit` still fails on out-of-scope files: 48 errors across 15 files (e.g. `bookshelf-citas.test.tsx`, `DebugSyncTrigger.test.tsx`, `Providers.test.tsx`, `crdtHlcInvariants.test.ts`, `localSyncUtils.ts`). These are pre-existing and unrelated.

---

## Final Risks / Follow-ups

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Working tree isolation** — The repository working tree contains many unrelated modified/untracked files beyond PR scope (Rust/Tauri sync internals, future harness scripts, API routes, package changes). Each PR must be staged/committed by file/hunk selection only. | Medium | File/hunk-level staging before PR creation; avoid committing all working tree changes. |
| **Full TypeScript remains red** — `tsgo --noEmit` still fails on out-of-scope files (48 errors across 15 files). This creates noise but is unrelated to this change. | Low | Out of scope; pre-existing failures. |
| **Engram topic_key overwrite risk** — Using the same `topic_key` (`sdd/sync-crdt-hlc-ideal-harness/apply-progress`) for PR1 and PR2 caused PR2 to overwrite PR1 content in Engram. Future PR slices (PR3–PR6) using the same key will overwrite cumulative progress. | Medium | Use distinct topic keys per slice (e.g. `/apply-progress-pr3`) or ensure filesystem copy is always canonical. Documented in discovery #1033. |
| **Coverage gap** — Node `.mjs` scripts are not instrumented by the current Vitest coverage configuration. Future PR slices adding script logic will not produce per-file coverage metrics. | Low-Medium | Consider adding Node-script coverage instrumentation when script-heavy slices (PR3–PR5) are implemented. |
| **`pnpm test -- <file>` invokes broader suite** — The package script for targeted harness testing invokes the full app suite (unrelated failures). Workaround: use `pnpm exec vitest run <file>` directly. | Low | Documented workaround; future PR could add a focused package script. |
| **PR6 quarantine** — Docs/smoke artifacts are intentionally held outside the repo at `/tmp/opencode/pr6-hold/`. Restoring them before PR6 would contaminate PR5 packaging. | Medium | Restore only during PR6. Keep PR5 source/package/test boundary free of smoke docs/scripts. |
| **Stale generated cache strings** — Ignored `.next/` cache can still contain old `dev:sync:smoke` strings from pre-quarantine work. | Low | Treat generated cache matches as non-source noise; avoid destructive cache cleanup unless explicitly authorized. |

### Final Known Issues

- Full project build/type-check was not run because the archive request and project standards prohibit builds. PR6 verification used the targeted harness test evidence from verify-report-pr6.
- Real device smoke was not executed by this archive phase; PR6 deliberately provides a safe non-mutating plan/checklist and requires explicit operator authorization for destructive clean, real sync trigger, RSA prompts, build/install/redeploy/restart, or other risky actions.

---

## SDD Cycle Status

```
Proposal → Spec → Design → Tasks → Apply → Verify → Archive ✅
                                              Apply → Verify → Archive ✅ (PR2)
                                               Apply → Verify → Archive ✅ (PR3)
                                               Apply → Verify → Archive ✅ (PR4)
                                               Apply → Verify → Archive ✅ (PR5)
                                              Apply → Verify → Archive ✅ (PR6/final)
```

PR1, PR2, PR3, PR4, PR5, and PR6 of `sync-crdt-hlc-ideal-harness` have been fully planned, implemented, verified, and archived. The tasks artifact confirms **14/14 tasks complete**. The overall SDD cycle is closed.

**Next recommended**: None for this change. Future work, if desired, can add a standalone non-mutating smoke-plan validator outside this completed SDD change.
