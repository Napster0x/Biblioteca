# Apply Progress — fix-caso3-dictionary-sync-android-receive

## Mode
Strict TDD (orchestrator launch + Engram `sdd/biblioteca/testing-capabilities`).

## Scope Applied
Single focused work unit: extend `sync-execute.mjs` to transport desktop dictionary replicas to Android while preserving existing book sync evidence. Continuations fixed the real Android 400 by matching the receiver `ReplicaRow[]` contract exactly, fixed state observability so raw Android `/replicas/*` array responses are counted correctly, and fixed reset preconditions by adding a guarded runtime clear path for Android local sync server state.

## Completed Tasks
- [x] 1.1 RED test for `dictionary_entries` PUT to `/replicas/dictionary-entry`.
- [x] 1.2 RED test for `dictionary_occurrences` PUT to `/replicas/dictionary-occurrence` with replica metadata and field keys.
- [x] 1.3 RED evidence/failure coverage for separate dictionary replica counts and rejected replica PUTs.
- [x] 2.1 Collect dictionary rows from desktop `Readest/dictionary.db`; missing DB/tables produce zero rows.
- [x] 2.2 Map dictionary rows to `ReplicaRow[]` with `kind`, `replica_id`, `fields_jsonb`, `manifest_jsonb`, HLC timestamps, tombstone timestamp, and `schema_version`.
- [x] 2.3 PUT entries and occurrences to separate Android replica endpoints with non-zero failure JSON on rejected/invalid replica responses.
- [x] 2.4 Preserve existing book/library sync result while adding nested `replicas` and `evidence` fields.
- [x] 3.1 Keep implementation local to `sync-execute.mjs` with small helpers; no broad sync redesign.
- [x] 3.2 Run focused Vitest coverage; no build.
- [x] 3.3 Continuation: align dictionary replica payloads to Android receiver contract (`user_id`, prefixed `replica_id`, `reincarnation`, field envelope source, raw array body) and include response body diagnostics for future 400s.
- [x] 3.4 Continuation: fix `dev-sync-state.mjs` Android replica observability so raw `/replicas/*` array responses count as `rowCount = array.length` while preserving object `{ rows }` and explicit `rowCount` payload support.
- [x] 3.5 Continuation: fix `dev-sync-reset.mjs --target android-db` so confirmed destructive resets call guarded Android local sync runtime reset endpoint `/__dev/reset`; when the running app lacks that endpoint the reset now fails clearly with `restartRequired: true` instead of falsely claiming clean runtime state.
- [ ] 4.1 Real-device Caso 3 harness verification remains for verify/harness phase.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 2.1-2.4 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Script integration | ⚠️ Baseline focused file had pre-existing failures under full-file run; isolated new scope used `vitest run ... -t` | ✅ RED failed: missing `/replicas/dictionary-entry` PUT | ✅ Passed after `sync-execute.mjs` collector + PUT implementation | ✅ Added absent-DB zero-count path | ✅ Helpers extracted for DB read, mapping, PUT evidence |
| 1.2 / 2.2-2.3 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Script integration | Same as above | ✅ RED failed: missing `/replicas/dictionary-occurrence` PUT and metadata | ✅ Passed after occurrence mapping and endpoint PUT | ✅ Same fixture asserts separate occurrence fields and metadata | ✅ Shared row-to-replica mapper kept local to script |
| 1.3 / 2.3-2.4 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Script integration | Same as above | ✅ RED failed: no `replicas` evidence and no non-zero replica failure JSON | ✅ Passed after nested replica evidence and fail-fast JSON | ✅ Added rejected replica PUT case plus zero-count success case | ✅ Result shape preserves `{ ok, sent, received }` and adds nested evidence only |
| 3.3 continuation | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Script integration | ✅ Focused prior scope isolated with `vitest run ... -t "sync-execute dictionary replica transport"` | ✅ RED failed: fake receiver rejected missing `user_id`/contract fields and failure evidence omitted 400 response body | ✅ Passed after adding `user_id`, prefixed `replica_id`, `reincarnation`, field `s`, and response-body diagnostics | ✅ Contract test proves raw `ReplicaRow[]` wrapper shape and separate entry/occurrence endpoint kind matching | ✅ Minimal local mapper/error-helper changes only |
| 3.4 continuation | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Script integration | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync replica inspection"` → 2 passed / 150 skipped before change | ✅ RED failed: raw `/replicas/dictionary-entry` array returned `rowCount: 0` instead of `1` | ✅ New test passed after `sync-dev-state.mjs` normalized raw arrays as rows | ✅ Focused describe also preserves object `{ rows }` behavior: 3 passed / 150 skipped | ✅ Minimal helper extraction only; no broad sync-state redesign |
| 3.5 continuation | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Script integration | ✅ `pnpm exec vitest run ... -t "dev sync reset extended targets"` → 9 passed / 144 skipped before change | ✅ RED failed: confirmed `android-db` reset produced no `runtimeReset` evidence and did not report missing endpoint as restart-required | ✅ Passed after reset script called `/__dev/reset` with `X-Biblioteca-Dev-Sync-Harness: DELETE_DEV_SYNC_STATE`; endpoint absence exits non-zero with restart guidance | ✅ Added success path and 404/unavailable path to prove both clean runtime clear and manual restart reporting | ✅ Minimal script/route hook; destructive guards remain unchanged |

## Test Summary
- **Total tests written/adjusted**: 7 behavior checks across 6 focused tests
- **Total tests passing in focused scope**: 14 reset/replica focused tests; 4 when including affected trigger smoke for transport; 3 dictionary transport tests directly; 3 replica inspection tests after observability fix
- **Layers used**: Integration/script (4)
- **Approval tests**: 1 affected existing trigger test preserved book-only behavior by isolating desktop data root
- **Pure functions created/kept**: 10 small script helpers (`emptyReplicaEvidence`, DB read/existence helpers, HLC conversion, timestamp parsing, mapper, applied count, PUT helper, replica response row/rowCount normalizers); reset continuation added one isolated runtime clear helper plus one guarded Rust repository clear hook.

## Tests Run
- `pnpm --filter @readest/readest-app test -- src/__tests__/services/sync/devSyncHarness.test.ts` — failed before implementation because the repository package name is `biblioteca-app` and the command executed broader suite with pre-existing unrelated failures.
- `pnpm test -- --run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync trigger harness"` — failed similarly by executing broader suite; treated as command-shape/pre-existing baseline noise.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "sync-execute dictionary replica transport"` — RED: 3 failing tests before implementation.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "sync-execute dictionary replica transport"` — GREEN: 3 passed / 149 skipped after implementation.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "sync-execute dictionary replica transport|uses a namespaced dev counter"` — 4 passed / 148 skipped after preserving affected trigger behavior.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 151 passed / 1 failed; remaining failure is pre-existing `dev sync doctor harness > prints structured JSON checks...` expecting `warn` while current environment returns `pass`.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "sync-execute dictionary replica transport"` — continuation RED: 2 failed / 1 passed / 149 skipped. Failures proved missing Android receiver contract fields (`user_id`, prefixed IDs/metadata) and missing 400 response-body diagnostics.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "sync-execute dictionary replica transport"` — continuation GREEN: 3 passed / 149 skipped.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "sync-execute dictionary replica transport|uses a namespaced dev counter"` — continuation focused regression: 4 passed / 148 skipped.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync replica inspection"` — observability safety net before modification: 2 passed / 150 skipped.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "counts replica API array responses"` — observability RED: 1 failed / 152 skipped because raw array responses produced `rowCount: 0`.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "counts replica API array responses"` — observability GREEN: 1 passed / 152 skipped after array normalization.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync replica inspection"` — observability focused regression: 3 passed / 150 skipped.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync reset extended targets"` — runtime-reset safety net before modification: 9 passed / 144 skipped.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "clears Android local sync runtime state|reports a manual restart requirement"` — runtime-reset RED: 2 failed / 153 skipped because no `runtimeReset` evidence existed and endpoint absence exited success.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "clears Android local sync runtime state|reports a manual restart requirement"` — runtime-reset GREEN: 2 passed / 153 skipped after reset script endpoint call and restart-required failure path.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync reset extended targets"` — runtime-reset focused regression: 11 passed / 144 skipped.
- `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts -t "dev sync reset extended targets|dev sync replica inspection"` — final focused regression: 14 passed / 141 skipped.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Added dictionary DB collection, row-to-replica mapping, replica PUTs, nested replica evidence/failure JSON, Android receiver contract fields, and response-body diagnostics. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modified | Normalized Android replica API state capture so raw arrays, object `{ rows }`, and explicit object `rowCount` payloads produce correct `rowCount` values. |
| `apps/readest-app/scripts/dev-sync-reset.mjs` | Modified | For confirmed `android-db` resets, calls guarded Android `/__dev/reset` runtime clear endpoint after ADB cleanup and fails with restart guidance when unavailable. |
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modified | Added guarded `POST /__dev/reset` route for local sync runtime cleanup. |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Modified | Added `clear_dev_state()` hook to clear cached visible-repository SQLite runtime state and visible/replica tables. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Added/adjusted focused script integration tests for dictionary transport plus a replica inspection regression proving raw Android `/replicas/*` array bodies count as visible rows with HLC/tombstone metadata. |
| `openspec/changes/fix-caso3-dictionary-sync-android-receive/tasks.md` | Modified | Marked completed apply and observability tasks; left real-device harness verification pending. |
| `openspec/changes/fix-caso3-dictionary-sync-android-receive/apply-progress.md` | Created | Persisted SDD apply evidence and focused test results. |

## Deviations from Design
Minor contract correction to the original design: Android `local_sync_server.rs` deserializes `PUT /replicas/:kind` as a raw `Vec<ReplicaRow>` where `user_id` is required, and the canonical app/Rust rows include prefixed `replica_id`, `reincarnation`, and field-envelope `s`. The implementation remains within the minimal `sync-execute.mjs`-only design. Real-device Caso 3 verification remains pending by design for the later harness/verify step.

No new design deviation for observability: `dev-sync-state.mjs` already queries Android `/replicas/:kind`; this continuation only corrects payload shape interpretation for the observed raw array response.

Reset continuation intentionally extends the original script-only design because real-device evidence proved a separate precondition bug: deleting Android files via ADB does not clear the already-running local sync server's cached visible-repository SQLite connections. The added route is guarded by loopback-only local sync exposure plus the destructive confirmation token header and is only called by confirmed dev harness reset.

## Issues Found
- `pnpm --filter @readest/readest-app` does not match this workspace package; package name is `biblioteca-app`.
- Full `devSyncHarness.test.ts` currently has one pre-existing/environment-sensitive failure in the doctor harness (`desktop.devServer` expected `warn`, got `pass`).
- Real Android 400 root cause: `sync-execute.mjs` sent incomplete replica rows; Rust `ReplicaRow` requires `user_id`, and receiver/app conventions use raw array payloads with prefixed `replica_id`, `reincarnation`, and field-envelope source `s`.
- Prior failure diagnostics hid the Android response body; continuation now includes response text (for example `{ "error": "..." }`) in replica failure evidence.
- `dev-sync-state.mjs` previously assumed replica API responses were object envelopes with `.rows`; Android returns raw arrays for `/replicas/*`, so synced rows existed but the harness reported `rowCount: 0`.
- No existing local sync server reset/admin/clear route existed. `GET /replicas/:kind` reads from the `VisibleRepository` adapter, and deleting DB files underneath a running Android process leaves cached SQLite connections serving stale rows.
- A running Android app built before this route will still return 404 for `/__dev/reset`; in that case `dev-sync-reset --target android-db --no-dry-run` now exits non-zero with `runtimeReset.restartRequired: true` rather than silently allowing a dirty B precondition.

## Workload / PR Boundary
- Mode: single focused work unit under `auto-chain`; chain strategy `stacked-to-main` but no split needed.
- Boundary: script observability + tests + SDD progress only.
- Estimated review budget impact: within low forecast; no size exception needed.

## Status
8/9 original tasks complete plus continuation contract, observability, and runtime reset fixes complete. Ready for focused harness rerun / sdd-verify, with real-device harness task 4.1 still pending. Current already-running Android app may require restart/redeploy once to expose the new `/__dev/reset` endpoint; after that, reset should not require manual restart.
