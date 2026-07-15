# Tasks: Add Phase 2 Harness Capabilities

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700-1,100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 book edit → PR 2 import/reimport → PR 3 semantic delete → PR 4 reliability/final rerun |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Android book metadata edit (`9Ma`) | PR 1 | Base `main`; tests with mocked HTTP/index evidence. |
| 2 | Android import/reimport (`13Ma`) | PR 2 | Base PR 1; descriptor, asset upload, tombstone ordering tests. |
| 3 | Semantic BookNote/highlight delete (`14*`, `14M*`) | PR 3 | Base PR 2; desktop + Android resolver/config/replica tests. |
| 4 | Reliability runner and all-case rerun | PR 4 | Base PR 3; bounded repeat evidence and 8-case final report. |

## Phase 1: Android Book Edit TDD (`9Ma`)

- [x] 1.1 RED: add `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` coverage for `updateBookViaHttp()` preserving index fields and bumping timestamp/HLC.
- [x] 1.2 GREEN: add `getBooksIndexViaHttp()` and `updateBookViaHttp()` in `apps/readest-app/scripts/sync-dev-inject-http.mjs` with editable-field validation.
- [x] 1.3 RED/GREEN: test and route `--target android-http --edit books:*` in `apps/readest-app/scripts/dev-sync-fixture.mjs` for `9Ma` evidence.
- [x] 1.4 REFACTOR: ensure `sync-dev-state.mjs` captures before/after Android and desktop book index facts for `9Ma`.

## Phase 2: Android Import/Reimport TDD (`13Ma`)

- [x] 2.1 RED: test reusable EPUB descriptor export from `apps/readest-app/scripts/prepare-engine.mjs` without desktop-write assumptions.
- [x] 2.2 GREEN: expose descriptor `{hash,fileName,byteSize,metadata,entry}` and add `importBookViaHttp()` asset/config/index writes.
- [x] 2.3 RED/GREEN: route Android import and same-hash reimport in `dev-sync-fixture.mjs`, proving newer live entry beats tombstone.
- [x] 2.4 REFACTOR: extend state evidence to report hash, tombstone/live timestamp ordering, and missing-evidence diagnostics.

## Phase 3: Semantic Delete TDD (`14a/b/c`, `14Ma/Mb/Mc`)

- [x] 3.1 RED: add resolver tests for dictionary, quote, and annotation targets: exact match, zero match, multi-match ambiguity.
- [x] 3.2 GREEN: add semantic delete helpers in `sync-dev-inject-http.mjs` for `config.json booknotes[]` plus D/C/N tombstones.
- [x] 3.3 RED/GREEN: wire desktop and Android semantic delete flags in `dev-sync-fixture.mjs`, blocking ambiguous deletes safely.
- [x] 3.4 REFACTOR: extend `sync-dev-state.mjs` evidence so association-only removal with live semantic row reports FAIL.

## Phase 4: Reliability and Final Verification

- [x] 4.1 RED: add `dev-sync-cycle.mjs` tests for `runRepeat({attempts,minSuccessRate:0.8,timeoutMs})` classification and denominator rules.
- [x] 4.2 GREEN: implement bounded `--repeat N` report with numerator, denominator, case list, evidence paths, and failure domains.
- [x] 4.3 Run bounded real-device reliability for `9Ma`, `13Ma`, `14a`, `14b`, `14c`, `14Ma`, `14Mb`, `14Mc`; result: actionable FAIL, `0/5` definitive successes (`0%`) with evidence at `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783017078101-repeat.json`.
- [x] 4.4 Final rerun all 8 formerly blocked cases and attach evidence paths; result: all 8 reruns returned `WARN` with per-case JSON reports because state capture remained degraded by warnings (notably Android sqlite3 CLI unavailable), so no WARN was hidden as PASS.
- [x] 4.5 Follow-up RED/GREEN: classify child `WARN` attempts from nested evidence instead of `unknown`; focused repeat now reports Android sqlite3 CLI degradation as `environment`.
- [x] 4.6 Follow-up RED/GREEN: add case-ref action execution and acceptance verdict guards so `9Ma`, `13Ma`, and `14*` cases only PASS with explicit metadata/import/semantic deletion evidence.
- [x] 4.7 Follow-up cleanup: fix focused Biome warnings in changed harness files; focused lint now has 0 warnings.
- [x] 4.8 Follow-up bounded reliability rerun: still FAIL, `0/5`, but failure domain is now `environment: 5`; evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783018215958-repeat.json`.
- [x] 4.9 Follow-up RED: add Android state tests proving HTTP replica APIs can substitute row-level evidence when on-device `sqlite3` is unavailable, and that missing replica evidence remains `WARN`.
- [x] 4.10 Follow-up GREEN: add minimal Android SQLite HTTP replica fallback in `sync-dev-state.mjs` using `/replicas/dictionary-entry`, `/replicas/dictionary-occurrence`, `/replicas/annotation`, and `/replicas/quote` only when all required endpoints are reachable.
- [x] 4.11 Follow-up bounded reliability rerun: row-level fallback evidence appears in real-device JSON, but reliability remains FAIL `0/5`; new blocker surfaced as no live book hash available after prior clean/tombstone state. Evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783018775989-repeat.json`.
- [x] 4.12 Follow-up RED: add `dev-sync-cycle.test.mjs` coverage for Phase 2 case execution after clean when only tombstoned/no book facts exist; the test requires sample EPUB seeding on Android before case actions.
- [x] 4.13 Follow-up GREEN: add minimal `ensurePhase2LiveBook()` seeding through existing `createEpubImportDescriptor()` + `importBookViaHttp()` before `9Ma`, `13Ma`, and `14*` actions; setup failures remain `WARN`/harness-classified, not false PASS.
- [x] 4.14 Follow-up verification: focused harness tests passed `80/80` (`76/76` Node + `4/4` Vitest) and focused Biome lint passed with 0 warnings. Phase 2 preflight passed, but bounded real-device reliability failed `0/5` (`0%`, failure domain reported `environment: 5`) with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783020002347-repeat.json`; all 8 formerly blocked case reruns returned `WARN`, not PASS, with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783020056105.json` through `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783020090979.json`.
- [x] 4.15 Follow-up RED/GREEN: fix Android same-hash reimport live resurrection evidence by writing full-index live entries with `deletedAt: null`, numeric `createdAt` newer than the tombstone, and clearing pending Android tombstone markers after successful live import. Focused Node harness tests passed `76/76`, focused Vitest passed `4/4`, and focused Biome lint passed. Bounded reliability rerun could not produce acceptance evidence after Android clean began failing before case execution (`/tmp/biblioteca-dev-sync/dev-sync-cycle-1783037690536-repeat.json`).
- [x] 4.16 Final verify rerun (2026-07-03): focused Node harness tests passed `76/76`, focused Vitest passed `4/4`, focused Biome lint passed, focused Vitest coverage command executed but was not meaningful for the Node harness files, `phase2.preflight` passed, bounded real-device reliability failed `0/5` (`0%`, failure domain `environment: 5`) with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783040942006-repeat.json`, and all eight formerly blocked cases reran as `WARN` with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783040992065.json` through `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783041039488.json`.
- [x] 4.17 Follow-up RED/GREEN: fix current acceptance-evidence gaps by seeding Android when Android has no live book even if desktop has a live/stale hash, resurrecting desktop `library.json` tombstones during seed so sync does not re-push stale deletes, and matching semantic-delete tombstone evidence by `semanticRowId`/`noteId`. Focused changed Node tests passed `26/26`; focused Biome lint passed. Bounded reliability improved to `1/5` with repeat evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783042198715-repeat.json`; individual reruns showed `13Ma` and all `14*` cases PASS, while `9Ma` remains WARN because desktop metadata convergence is still not proven after Android edit (`/tmp/biblioteca-dev-sync/dev-sync-cycle-1783042442639.json`).
- [x] 4.18 Follow-up RED/GREEN: fix remaining `9Ma` desktop metadata convergence evidence by requiring explicit Android edit action + successful sync + newer desktop timestamp before PASS, editing Android metadata with a timestamp newer than seed/import setup, and merging newer Android book metadata into desktop `library.json` during sync execution. Focused Node tests passed `27/27`; focused Vitest `sync-execute` tests passed `31/31`; focused Biome lint passed. Individual `9Ma` now PASS with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783043246901.json`; bounded reliability still FAIL `0/5` (`environment: 5`) with evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783043260718-repeat.json`.
- [x] 4.19 Follow-up RED/GREEN: fix repeat isolation for comma-separated case refs by running each case ref as its own bounded child execution per repeat attempt, preserving single-case repeat behavior. Focused RED tests first proved comma refs were sent as one stateful batch; GREEN tests passed `13/13` for `dev-sync-cycle.test.mjs`, focused harness tests passed `29/29`, and focused Biome lint passed. Phase 2 preflight passed; bounded 8-case reliability now PASS `40/40` (`100%`) with isolated per-case evidence at `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783061589013-repeat.json`.
