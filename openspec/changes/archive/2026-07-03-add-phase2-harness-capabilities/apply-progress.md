# Apply Progress — add-phase2-harness-capabilities

## Scope Applied

Slices 1-3 applied; Slice 4 reliability runner support partially applied:

- Slice 1: Android book metadata edit capability for `9Ma`.
- Slice 2: Android EPUB/book import and same-hash reimport capability for `13Ma`.
- Slice 3: semantic BookNote/highlight delete capability for `14a`, `14b`, `14c`, `14Ma`, `14Mb`, and `14Mc`.
- Slice 4 partial: bounded reliability metric and repeat report support in `dev-sync-cycle.mjs`; real-device repeated validation remains blocked by environment readiness.

## Mode

Strict TDD (from launch prompt and `sdd/biblioteca/testing-capabilities`).

## Completed Tasks

- [x] 1.1 RED: added focused `updateBookViaHttp()` tests for preserving Android `/books/index` fields, merging metadata, bumping `updatedAt`, and rejecting immutable fields before HTTP writes.
- [x] 1.2 GREEN: added `getBooksIndexViaHttp()` and `updateBookViaHttp()` in `sync-dev-inject-http.mjs` with editable-field validation and full-index PUT semantics.
- [x] 1.3 RED/GREEN: routed `--target android-http --edit books:*` through `updateBookViaHttp()` from `dev-sync-fixture.mjs`, preserving desktop book edit behavior.
- [x] 1.4 REFACTOR: extended `sync-dev-state.mjs` to capture desktop library book facts and Android `/books/index` facts for before/after `9Ma` evidence.
- [x] 2.1 RED: added `createEpubImportDescriptor()` tests proving descriptor generation does not write the desktop library and falls back to EPUB metadata.
- [x] 2.2 GREEN: exposed descriptor `{hash,fileName,byteSize,metadata,entry}` and added `importBookViaHttp()` for EPUB asset upload plus full-index live entry writes.
- [x] 2.3 RED/GREEN: routed `--target android-http --import-book` through descriptor generation and `importBookViaHttp()`, including newer-live-vs-tombstone ordering semantics.
- [x] 2.4 REFACTOR: extended Android state evidence with targeted `bookIndex.importEvidence` for hash presence, live/tombstone counts, timestamp ordering, and missing evidence diagnostics.
- [x] 3.1 RED: added resolver tests for dictionary, quote, and annotation semantic targets covering exact match, zero match, and multi-match ambiguity diagnostics.
- [x] 3.2 GREEN: added semantic delete helpers in `sync-dev-inject-http.mjs` to read/write per-book `config.json`, mark the resolved BookNote association deleted, and tombstone matching D/C/N replica rows.
- [x] 3.3 RED/GREEN: wired `--semantic-delete` CLI routing for Android HTTP and desktop targets through safe helpers that refuse missing or ambiguous targets before mutation.
- [x] 3.4 REFACTOR: extended `sync-dev-state.mjs` with `semanticDeleteEvidence` so association-only deletion with a live semantic row reports `fail` with kind/id diagnostics.
- [x] 4.1 RED: added focused `dev-sync-cycle.test.mjs` coverage for `runRepeat({attempts,minSuccessRate:0.8,timeoutMs})`, strict `>80%` threshold semantics, denominator rules, and failure classification.
- [x] 4.2 GREEN: implemented `runRepeat()`, `computeReliabilityReport()`, `classifyReliabilityFailure()`, and CLI `--repeat N` / `--repeat-timeout-ms` / `--min-success-rate` report output with numerator, denominator, case list, evidence paths, and failure domains.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit | ✅ 48/48 focused harness tests passed before edits | ✅ Written; `updateBookViaHttp` missing failed as expected | ✅ Focused tests passed after helper implementation | ✅ 2 cases: successful merge + immutable-field rejection | ✅ Shared GET/PUT/error helpers reused |
| 1.2 | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit | ✅ Same safety net | ✅ Helper tests referenced missing export | ✅ `getBooksIndexViaHttp` + `updateBookViaHttp` passed | ✅ Preserved full index and blocked invalid field path | ✅ Minimal pure helpers for index payload and timestamp normalization |
| 1.3 | `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | CLI unit | ✅ 48/48 focused harness tests passed before edits | ✅ Android book edit route failed with prior desktop-only error | ✅ Route calls `updateBookViaHttp` with normalized updates | ✅ Existing desktop route + new Android route both covered | ✅ Dependency-injected helper keeps test seam consistent |
| 1.4 | `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Unit | ✅ 48/48 focused harness tests passed before edits | ✅ `bookIndex`/`library.facts` assertions failed before state capture support | ✅ State tests passed with book facts included | ✅ Android `/books/index` facts + desktop library facts covered | ✅ Shared `bookFactsFromRows()` for both paths |
| 2.1 | `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` | Unit | ✅ 53/53 node harness tests + 2/2 prepare tests passed before edits | ✅ Descriptor tests referenced missing export | ✅ Descriptor creates hash/file metadata/entry without library writes | ✅ Explicit metadata + EPUB fallback metadata cases | ✅ Reused descriptor in desktop import path |
| 2.2 | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit | ✅ Same safety net | ✅ `importBookViaHttp` missing export failed | ✅ Asset upload + `/books/index` live entry PUT passed | ✅ Success path + missing descriptor evidence + numeric tombstone ordering case | ✅ Numeric and ISO timestamp comparison extracted |
| 2.3 | `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | CLI unit | ✅ Same safety net | ✅ `--import-book` parse/dispatch failed as unknown | ✅ CLI routes descriptor + HTTP import helper | ✅ Parse coverage + dispatch dependency injection coverage | ✅ Import route isolated from existing create/edit/delete routes |
| 2.4 | `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Unit | ✅ Same safety net | ✅ `bookIndex.importEvidence` missing failed | ✅ State reports live/tombstone ordering and missing hash diagnostics | ✅ Pass evidence + missing-evidence evidence | ✅ Shared timestamp helpers support numeric Android tombstones |
| 3.1 | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit | ✅ 59/59 focused node harness tests passed before slice 3 edits | ✅ Resolver tests referenced missing `resolveSemanticHighlightTarget` export | ✅ Resolver handles dictionary/quote/annotation exact targets | ✅ Zero-match and multi-match ambiguity diagnostics covered | ✅ Shared row/id/booknote normalization helpers extracted |
| 3.2 | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit | ✅ Same safety net | ✅ Android semantic delete test referenced missing `deleteSemanticHighlightViaHttp` export | ✅ Config association and replica tombstone are written together | ✅ Config-only preservation and semantic tombstone body assertions covered | ✅ Minimal `get/putBookConfigViaHttp` and `getReplicasViaHttp` helpers reused |
| 3.3 | `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | CLI unit | ✅ 19/19 fixture CLI tests passed before CLI edits | ✅ `--semantic-delete` parsed as unknown before implementation | ✅ Android and desktop semantic delete routes dispatch to safe helpers | ✅ Android HTTP route + desktop helper route + parse coverage | ✅ Target object normalization isolated from operation dispatch |
| 3.4 | `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Unit | ✅ 11/11 state tests passed before evidence edits | ✅ `semanticDeleteEvidence` was undefined for association-only deletion | ✅ Evidence reports `fail` when BookNote is deleted but semantic row is live | ✅ Live-row failure path plus existing state evidence paths remain covered | ✅ Shared replica field/id/deleted helpers keep diagnostics deterministic |
| 4.1 | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ No pre-existing `dev-sync-cycle` unit test file; RED run failed on missing `classifyReliabilityFailure` export | ✅ Tests referenced missing repeat/classification exports and failed before production code | ✅ Focused reliability tests pass after implementation | ✅ Cases cover exact 80% failure, blocked/ambiguous/timeout/environment denominator inclusion, and all failure domains | ✅ Classification/report helpers kept pure and deterministic |
| 4.2 | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | CLI-adjacent unit | ✅ Same safety net | ✅ Report assertions referenced missing `runRepeat`/`computeReliabilityReport` behavior | ✅ Focused reliability tests pass with bounded child-attempt support | ✅ Report includes numerator, denominator, caseRefs, evidencePaths, successRate, attempts, and failureDomains | ✅ CLI repeat argument removal isolated from legacy single-step/multi-step/pipeline paths |

## Test Summary

- **Total tests written/updated this slice**: 3 focused reliability runner cases in `dev-sync-cycle.test.mjs`.
- **Total tests passing this slice**: 69/69 focused node harness tests.
- **Layers used**: Unit and CLI unit.
- **Approval tests**: None — no pure refactoring-only task.
- **Pure functions created**: reliability helpers (`classifyReliabilityFailure`, `computeReliabilityReport`, repeat attempt normalization) in addition to prior semantic resolver/evidence helpers.

## Verification Commands

```bash
node --test "scripts/__tests__/sync-dev-inject-http.test.mjs" "scripts/__tests__/dev-sync-fixture.test.mjs" "scripts/__tests__/sync-dev-state.test.mjs"
node --test "scripts/__tests__/dev-sync-cycle.test.mjs" "scripts/__tests__/sync-dev-inject-http.test.mjs" "scripts/__tests__/dev-sync-fixture.test.mjs" "scripts/__tests__/sync-dev-state.test.mjs"
```

Result: focused reliability command passed (`3/3`), then focused harness command passed (`69/69` node harness tests).

Note: attempting to run `android-clean-reinit-integration.test.mjs` with `node --test` fails before assertions because that file imports `vitest` globals and must be run through Vitest, not Node's test runner.

## Real-device Smoke

- Bounded real-device reliability was not run because `dev-sync-doctor --json` reports Phase 2 preflight blocked: Android app process absent, no ADB forward, Android `/health` and `/books/manifest` unreachable, and desktop dev sync health/trigger unreachable.
- Command left for verify once ready:

```bash
BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/dev-sync-cycle.mjs --repeat 5 --repeat-timeout-ms 120000 --case-ref 9Ma,13Ma,14a,14b,14c,14Ma,14Mb,14Mc --min-success-rate 0.8 --clean-android
```

## Deviations from Design

- `putBookConfigViaHttp()` writes JSON directly to `/books/:hash/config`; this is the minimal direct BookConfig HTTP update needed for semantic delete until the Android server exposes a richer config mutation endpoint.
- Desktop semantic delete is implemented in the fixture router using the same resolver contract plus local `config.json`/SQLite writes, not in product code.
- `--repeat` shells out to the existing `dev-sync-cycle.mjs` path with repeat-only flags stripped, rather than duplicating single-step/multi-step/pipeline execution logic in-process.

## Issues / Follow-ups

- Ambiguous or missing semantic targets return structured diagnostics and do not mutate config or replicas.
- `semanticDeleteEvidence` currently targets Android HTTP state capture for the association-only false PASS guard; desktop route behavior is covered at CLI dispatch/helper level.
- Reliability metric support is implemented, but final repeated real-device validation remains blocked until Android and desktop harness endpoints are running and ADB forwarding is restored.

## Verification Follow-up

- [x] Phase 4: Reliability runner/metric and bounded report output.
- [x] Phase 4: Bounded real-device reliability validation and final 8-case rerun executed during verify.
- [x] Follow-up: added nested-evidence classification for child `WARN` attempts so Android sqlite3 CLI degradation is reported as `environment` instead of `unknown`.
- [x] Follow-up: added case-ref action execution and acceptance guards for `9Ma`, `13Ma`, and `14*`; cases do not PASS unless explicit convergence/import/semantic-delete evidence is present.
- [x] Follow-up: fixed focused Biome warnings in changed harness files.
- [x] Follow-up: added Android HTTP replica fallback for row-level state capture when on-device `sqlite3` is unavailable; fallback uses existing `/replicas/:kind` endpoints and only marks SQLite evidence pass when every mapped endpoint for that DB kind is reachable.

### Verify Runtime Evidence (2026-07-02)

- Real-device reliability command: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/dev-sync-cycle.mjs --repeat 5 --repeat-timeout-ms 120000 --case-ref 9Ma,13Ma,14a,14b,14c,14Ma,14Mb,14Mc --min-success-rate 0.8 --clean-android`
- Result: actionable FAIL — `0/5` definitive successes, success rate `0%`, evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783017078101-repeat.json`.
- Final 8-case rerun: all cases returned `WARN` rather than PASS, with per-case JSON reports under `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783017120988.json` through `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783017141157.json`; state capture remained degraded by warnings, notably Android sqlite3 CLI unavailable.

### Apply Follow-up Evidence (2026-07-02)

- Focused Node tests: `72/72` passed.
- Focused Vitest: `4/4` passed.
- Focused Biome lint: `0` warnings.
- Bounded reliability rerun: still `0/5` definitive successes, but failure domains now classify as `environment: 5`; evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783018215958-repeat.json`.
- Historical blocker before HTTP fallback: Android `sqlite3` CLI was unavailable on-device, so row-level Android SQLite capture remained WARN and real-device attempts were not definitive PASS.

### Apply Follow-up Evidence (2026-07-02 — HTTP row fallback)

- Safety net: `node --test "scripts/__tests__/sync-dev-state.test.mjs"` passed `12/12` before edits.
- RED: new HTTP row fallback test failed before implementation (`state.status` stayed `warn` instead of `pass`).
- GREEN: `node --test "scripts/__tests__/sync-dev-state.test.mjs"` passed `14/14` after implementation.
- Focused Node harness tests: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs" "scripts/__tests__/sync-dev-inject-http.test.mjs" "scripts/__tests__/dev-sync-fixture.test.mjs" "scripts/__tests__/sync-dev-state.test.mjs"` passed `74/74`.
- Focused Biome lint: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm exec biome lint "scripts/sync-dev-state.mjs" "scripts/__tests__/sync-dev-state.test.mjs"` passed with `0` warnings.
- Doctor: Phase 2 preflight passed; Android sqlite3 still `warn`, Android replicas API `pass`.
- Bounded reliability rerun: still `0/5` definitive successes; evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783018775989-repeat.json`.
- Real-device child evidence confirms row-level fallback is active: Android `sqlite.dictionary`, `sqlite.annotations`, and `sqlite.quotes` have `source: "http-replica-fallback"` with `status: "pass"` in `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783018776015.json`.
- New remaining blocker exposed after row-level fallback: no live book hash is available for Phase 2 case execution (`caseActions[0].error: "no live book hash available for Phase 2 case"`), while the previous sqlite row-level WARN is no longer the blocker.

### Apply Follow-up Evidence (2026-07-02 — Phase 2 live book seed)

- Safety net: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs"` passed `6/6` before this follow-up edit.
- RED: new `ensurePhase2LiveBook()` tests failed before implementation because `dev-sync-cycle.mjs` did not export or implement sample EPUB seeding.
- GREEN: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs"` passed `8/8` after implementation and harness-setup classification.
- Focused Node harness tests: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs" "scripts/__tests__/sync-dev-inject-http.test.mjs" "scripts/__tests__/dev-sync-fixture.test.mjs" "scripts/__tests__/sync-dev-state.test.mjs"` passed `76/76`.
- Focused Biome lint: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm exec biome lint "scripts/dev-sync-cycle.mjs" "scripts/__tests__/dev-sync-cycle.test.mjs"` passed with `0` warnings.
- Doctor/readiness: bounded reliability was not rerun because Phase 2 preflight currently fails; Android `/health` timed out and `/books/manifest` was unreachable, while desktop sync endpoints passed.
- Current blocker addressed in code: when clean/reinit leaves no live book hash, Phase 2 case action preparation now imports `sample-alice.epub` on Android via existing descriptor/import helpers before running `9Ma`, `13Ma`, and `14*` actions.
- No false PASS guard: if sample EPUB seeding fails, `caseActions` records `action: "phase2-live-book-seed"` with exact `harness setup failed: unable to seed live book...` reason, and reliability classification treats that as `harness`.

### TDD Cycle Evidence — HTTP row fallback

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.9-4.10 | `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Unit | ✅ 12/12 existing sync-dev-state tests passed | ✅ HTTP fallback test failed because sqlite warnings were not replaced | ✅ 14/14 sync-dev-state tests passed after fallback implementation | ✅ Success fallback + missing HTTP evidence WARN cases | ✅ Small pure mapping helpers in `sync-dev-state.mjs` |
| 4.12-4.13 | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit / harness prep | ✅ 6/6 existing dev-sync-cycle tests passed | ✅ Missing `ensurePhase2LiveBook` export failed before implementation | ✅ 8/8 dev-sync-cycle tests and 76/76 focused harness tests passed | ✅ Seed success after tombstone-only state + seed failure exact reason + harness classification | ✅ Reused existing descriptor/import helpers and shared sample EPUB path |

## Workload / PR Boundary

- Mode: stacked PR slice.
- Current work unit: Unit 4 — reliability runner and final bounded rerun support.
- Boundary: starts after slice 3 semantic delete helpers; ends with repeat metric/report support, Android HTTP row fallback, and Phase 2 live-book seeding after clean/reinit.
- Estimated review budget impact: slice-local changes in `dev-sync-cycle.mjs`, one focused test file, and SDD artifact updates; real-device evidence remains verify/runtime output.

## Status

16/16 original tasks plus follow-up tasks 4.5-4.18 executed. The final remaining `9Ma` evidence gap was fixed without broadening other cases: Android edit PASS now requires explicit action evidence, a successful sync attempt, Android/desktop matching edited title, and newer Android plus desktop timestamps; sync execution now merges newer Android book metadata into desktop `library.json` so convergence is visible in post-state evidence.

### Apply Follow-up Evidence (2026-07-03 — acceptance evidence gaps)

- Safety net: `node --test scripts/__tests__/dev-sync-cycle.test.mjs scripts/__tests__/sync-dev-state.test.mjs` passed after the GREEN changes (`26/26`).
- RED: focused tests first reproduced stale env/desktop hash trust after Android clean and semantic tombstone rows being reported as `missing-evidence`.
- GREEN: focused changed tests passed `26/26`; focused Biome lint passed on `dev-sync-cycle.mjs`, `sync-dev-state.mjs`, and their tests.
- Doctor/readiness: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/dev-sync-doctor.mjs --json` returned `phase2.preflight: pass`; only Android on-device `sqlite3` remained WARN with HTTP replica fallback reachable.
- Bounded reliability rerun: improved from `0/5` to `1/5`, still below `>80%`; evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783042198715-repeat.json`, child evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783042198752.json` through `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783042227459.json`.
- Individual case reruns after the fix: `13Ma`, `14a`, `14b`, `14c`, `14Ma`, `14Mb`, and `14Mc` returned PASS; `9Ma` remains WARN with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783042442639.json` because the Android edit action updates Android, but desktop metadata convergence is still not proven in the final post-state.

### TDD Cycle Evidence — acceptance evidence follow-up

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.17 live book evidence | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit / harness prep | ✅ Existing focused test file passed before changes | ✅ Stale env/desktop hash tests failed before implementation | ✅ Android seed + desktop resurrection tests passed | ✅ Tombstone-only state and desktop-live/Android-empty state | ✅ Isolated Android-live selection and desktop library resurrection helper |
| 4.17 semantic post-state evidence | `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Unit | ✅ Existing focused state tests passed before changes | ✅ Tombstone row + deleted BookNote still returned `missing-evidence` | ✅ PASS requires tombstone row and deleted association | ✅ PASS tombstone case plus missing-row case stays `missing-evidence` | ✅ Minimal direct `semanticRowId`/`noteId` evidence path |

### Apply Follow-up Evidence (2026-07-03 — 9Ma desktop metadata convergence)

- Safety net: `node --test scripts/__tests__/dev-sync-cycle.test.mjs` passed `10/10` before this follow-up edit.
- RED: new `9Ma` tests failed because post-state-only matches could PASS without explicit Android edit/sync evidence, and desktop title matches could PASS without a newer desktop timestamp.
- GREEN: `node --test scripts/__tests__/dev-sync-cycle.test.mjs scripts/__tests__/sync-dev-state.test.mjs` passed `27/27`; `pnpm exec vitest run scripts/__tests__/sync-execute.test.mjs` passed `31/31`.
- Focused Biome lint: `pnpm exec biome lint scripts/dev-sync-cycle.mjs scripts/__tests__/dev-sync-cycle.test.mjs scripts/sync-execute.mjs scripts/__tests__/sync-execute.test.mjs` passed with no warnings/errors.
- Runtime evidence: individual `9Ma` PASS at `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783043246901.json`; post desktop and Android facts share title `Phase2 9Ma dev-sync-cycle-1783043246901` with updatedAt `2026-07-03T01:47:29.487Z`, after an explicit Android book edit action and successful trigger.
- Bounded reliability rerun: still FAIL `0/5` (`environment: 5`), evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783043260718-repeat.json`.

### TDD Cycle Evidence — 9Ma desktop convergence follow-up

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.18 9Ma no false PASS guard | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit / acceptance guard | ✅ 10/10 existing focused tests passed | ✅ Missing action/sync and stale desktop timestamp cases returned PASS before implementation | ✅ 11/11 dev-sync-cycle tests passed after guard update | ✅ Explicit action+sync success, missing action, failed sync, unchanged state, and stale desktop timestamp | ✅ Small `successful9MaAction()` helper and context-aware verdict path |
| 4.18 desktop metadata pull | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit / sync merge | ✅ Focused sync-execute tests executed as RED baseline for new missing exports | ✅ Newer Android metadata merge helpers were missing | ✅ 31/31 sync-execute tests passed after merge implementation | ✅ Newer remote metadata, older remote metadata ignored, and file-write evidence | ✅ Reused existing book timestamp normalization and index payload helpers |

### Apply Follow-up Evidence (2026-07-03 — repeat case-ref isolation)

- Scope: fixed only reliability runner isolation/ordering. No new harness case capability was added.
- Safety net / RED: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs"` failed after adding tests because `runRepeat()` invoked one child per repeat with `caseRef: undefined`, so comma-separated refs still ran as one stateful batch.
- GREEN: `runRepeat()` now expands non-empty `caseRefs` inside each repeat attempt and passes the active `caseRef` to the child attempt; CLI repeat child args replace `--case-ref` with that single ref. Single-case repeat still runs one child per repeat.
- Focused tests: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs"` passed `13/13`.
- Focused harness tests: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node --test "scripts/__tests__/dev-sync-cycle.test.mjs" "scripts/__tests__/sync-dev-state.test.mjs"` passed `29/29`.
- Focused Biome lint: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm exec biome lint "scripts/dev-sync-cycle.mjs" "scripts/__tests__/dev-sync-cycle.test.mjs"` passed with no warnings/errors.
- Readiness: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/dev-sync-doctor.mjs --json` returned `phase2.preflight: pass` (overall status `warn` only because Android on-device `sqlite3` is unavailable; HTTP replica fallback remains reachable).
- Bounded reliability: `BIBLIOTECA_DEV_SYNC_HARNESS=1 node scripts/dev-sync-cycle.mjs --repeat 5 --repeat-timeout-ms 120000 --case-ref 9Ma,13Ma,14a,14b,14c,14Ma,14Mb,14Mc --min-success-rate 0.8 --clean-android` passed `40/40` (`100%`), evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783061589013-repeat.json`.

### TDD Cycle Evidence — repeat case-ref isolation follow-up

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.19 repeat case-ref isolation | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit / reliability runner | ✅ Existing focused file passed before behavior test addition | ✅ New comma-separated repeat test failed: child attempts received `caseRef: undefined` and denominator stayed stateful-batch sized | ✅ `13/13` dev-sync-cycle tests and `29/29` focused harness tests passed | ✅ Multi-case `9Ma,13Ma` expands to per-case attempts; single-case `14a` remains one child per repeat | ✅ Minimal `setFlagValue()`/child-arg replacement helper; no broader harness capability changes |

## Current Status

All original tasks plus follow-up tasks 4.5-4.19 are complete. The reliability gate now passes with isolated per-case repeat executions (`40/40`, `100%`) and no later case can invalidate earlier case acceptance evidence within the same child run.
