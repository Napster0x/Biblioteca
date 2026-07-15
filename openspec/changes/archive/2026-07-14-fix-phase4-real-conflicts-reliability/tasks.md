# Tasks: Fix Phase 4 Real Conflicts Reliability

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500-700 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 diagnostics -> PR2 fallback evidence -> PR3 21a-21d fixes -> PR4 rerun artifacts |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Harness failureDomain diagnostics | PR 1 | Harness-only; no product outcome changes. |
| 2 | Android fallback/config evidence | PR 2 | Harness evidence gates; PASS requires complete evidence. |
| 3 | 21a-21d proven convergence fixes | PR 3 | Product code only after failing RED tests name defect. |
| 4 | Real-device rerun/report persistence | PR 4 | Verification artifacts only. |

## Phase 1: RED

- [x] 1.1 Add failing `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` cases: sqlite3 unavailable + convergence mismatch yields `product|harness`, not `environment`; app/ADB/HTTP blockers may yield `environment`.
- [x] 1.2 Add failing `dev-sync-cycle.test.mjs` cases for 22b `blocked` and 22/24/25/26 WARN caps when BookNote/config/HLC evidence is incomplete.
- [x] 1.3 Add failing `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs`: Android sqlite3 failure still records HTTP replica rows, manifest/index, `config.json`, and `unavailableEvidence: android.sqlite3`.
- [x] 1.4 Confirm focused `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` coverage for 21a, 21b, and 21d root contracts: newer HLC wins through full HLC comparison/field max timestamps, semantic duplicate filtering runs per kind, and equal HLC uses deterministic nodeId tiebreaker.

## Phase 2: GREEN

- [x] 2.1 Update `apps/readest-app/scripts/dev-sync-cycle.mjs` classifier to emit `failureDomain`, `failureReason`, `unavailableEvidence`, and explicit `blocked` for 22b.
- [x] 2.2 Update `apps/readest-app/scripts/sync-dev-state.mjs` Android fallback to capture HTTP rows/HLC/deleted flags plus BookNote/config evidence without sqlite3.
- [x] 2.3 No additional `apps/readest-app/scripts/sync-execute.mjs` changes required for 21a, 21b, or 21d in this slice: focused evidence shows the root contracts are already green after the existing full-HLC comparator, row timestamp max, and per-kind semantic filtering fixes; 21c was the only newly proven fixture timestamp defect.

## Phase 3: REFACTOR

- [x] 3.1 Separate harness helpers from product fixes: added shared Phase 4 evidence fixture builders in `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`; no product merge changes were made.
- [x] 3.2 Ensure WARN cannot become PASS from metadata alone in `dev-sync-cycle.mjs`: case 22 PASS now requires explicit delete/edit HLC ordering evidence before accepting plausible live/tombstone state.

## Phase 4: VERIFY

- [x] 4.1 Run targeted Node tests for `dev-sync-cycle`, `sync-dev-state`, and `sync-execute`; record commands/results in apply notes.
- [x] 4.2 Rerun bounded real-device Phase 4; persist per-case verdict, `failureDomain`, evidence gaps, unavailable evidence, and PASS/executable >=80% calculation.

## Post-rerun Regression Fix

- [x] 5.1 Add RED repeat-aggregation regression coverage proving attempts with `unavailableEvidence: ["android.sqlite3"]` and executable product/harness evidence are not promoted to `environment`.
- [x] 5.2 Narrow repeat failure-domain classification so product/harness evidence wins over non-blocking Android/sqlite diagnostic text, while true ADB/HTTP-health blockers remain `environment`.
- [x] 5.3 Run focused `dev-sync-cycle` Node tests and record the next step as a real-device rerun, not executed in apply.

## Post-fix Real-device Verification

- [x] 6.1 Rerun bounded Phase 4 after the repeat aggregation fix with `BIBLIOTECA_DEV_SYNC_HARNESS=1`; persist per-case verdict, `failureDomain`, unavailable evidence, report paths, and PASS/executable calculation.
- [x] 6.2 Confirm aggregate non-pass classification is no longer globally contaminated by Android `sqlite3` absence: rerun report shows `failureDomains.product: 8` and `unavailableEvidence.android.sqlite3: 14`.
- [x] 6.3 Record remaining blocker: reliability still fails at 6/14 PASS (42.86%), below the 80% threshold, so archive remains blocked by product-domain Phase 4 cases.

## Product-failures Slice A: Android HTTP partial edit identity preservation

- [x] 7.1 Add RED `sync-dev-inject-http.test.mjs` coverage proving partial Android HTTP dictionary edits preserve `term`, `displayTerm`, and `language` while updating only `definition`.
- [x] 7.2 Add RED `sync-dev-inject-http.test.mjs` coverage proving partial Android HTTP annotation edits preserve `bookHash`, `cfi`, and `text` while updating only `note`.
- [x] 7.3 Add RED `sync-dev-inject-http.test.mjs` coverage proving partial Android HTTP quote edits preserve `bookHash`, `cfi`, and `text` while updating an editable non-identity field.
- [x] 7.4 Update `updateReplicaViaHttp()` to read existing Android HTTP replicas, merge existing field values/timestamps with partial fixture edits, and only then call `rowToReplica()` so unspecified identity fields are not converted to `null`.
- [x] 7.5 Run focused HTTP inject and fixture routing tests; record RED/GREEN evidence in apply-progress.

## Product-failures Slice B: same-entity fixture/assertion model for 21/22

- [x] 8.1 Add RED `dev-sync-cycle.test.mjs` coverage proving case 21 same-entity assertions use semantic keys/HLC evidence instead of stale defaults, while semantic duplicates still fail.
- [x] 8.2 Add RED `dev-sync-cycle.test.mjs` coverage proving 22a/22c can assert paired desktop/Android IDs by semantic key with delete/edit HLC evidence, while duplicate semantic rows still fail.
- [x] 8.3 Update `dev-sync-cycle.mjs` case 21/22 verdict logic to resolve dictionary/annotation rows by semantic key when IDs differ, keep HLC evidence gates, and preserve duplicate checks.
- [x] 8.4 Update case 21b/22c fixture action metadata with run-scoped annotation text/CFI so real reports carry the semantic key required by the assertion model.
- [x] 8.5 Run focused `dev-sync-cycle` and fixture regression tests; record RED/GREEN evidence in apply-progress.

## Remaining Follow-up

- [x] Product-failures Slice C: case 24 isolation.
- [x] Product-failures Slice D: BookNote config evidence for 25/26.
- [x] Product-failures Slice E: real-device rerun after harness evidence fixes.

## Product-failures Slice D: BookNote config evidence for 25/26

- [x] 9.1 Add RED `dev-sync-fixture.test.mjs` coverage proving Android `--booknote-mutate` cannot return OK when an existing config lacks the target `noteId`, and cannot persist a no-op mutation as success.
- [x] 9.2 Add RED `dev-sync-fixture.test.mjs` coverage proving Android `--booknote-invalid-ref` cannot return OK when an existing config lacks the target `noteId`, and cannot persist a no-op invalid-ref mutation as success.
- [x] 9.3 Add RED `dev-sync-cycle.test.mjs` coverage proving case 25/26 setup propagates failed BookNote mutation/invalid-ref attempts explicitly instead of continuing with false OK evidence.
- [x] 9.4 Update `injectBookNoteMutation()` and `injectInvalidBookNoteRef()` to verify the target note exists and changes before PUT/write; return explicit `*-missing-note` or `*-noop` actions on no-op evidence.
- [x] 9.5 Run focused BookNote fixture/cycle tests and record RED/GREEN evidence in apply-progress.

## Product-failures Slice E: final real-device rerun after harness evidence fixes

- [x] 10.1 Check ADB/device, `dev:android`, Android app process, and `adb forward tcp:7878 tcp:7878` before rerun.
- [x] 10.2 Run `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor` and record preflight status.
- [x] 10.3 Run bounded Phase 4 real-device rerun for `21a,21b,21c,21d,22a,22c,23a,23b,23c,23d,23e,24,25,26` with `--repeat 1`.
- [x] 10.4 Persist per-case verdicts, pass rate, report paths, failure domains, and remaining blockers in apply-progress and verify-report.

## Harness spawnSync ENOBUFS buffering fix

- [x] 11.1 Add RED `dev-sync-cycle.test.mjs` coverage proving repeat child attempts configure a large stdout/stderr buffer while keeping `stdio: "pipe"` failure capture.
- [x] 11.2 Update repeat child `spawnSync` options in `dev-sync-cycle.mjs` with an explicit large `maxBuffer` and preserve explicit error/status handling.
- [x] 11.3 Run focused `node --test "apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs"` and record RED/GREEN evidence in apply-progress.

## Env-var Propagation + Pre-cycle Cleanup

- [x] 12.1 Add RED `dev-sync-cycle.test.mjs` coverage proving `buildStateJsonSpawnOptions()` propagates `BIBLIOTECA_DEV_SYNC_HARNESS=1` to child processes consistently with `buildCycleChildSpawnOptions`.
- [x] 12.2 Add RED `dev-sync-cycle.test.mjs` coverage proving `ensurePreCycleCleanup()` runs desktop and Android cleanup before bounded rerun, and `buildRepeatChildArgs` injects `--clean-before` into repeat child args.
- [x] 12.3 Implement `buildStateJsonSpawnOptions()` with explicit `BIBLIOTECA_DEV_SYNC_HARNESS=1` and wire it into `spawnStateJson`; implement `ensurePreCycleCleanup()` that calls desktop + Android cleanup; add `--clean-before` to `buildRepeatChildArgs` and handle it in `main()`.
