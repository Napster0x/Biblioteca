# Apply Progress — fix-phase4-real-conflicts-reliability

## Scope Applied
Slices 1–5 plus post-rerun regression fix, post-fix real-device verification, Product-failures Slices A–E, the harness `spawnSync` ENOBUFS buffering fix, and the env-var propagation + pre-cycle cleanup slice cumulative. Slices 1–4 completed diagnostics/failureDomain, Android fallback/config evidence, 21a–21d convergence evidence/fixes, and case-22 evidence hardening. Slice 5 completed the bounded real-device rerun/reporting and exposed a repeat aggregation regression: non-pass attempts with `unavailableEvidence: ["android.sqlite3"]` were still classified as `environment`. The regression fix updated only repeat aggregation/failureDomain in `dev-sync-cycle`; the follow-up real-device rerun confirms aggregate classification is now `product`, not `environment`, while reliability still fails at 6/14 PASS. Product-failures Slice A fixes root cause #1 by preserving existing Android HTTP replica identity fields before converting partial fixture edits to complete `ReplicaRow` payloads. Product-failures Slice B fixes the 21/22 same-entity fixture/assertion model by resolving dictionary/annotation assertions through semantic keys plus HLC gates while keeping duplicate semantic rows as failures. Product-failures Slice C isolates case 24 by making fixture note/CFI metadata run-scoped and asserting by returned `annIds`. Product-failures Slice D hardens BookNote config evidence for 25/26 by making mutation/invalid-ref helpers prove the target `noteId` was present and changed, or fail explicitly with no-op evidence. Product-failures Slice E reran real devices and exposed `spawnSync /usr/bin/node ENOBUFS` from case 22a onward; the minimal harness buffering fix now gives repeat child attempts an explicit large stdout/stderr buffer without hiding non-zero child exits. The env-var propagation + pre-cycle cleanup slice adds explicit `BIBLIOTECA_DEV_SYNC_HARNESS=1` to `buildStateJsonSpawnOptions` (wired into `spawnStateJson`) and introduces `ensurePreCycleCleanup` with `--clean-before` in repeat child args so accumulated desktop/Android replicas don't contaminate Phase 4 assertions.

## Mode
Strict TDD (from launch prompt and `sdd/biblioteca/testing-capabilities`).

## Completed Tasks
- [x] 1.1 Added RED tests in `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` proving Android `sqlite3` absence does not contaminate a product convergence mismatch as `environment`, while ADB/HTTP-health blockers remain `environment`.
- [x] 1.2 Updated 22b expectation to explicit `blocked`; existing 22/24/25/26 incomplete-evidence WARN cap coverage remains in focused `dev-sync-cycle` tests.
- [x] 1.3 Added RED test in `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` proving Android `sqlite3` failure still records HTTP replica row payloads, manifest/index, `config.json` BookNote evidence, and `unavailableEvidence: android.sqlite3`.
- [x] 2.1 Updated `apps/readest-app/scripts/dev-sync-cycle.mjs` to normalize `failureDomain`, `failureReason`, per-attempt `unavailableEvidence`, report-level `unavailableEvidence`, and explicit 22b `blocked` verdict.
- [x] 2.2 Updated `apps/readest-app/scripts/sync-dev-state.mjs` Android fallback to preserve HTTP replica rows/HLC/deleted counts and surface `android.sqlite3` as unavailable evidence without treating fallback as an environment failure.
- [x] Slice 3 partial: added RED coverage and GREEN fix for case 21c desktop book edits so `--hlc` is forwarded to `updateBook` and desktop title edits use deterministic fixture timestamps like Android HTTP title edits.
- [x] 1.4 / 2.3 Closed remaining 21a, 21b, and 21d convergence tasks by evidence: no new `sync-execute.mjs` production changes were needed because focused tests already pass for `hlcGt()` full tuple ordering including nodeId, `rowToReplica()` max HLC selection from field envelopes, and per-kind `filterUnchangedReplicas()` semantic duplicate suppression for dictionary/annotation paths.
- [x] 3.1 Added shared Phase 4 evidence helpers in `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` (`bookConfigWithNotes`, `phase4BookConfigState`, `case22Action`) so harness/classification fixtures remain test-local and product merge code remains isolated.
- [x] 3.2 Hardened `apps/readest-app/scripts/dev-sync-cycle.mjs` case 22 verdicts so `22a`/`22c` return `warn`, not `pass`, when entity state is plausible but delete/edit HLC ordering evidence is absent.
- [x] 5.1 Added RED repeat aggregation regression coverage for product and harness attempts carrying `unavailableEvidence: ["android.sqlite3"]`, plus a true ADB/HTTP-health environment blocker triangulation case.
- [x] 5.2 Narrowed `classifyReliabilityFailure()` so executable product/harness evidence is classified before non-blocking Android/sqlite diagnostic text; environment remains reserved for actual blocking prerequisites such as ADB offline, network errors, preflight failures, timeout, or HTTP-health failures.
- [x] 5.3 Ran focused `dev-sync-cycle` Node tests; next step is a real-device rerun outside this apply.
- [x] 7.1–7.3 Added RED coverage in `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` for Android HTTP partial edits preserving dictionary (`term`, `displayTerm`, `language`), annotation (`bookHash`, `cfi`, `text`), and quote (`bookHash`, `cfi`, `text`) identity fields.
- [x] 7.4 Updated `apps/readest-app/scripts/sync-dev-inject-http.mjs` so `updateReplicaViaHttp()` reads existing HTTP replicas and merges existing field values/timestamps before `rowToReplica()` converts the update to a complete `ReplicaRow`.
- [x] 7.5 Ran focused HTTP inject and fixture routing tests; no build and no commit performed.
- [x] 8.1–8.2 Added RED `dev-sync-cycle.test.mjs` coverage for 21 semantic duplicate failures, 21b run-scoped semantic text, 21d HLC winner evidence, and 22a/22c paired desktop/Android IDs resolved by semantic key with duplicates still failing.
- [x] 8.3 Updated `apps/readest-app/scripts/dev-sync-cycle.mjs` case 21/22 verdict helpers to resolve dictionary/annotation rows by semantic key when local IDs differ, enforce delete/edit HLC evidence for 22, require 21d to converge to an actual edit winner, and fail duplicate semantic rows.
- [x] 8.4 Updated case 21b/22c setup metadata to use run-scoped annotation text/CFI in fixture actions so real reports carry the semantic key needed by the assertion model.
- [x] 8.5 Ran focused `dev-sync-cycle` and `dev-sync-fixture` tests; no build and no commit performed.
- [x] Slice C added RED/GREEN case-24 coverage proving stale pre-existing `Idea A`/`Idea B` rows do not contaminate current-run `annIds`, duplicate/lost run annotations still fail, and setup returns run-scoped notes/CFI plus real annotation IDs.
- [x] Slice C updated `setupCase24Ref()` and `computeCase24Verdict()` in `dev-sync-cycle.mjs` to use run-scoped fixture metadata and annId-based assertions before falling back to legacy delta counts.
- [x] 9.1–9.2 Added RED/GREEN `dev-sync-fixture.test.mjs` coverage proving Android BookNote mutation/invalid-ref helpers fail explicitly when the target `noteId` is absent from an existing config or when the requested mutation would be a no-op.
- [x] 9.3 Added RED/GREEN `dev-sync-cycle.test.mjs` setup coverage proving cases 25/26 propagate BookNote mutation/invalid-ref failures instead of treating untouched stale config as successful setup evidence.
- [x] 9.4 Updated `injectBookNoteMutation()` and `injectInvalidBookNoteRef()` in `dev-sync-fixture.mjs` to require target-note presence and changed target-note JSON before persisting config updates; successful mutations now return `changed: true`.
- [x] 9.5 Ran focused BookNote fixture/cycle tests; no build and no commit performed.
- [x] 11.1 Added RED `dev-sync-cycle.test.mjs` coverage proving repeat child attempts configure a large stdout/stderr buffer (`>=64MiB`) while preserving `encoding: "utf8"`, `stdio: "pipe"`, and timeout propagation.
- [x] 11.2 Updated `runCycleChildAttempt()` to use exported `buildCycleChildSpawnOptions()` with explicit `maxBuffer: 64 * 1024 * 1024` and kept command failures visible via `result.error`, `result.status`, stderr, and timeout handling.
- [x] 11.3 Ran focused `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"`; no build and no commit performed.
- [x] 12.1 Added RED `dev-sync-cycle.test.mjs` coverage for `buildStateJsonSpawnOptions` propagating `BIBLIOTECA_DEV_SYNC_HARNESS=1`.
- [x] 12.2 Added RED `dev-sync-cycle.test.mjs` coverage for `ensurePreCycleCleanup` success/partial-failure and `buildRepeatChildArgs` including `--clean-before`.
- [x] 12.3 Implemented `buildStateJsonSpawnOptions()` with explicit env var and wired it into `spawnStateJson`; implemented `ensurePreCycleCleanup()` for desktop + Android cleanup; added `--clean-before` to `buildRepeatChildArgs` and handled it in `main()`.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 2.1 failureDomain diagnostics | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 137/137 baseline | ✅ RED failed: product mismatch + sqlite3 was `environment`; missing `failureReason` | ✅ 139/139 final | ✅ Product mismatch + environment blocker cases | ✅ Minimal helper extraction: unavailable evidence and first failure reason |
| 1.2 / 2.1 22b blocked | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ same baseline | ✅ RED failed: 22b returned `warn` | ✅ 139/139 final | ➖ Single blocked-contract case | ✅ Minimal route/value change only |
| 1.3 / 2.2 Android fallback/config evidence | `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Unit | ✅ 18/18 baseline | ✅ RED failed: `state.unavailableEvidence` was `undefined` and fallback tables lacked row payload evidence | ✅ 19/19 after implementation | ✅ Added missing-HTTP-replica WARN path assertion that still exposes `android.sqlite3` as unavailable evidence | ✅ Minimal helper: `unavailableEvidenceFromSqlite`; preserved existing fallback structure |
| Slice 3 / 21c desktop book edit HLC | `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | Unit | ✅ 47/47 baseline | ✅ RED failed: desktop book edit did not pass `now`; `updateBook` wrote wall-clock instead of explicit numeric/HLC timestamp | ✅ 50/50 final | ✅ Numeric timestamp converts to ISO; HLC string is preserved for tuple evidence | ✅ Minimal parity with Android `updateBookViaHttp` `options.now` contract |
| 1.4 / 2.3 21a/21b/21d convergence close | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit | ✅ 61/61 focused verification | ➖ No new RED: evidence showed root contracts already fixed before this continuation, so no production change was justified | ✅ 61/61 focused verification | ✅ Existing cases cover higher counter, field-HLC max, semantic duplicate filtering for dictionary/annotation kinds, and nodeId tiebreak | ➖ None needed |
| 3.1 / 3.2 refactor + evidence hardening | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 139/139 baseline | ✅ RED failed: 139/141 pass, 2 expected failures where `22a`/`22c` returned `pass` without HLC ordering evidence | ✅ 141/141 final | ✅ Dictionary and annotation edit-vs-delete paths both covered | ✅ Test fixture helpers extracted in `__tests__`; production change limited to evidence gate |
| 5.1 / 5.2 repeat aggregation failureDomain regression | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 141/141 baseline | ✅ RED failed: 141/142 pass; product attempt with Android/sqlite diagnostic text was classified `environment` | ✅ 142/142 final | ✅ Product mismatch, harness missing-evidence, and true ADB/HTTP-health blocker cases in one repeat report | ✅ Minimal classifier ordering/regex narrowing only |
| 7.1–7.4 Android HTTP partial edit identity preservation | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit | ✅ 32/32 baseline | ✅ RED failed: 32/35 pass; partial dictionary/annotation/quote edits wrote complete replicas without fetching existing identity fields | ✅ 35/35 final | ✅ Dictionary, annotation, and quote cases cover separate identity matrices | ✅ Minimal helper extraction in HTTP inject path; `rowToReplica()` contract unchanged |
| 8.1–8.4 21/22 same-entity semantic-key assertions | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 142/142 baseline | ✅ RED failed: 142/149 pass; 21 duplicate/stale-key/HLC-winner cases and 22 paired-ID semantic-key cases failed | ✅ 149/149 final | ✅ Dictionary, annotation, duplicate, HLC-winner, and edit-vs-delete paths covered | ✅ Shared local helpers for semantic lookup/state/duplicates; no product merge changes |
| Slice C case 24 run isolation | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ Prior focused suite green before this slice (149/149 recorded) | ✅ RED failed: `setupCase24Ref` export absent; new stale-prestate assertion written before implementation | ✅ 152/152 final | ✅ Stale pre-state pass-by-annIds, duplicate row fail, lost annId fail, and setup metadata covered | ✅ Minimal row helpers; legacy delta fallback preserved |
| 9.1–9.4 BookNote config evidence for 25/26 | `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs`, `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 50/50 fixture + 152/152 cycle baseline | ✅ RED failed: fixture 50/54 pass; stale/missing/no-op BookNote mutations returned OK or PUT attempts | ✅ 54/54 fixture + 154/154 cycle final | ✅ mutate missing target, mutate no-op, invalid-ref missing target, invalid-ref no-op, setup propagation for 25/26 | ✅ Small local helpers for target lookup/JSON equality; config writers unchanged otherwise |
| 11.1–11.2 harness spawnSync ENOBUFS buffering | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 154/154 baseline | ✅ RED failed: import error because `buildCycleChildSpawnOptions` did not exist | ✅ 155/155 final | ➖ Single configuration contract for verbose repeat-child JSON buffering | ✅ Minimal helper extraction; child failures remain explicit |
| 12.1–12.3 env-var propagation + pre-cycle cleanup | `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit | ✅ 155/155 baseline | ✅ RED failed: 155/159 pass; import errors because `buildStateJsonSpawnOptions`, `ensurePreCycleCleanup`, and `buildRepeatChildArgs` were not exported | ✅ 159/159 final | ✅ Defensive env-var with state-snapshot spawn options; cleanup success/partial-failure paths; repeat child --clean-before injection | ✅ Minimal helpers; shared DI pattern with existing `buildCycleChildSpawnOptions` |

## Verification
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — baseline before slice 1 edits: 137/137 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — RED after diagnostics tests: 137/139 pass, 2 expected failures.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — RED after 22b test: 138/139 pass, 1 expected failure.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — slice 1 final: 139/139 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs"` — slice 2 safety net baseline: 18/18 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs"` — slice 2 RED: 18/19 pass, 1 expected failure (`state.unavailableEvidence` undefined).
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs"` — slice 2 GREEN: 19/19 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs"` — slice 2 triangulation/final: 19/19 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — slice 3 safety net baseline: 47/47 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — slice 3 RED: 47/50 pass, 3 expected failures around missing desktop book-edit HLC propagation and wall-clock `updateBook` timestamps.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — slice 3 final: 50/50 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-inject.test.mjs"` — slice 3 final regression: 11/11 pass.
- ✅ `pnpm --filter biblioteca-app exec vitest run "scripts/__tests__/sync-execute.test.mjs"` — slice 3 final regression: 61/61 pass.
- ✅ `pnpm --filter biblioteca-app exec vitest run "scripts/__tests__/sync-execute.test.mjs"` — continuation 21a/21b/21d evidence check: 61/61 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — continuation case-21 acceptance/evidence regression: 139/139 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — continuation fixture regression: 50/50 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-inject.test.mjs"` — continuation inject regression: 11/11 pass.
- ⚠️ `node --test "apps/readest-app/scripts/__tests__/sync-execute.test.mjs"` — unsupported runner for this Vitest-style file; failed with Vitest runner context error before any implementation changes.
- ⚠️ `pnpm --filter biblioteca-app test -- --run "scripts/__tests__/sync-execute.test.mjs"` — command shape ran the broader suite and hit unrelated pre-existing failures; corrected to focused `pnpm --filter biblioteca-app exec vitest run ...`.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — slice 4 safety net baseline: 139/139 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — slice 4 RED: 139/141 pass, 2 expected failures proving case 22 could PASS without delete/edit HLC evidence.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — slice 4 GREEN/final: 141/141 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs"` — slice 4 focused regression: 19/19 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — slice 4 focused regression: 50/50 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-inject.test.mjs"` — slice 4 focused regression: 11/11 pass.
- ✅ `pnpm --filter biblioteca-app exec vitest run "scripts/__tests__/sync-execute.test.mjs"` — slice 4 focused regression: 61/61 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — post-rerun regression safety net: 141/141 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — RED: 141/142 pass; repeat aggregation promoted executable product evidence with `android.sqlite3` unavailable evidence to `environment`.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — GREEN/final: 142/142 pass.
- ❌ `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle -- --case-ref "21a,21b,21c,21d,22a,22c,23a,23b,23c,23d,23e,24,25,26" --repeat 1` — post-fix real-device rerun: 6/14 PASS (42.86%); aggregate failure domain recovered to `product: 8`, unavailable evidence remains `android.sqlite3: 14`.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs"` — safety net before Slice A edits: 32/32 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs"` — Slice A RED: 32/35 pass; partial dictionary/annotation/quote HTTP edit tests failed because `updateReplicaViaHttp()` did not read existing replicas before PUT.
- ✅ `node --test "apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs"` — Slice A GREEN/final: 35/35 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — focused routing regression: 50/50 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice B safety net baseline: 142/142 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice B RED: 142/149 pass; 7 expected failures for same-entity semantic-key and duplicate/HLC assertion gaps.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice B GREEN/final: 149/149 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — Slice B focused fixture regression: 50/50 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice C RED: failed because `setupCase24Ref` was not exported yet; new stale-prestate/annId assertions were written before implementation.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice C GREEN/final: 152/152 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs" && node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice D safety net baseline: 50/50 fixture and 152/152 cycle pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs" && node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice D RED: fixture 50/54 pass; four expected failures proved stale/missing target and no-op BookNote mutations still returned OK/PUT evidence.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs" && node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — Slice D GREEN/final: 54/54 fixture and 154/154 cycle pass.
- ❌ `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle -- --case-ref "21a,21b,21c,21d,22a,22c,23a,23b,23c,23d,23e,24,25,26" --repeat 1` — Slice E final real-device rerun after harness evidence fixes: 1/14 PASS (7.14%), report `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977394828-repeat.json`; aggregate `failureDomains.product: 13`, `unavailableEvidence.android.sqlite3: 4`, and cases 22a/22c/23a/23b/23c/23d/23e/24/25/26 failed before child evidence files were emitted with `spawnSync /usr/bin/node ENOBUFS`.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — spawnSync buffering safety net baseline: 154/154 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — spawnSync buffering RED: module import failed because `buildCycleChildSpawnOptions` was not exported yet.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — spawnSync buffering GREEN/final: 155/155 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — env-var + cleanup slice safety net baseline: 155/155 pass.
- ❌ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — env-var + cleanup RED: 155/159 pass; 4 expected failures because `buildStateJsonSpawnOptions`, `ensurePreCycleCleanup`, and `buildRepeatChildArgs` were not exported.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` — env-var + cleanup GREEN/final: 159/159 pass.
- ✅ `node --test "apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs"` — env-var + cleanup final regression: 54/54 pass.

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Slice 1: classified sqlite3 absence as unavailable evidence, not environment; added failure reason/evidence summaries; made 22b `blocked`. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Slice 1: added strict RED coverage for diagnostics classification and updated 22b expectation. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modified | Slice 2: added unavailable evidence extraction from Android SQLite fallback, preserved HTTP replica `rows` in fallback tables, and surfaced report-level `unavailableEvidence`. |
| `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Modified | Slice 2: added strict RED coverage for Android sqlite3-unavailable fallback preserving HTTP rows, manifest/index, BookConfig evidence, and unavailable evidence. |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modified | Slice 3: forwards explicit `--hlc` to desktop `updateBook` for book edits, matching Android HTTP book edit timestamp behavior. |
| `apps/readest-app/scripts/sync-dev-inject.mjs` | Modified | Slice 3: `updateBook` accepts explicit numeric/date/string `now` and writes `updatedAt` only when provided. |
| `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | Modified | Slice 3: added RED/GREEN coverage for 21c desktop book edit timestamp propagation and explicit `updateBook` timestamp handling. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Hybrid apply-progress artifact containing merged cumulative progress and the 21a/21b/21d evidence-only close. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Marked 1.4 and 2.3 complete with evidence-based wording; rerun/reporting tasks remain open. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Slice 4: added a case-22 HLC evidence gate so plausible state without delete/edit HLCs remains `warn`, not `pass`. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Slice 4: added shared Phase 4 evidence fixture helpers and RED/GREEN coverage for case 22 missing-HLC WARN caps. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Slice 4: merged cumulative apply-progress with TDD evidence, verification, and remaining tasks. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Slice 4: marked tasks 3.1 and 3.2 complete. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Post-rerun regression: product/harness failure signals are classified before non-blocking Android/sqlite diagnostic text; environment regex now targets actual blockers. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Post-rerun regression: added RED repeat aggregation coverage with `android.sqlite3` unavailable evidence plus product, harness, and true environment attempts. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Post-rerun regression: merged cumulative progress, TDD evidence, verification, and next rerun step. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Post-rerun regression: added and marked the minimal regression-fix tasks complete. |
| `apps/readest-app/scripts/sync-dev-inject-http.mjs` | Modified | Slice A: `updateReplicaViaHttp()` now fetches existing Android HTTP replica rows and merges existing identity values/timestamps before converting partial edits to complete replicas. |
| `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Modified | Slice A: added RED/GREEN dictionary, annotation, and quote partial-edit identity preservation tests; adjusted existing update tests for the read-before-write contract. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Slice A: merged cumulative apply-progress with TDD evidence, verification, and PR boundary. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Slice A: added and marked Android HTTP partial edit identity preservation tasks complete. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Slice B: case 21/22 verdicts now use semantic dictionary/annotation keys when desktop/Android local IDs differ, preserve duplicate checks, keep HLC gates, and carry run-scoped annotation text/CFI in 21b/22c setup actions. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Slice B: added RED/GREEN coverage for 21 duplicate semantic rows, 21b run-scoped semantic text, 21d actual edit-winner evidence, and 22a/22c paired-ID semantic assertions with duplicate failure checks. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Slice B: added and marked same-entity fixture/assertion model tasks complete. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Slice B: merged cumulative progress with TDD evidence, verification, and PR boundary. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Slice C: case 24 setup now emits run-scoped notes/CFI and returns `annIds`; verdict prefers run-specific annIds with duplicate/loss checks before legacy delta-count fallback. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Slice C: added RED/GREEN coverage for stale pre-state isolation, duplicate/loss detection, and setup runId metadata. |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modified | Slice D: BookNote mutation/invalid-ref helpers now require the target note to exist and change before reporting OK, otherwise return explicit missing/no-op actions. |
| `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | Modified | Slice D: added RED/GREEN coverage for stale existing config and no-op BookNote mutation/invalid-ref paths. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Slice D: added setup propagation coverage for case 25/26 BookNote mutation failures. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Slice C: marked case 24 isolation complete. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Slice D: added and marked BookNote config evidence hardening tasks complete. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Slice D: merged cumulative progress with TDD evidence, verification, and PR boundary. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | SpawnSync buffering fix: repeat child attempts now use explicit 64MiB `maxBuffer` and preserve timeout/error/status failure reporting. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | SpawnSync buffering fix: added RED/GREEN coverage for repeat child spawn options. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | SpawnSync buffering fix: added and marked minimal harness buffering tasks complete. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | SpawnSync buffering fix: merged cumulative apply-progress with TDD evidence, verification, and PR boundary. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Env-var + cleanup: added `buildStateJsonSpawnOptions()` with explicit `BIBLIOTECA_DEV_SYNC_HARNESS=1` wired into `spawnStateJson`; added exported `ensurePreCycleCleanup()` and `buildRepeatChildArgs` with `--clean-before` flag; handled `--clean-before` in `main()`. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Env-var + cleanup: added RED/GREEN coverage for `buildStateJsonSpawnOptions` env-var propagation, `ensurePreCycleCleanup` success/partial-failure, and `buildRepeatChildArgs` `--clean-before` injection. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/tasks.md` | Modified | Env-var + cleanup: added and marked env-var propagation + pre-cycle cleanup tasks complete. |
| `openspec/changes/fix-phase4-real-conflicts-reliability/apply-progress.md` | Modified | Env-var + cleanup: merged cumulative apply-progress with TDD evidence, verification, and PR boundary. |

## Deviations from Design
- Slice 3 used `dev-sync-fixture.mjs` / `sync-dev-inject.mjs` rather than `sync-execute.mjs` for the new RED/GREEN change because the proven 21c convergence defect was fixture timestamp asymmetry: Android HTTP book edits honored `options.now`, desktop book edits ignored it and used wall-clock time.
- No additional production merge-path changes were made for 21a/21b/21d in this continuation because focused `sync-execute` tests already prove the relevant root contracts. Adding code without a failing test would violate the design's masking-prevention rule.
- Slice 4 did not move broader helpers out of `dev-sync-cycle.mjs`; task 3.1 was satisfied by keeping new shared evidence fixtures in `__tests__` and avoiding any product merge changes in `sync-execute.mjs`.
- Post-rerun regression fix stayed in repeat aggregation/reporting only and did not change product convergence code. The subsequent verify slice reran real-device and confirmed classification recovery, but reliability still fails below threshold.
- Slice B stayed in harness fixture/assertion code (`dev-sync-cycle.mjs`) instead of production merge code because product-failures analysis showed 21/22 were still contaminated by different local IDs and stale assertion keys, not proven merge defects.
- Slice C also stayed in harness fixture/assertion code (`dev-sync-cycle.mjs`) because product-failures analysis showed case 24 was contaminated by fixed `Idea A`/`Idea B` plus fixed CFI and delta-count assertions, not proven product data loss.
- Slice D stayed in harness fixture/setup code (`dev-sync-fixture.mjs` and setup tests) because product-failures analysis showed 25/26 were capped by stale/missing BookNote config evidence and no-op mutation helpers, not a proven product merge defect.
- SpawnSync buffering fix stayed in repeat child harness execution only; it does not alter product assertions or classify ENOBUFS as success. Non-timeout spawn errors still return `ok: false`, and non-zero child exits still return stderr/status evidence.

## Issues Found
- `node --test` is correct for `dev-sync-fixture.test.mjs`, but `sync-execute.test.mjs` imports Vitest APIs and must be run with focused Vitest (`pnpm --filter biblioteca-app exec vitest run ...`).
- Existing workspace contains unrelated uncommitted changes in several harness/product files; slice 4 intentionally touched only `dev-sync-cycle.mjs`, `dev-sync-cycle.test.mjs`, and the hybrid tasks/apply-progress artifacts.
- `openspec/changes/fix-phase4-real-conflicts-reliability/` is currently untracked in git status, but it is the required hybrid SDD artifact path for this change.
- Slice 4 found a real evidence-hardening gap: case 22 could return `pass` from plausible state plus `deleteWins` even when delete/edit HLC fields were absent. The gate now caps that path at `warn`.
- Post-rerun regression root cause: `classifyReliabilityFailure()` checked broad environment tokens (`health`, `device`, `adb`, `sqlite3`) before product/harness failure signals, so executable evidence mentioning Android device/sqlite diagnostics could contaminate the aggregate failure domain.
- Post-fix rerun confirms the classification regression is resolved on real-device evidence: no non-pass attempts are classified as `environment`; all 8 non-pass attempts are now `product` domain. The pass-rate blocker remains.
- Slice A root cause confirmed in focused tests: `updateReplicaViaHttp()` previously called `rowToReplica()` directly with partial update rows, so any field not present in the edit payload became `null` in `fields_jsonb`.
- Slice B root cause confirmed in focused tests: 22a/22c looked up Android state by desktop local ID even when setup created a different Android ID, and 21b used stale fixed annotation text instead of action-scoped semantic evidence.
- Slice C root cause confirmed in focused tests: case 24 could fail from stale pre-existing `Idea A`/`Idea B` rows and delta-count evidence even when the current run's two annotation IDs survive on both devices.
- Slice D root cause confirmed in focused tests: Android BookNote mutation/invalid-ref helpers could previously read an existing stale config, touch zero matching notes, PUT unchanged config, and return OK; they now fail as `booknote-*-missing-note` or `booknote-*-noop`.
- Slice E final rerun is not archive-ready: only `21c` passed; `21a` and `21b` still failed with product-domain evidence files, `21d` warned, and 10 later cases were blocked by child process output buffer exhaustion (`spawnSync /usr/bin/node ENOBUFS`) that the repeat classifier currently records as `product` without per-case evidence paths.
- SpawnSync ENOBUFS root cause: repeat child runs capture full per-case JSON reports through `spawnSync`'s default stdout/stderr buffer, which is too small for verbose Phase 4 evidence. The fix raises the buffer for repeat children; a real-device rerun is still required to replace the untrustworthy 22a–26 evidence from `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977394828-repeat.json`.

## Slice 5 Real-device Rerun / Reporting
- ✅ Environment checked on 2026-07-13 from `/home/napster/Biblioteca/apps/readest-app`: ADB device `30beb826` connected; Android package `io.github.Napster0x.biblioteca` running as PID `31284`; prior `pnpm dev:android` process still running as PID `10636`; `adb forward tcp:7878 tcp:7878` already active.
- ⚠️ Doctor command `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor -- --json` returned `status: warn` / `ok: false` only because Android device lacks `sqlite3`; all required Phase 2 preflight checks passed (`android.package`, `android.process`, `adb.forward`, `android.health`, `android.manifest`, `desktop.devSyncHealth`).
- ❌ Bounded real-device rerun command `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle -- --case-ref "21a,21b,21c,21d,22a,22c,23a,23b,23c,23d,23e,24,25,26" --repeat 1` completed with reliability `fail`: 6/14 PASS (`42.86%`), below required `80%`.
- Report path: `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783973896230-repeat.json`.
- Per-case result summary: `21a fail`, `21b fail`, `21c pass`, `21d fail`, `22a warn`, `22c warn`, `23a pass`, `23b pass`, `23c pass`, `23d pass`, `23e pass`, `24 fail`, `25 warn`, `26 warn`.
- All 14 case evidence files reported `unavailableEvidence: ["android.sqlite3"]`; the aggregate repeat report classified 8 non-pass attempts as `failureDomain: environment`, so the rerun still exposes a reliability/classification blocker rather than archive readiness.

## Remaining Tasks
- [x] 1.4 / 2.3 Complete 21a–21d product convergence evidence/fixes for 21a, 21b, and 21d by focused evidence; no extra code required beyond the existing root fixes and the prior 21c fixture timestamp fix.
- [x] 3.1–3.2 refactor/evidence hardening beyond slices 1–3.
- [x] 4.1 targeted tests recorded in apply notes and reconciled in `tasks.md`.
- [x] 4.2 bounded real-device rerun/reporting executed and persisted; result is below threshold and blocks archive readiness.
- [x] 5.1–5.3 repeat aggregation/failureDomain regression fixed with focused tests.
- [x] Rerun bounded real-device Phase 4 after this fix to verify pass rate and per-case `failureDomain` recovery; result is 6/14 PASS, `failureDomains.product: 8`, `unavailableEvidence.android.sqlite3: 14`.
- [x] 7.1–7.5 Product-failures Slice A Android HTTP partial edit identity preservation completed with focused RED/GREEN tests.
- [x] 8.1–8.5 Product-failures Slice B same-entity fixture/assertion model for 21/22 IDs and semantic-key evidence completed with focused RED/GREEN tests.
- [x] Product-failures Slice C case 24 isolation completed with focused RED/GREEN tests.
- [x] Product-failures Slice D BookNote config evidence for 25/26 completed with focused RED/GREEN tests.
- [x] Product-failures Slice E real-device rerun after harness evidence fixes executed; result is 1/14 PASS with `ENOBUFS` rerun blocker for cases 22a onward.
- [x] Harness spawnSync ENOBUFS buffering fix completed with focused RED/GREEN tests.
- [x] 12.1–12.3 Env-var propagation + pre-cycle cleanup completed with focused RED/GREEN tests.

## Workload / PR Boundary
- Mode: stacked PR slice (`auto-chain`, `stacked-to-main`).
- Current work unit: Env-var propagation + pre-cycle cleanup.
- Boundary: starts from ENOBUFS buffering fix evidence showing `BIBLIOTECA_DEV_SYNC_HARNESS=1` not propagated to `spawnStateJson` and accumulated replicas contaminating assertions; ends with `buildStateJsonSpawnOptions`, `ensurePreCycleCleanup`, `--clean-before` flag in repeat child args, focused RED/GREEN test evidence, and SDD task/progress updates. No product sync behavior, build, or commit changes.
- Rollback: revert `buildStateJsonSpawnOptions()` export/wiring, `ensurePreCycleCleanup()` export, `buildRepeatChildArgs` export and `--clean-before` flag addition, `main()` --clean-before handling, the associated tests, and SDD artifact updates.

## Product-failures Slice E Final Real-device Rerun
- Environment: ADB device `30beb826` connected; `pnpm dev:android` running as PID `10636`; Android app `io.github.Napster0x.biblioteca` running as PID `31284`; `adb forward tcp:7878 tcp:7878` active.
- Doctor: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor` returned `status: warn` / `ok: false` only because Android lacks `sqlite3`; required Phase 2 preflight checks passed, including package, process, forward, Android `/health`, manifest, and desktop sync endpoints.
- Rerun: bounded Phase 4 repeat report `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977394828-repeat.json` returned reliability `fail`, 1/14 PASS (`7.14%`) below the 80% threshold.
- Per-case: `21a fail`, `21b fail`, `21c pass`, `21d warn`, `22a fail ENOBUFS`, `22c fail ENOBUFS`, `23a fail ENOBUFS`, `23b fail ENOBUFS`, `23c fail ENOBUFS`, `23d fail ENOBUFS`, `23e fail ENOBUFS`, `24 fail ENOBUFS`, `25 fail ENOBUFS`, `26 fail ENOBUFS`.
- Evidence paths emitted only for cases 21a–21d: `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977394865.json`, `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977400933.json`, `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977407108.json`, `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783977412697.json`.

## ENOBUFS Fix Real-device Rerun (2026-07-13)
- Environment: ADB device `30beb826` connected; `pnpm dev:android` PID `10636`; app `io.github.Napster0x.biblioteca` PID `31284`; forward `tcp:7878` active.
- Doctor: `status: warn`, `ok: false` only because Android lacks `sqlite3`; all Phase 2 preflight checks passed (18/19).
- ✅ **ENOBUFS fix CONFIRMED WORKING**: All 14 cases executed to completion; zero `spawnSync /usr/bin/node ENOBUFS` errors; all 14 per-case evidence files emitted.
- Rerun: bounded Phase 4 repeat report `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783979034352-repeat.json` returned reliability `fail`, 6/14 PASS (`42.86%`) below the 80% threshold.
- Per-case: `21a fail`, `21b fail`, `21c pass`, `21d warn`, `22a warn`, `22c fail`, `23a pass`, `23b pass`, `23c pass`, `23d pass`, `23e pass`, `24 fail`, `25 warn`, `26 warn`.
- failureDomains: `product: 8`; unavailableEvidence: `android.sqlite3: 14`; zero `environment` contamination.
- Evidence files: all 14 cases emitted (`/tmp/biblioteca-dev-sync/dev-sync-cycle-1783979034388.json` through `1783979114568.json`).
- **New discovery**: `BIBLIOTECA_DEV_SYNC_HARNESS=1` not propagated to spawned `dev-sync-fixture.mjs` commands for BookNote mutation/invalid-ref actions (cases 25/26). Even with propagation, verdicts would stay `warn` because Slice D correctly fails when target notes are absent from the Android book config.
- Pass rate unchanged from post-aggregation-fix baseline (6/14 = 42.86%). 21d improved from `fail` to `warn`; 22c degraded from `warn` to `fail`.
- Desktop replicas contain accumulated rows from 6+ prior runs (66 dictionary entries, 5 library books), confirming device state accumulation contributes to assertion failures for case 21a/21b.

## Env-var + Cleanup Final Real-device Rerun (2026-07-14)
- Environment: ADB device `30beb826` connected; `pnpm dev:android` PID `10636`; app `io.github.Napster0x.biblioteca` PID `27181`; forward `tcp:7878` active.
- Doctor: `phase2.preflight: pass` (6/6); `status: warn` / `ok: false` only because Android lacks `sqlite3`.
- ✅ **`--clean-before` CONFIRMED WORKING**: Desktop pre-state shows all DBs missing, library missing — clean slate before run.
- ✅ **`buildStateJsonSpawnOptions` env-var propagation CONFIRMED**: harness env var reached `spawnStateJson` child.
- Rerun: bounded Phase 4 repeat report `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783980157989-repeat.json` returned reliability `fail`, 6/14 PASS (`42.86%`) below the 80% threshold.
- Per-case: `21a fail`, `21b fail`, `21c pass`, `21d warn`, `22a warn`, `22c fail`, `23a pass`, `23b pass`, `23c pass`, `23d pass`, `23e pass`, `24 fail`, `25 warn`, `26 warn`.
- failureDomains: `product: 8`; unavailableEvidence: `android.sqlite3: 14`; zero `environment` contamination; zero `ENOBUFS` errors.
- Evidence files: all 14 cases emitted (`/tmp/biblioteca-dev-sync/dev-sync-cycle-1783980158024.json` through `1783980222794.json`).
- **CRITICAL DISCOVERY**: Verdicts are **byte-identical** to the post-ENOBUFS-fix rerun. Cleanup had ZERO impact on pass rate or any individual case verdict. This disproves the hypothesis that accumulated replicas from prior runs caused 21a/21b/24 failures. The product-domain failures are genuine sync convergence issues, not harness state contamination. The root cause lies in the actual desktop↔Android sync divergence, not in stale pre-state.
