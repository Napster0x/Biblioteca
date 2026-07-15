# Apply Progress: Fix Phase 2 Book Tombstone Reimport Mirror

## Scope Applied

- PR 1 / Work Unit 1: desktop same-hash tombstoned book reimport resurrection in `prepare-engine.mjs` plus focused tests.
- PR 2 / Work Unit 2: Android `/books/index` tombstone merge into desktop before push, plus focused sync tests and validation hooks.
- Follow-up: focused fixes for failed harness evidence in `13a`, `10Ma`, `10Mb`, and `10Mc` only.
- Follow-up 10M slice: pending Android delete tombstone marker and HTTP delete coverage for `10Ma`, `10Mb`, and `10Mc`; blocked harness capability cases remain untouched.

## Mode

Strict TDD (from orchestrator prompt and `sdd/biblioteca/testing-capabilities`).

## Completed Tasks

- [x] 1.1 Create `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` proving same-hash tombstoned EPUB reimport clears `deletedAt`, stamps newer `updatedAt`, and keeps one library row.
- [x] 1.2 Assert stale tombstone data cannot re-delete the newer reimported book in the prepare test fixture.
- [x] 2.1 Modify `apps/readest-app/scripts/prepare-engine.mjs` `importEpubToLibrary` to skip live same-hash duplicates but resurrect same-hash tombstoned entries.
- [x] 2.2 Ensure resurrected entries copy the EPUB, preserve hash identity, clear `deletedAt`, and refresh `importedAt`/`updatedAt`.
- [x] 3.1 Add `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` cases for numeric and ISO timestamp normalization, invalid/null values, and `localMaxMillis` comparison.
- [x] 3.2 Add sync tests where newer Android `/books/index` tombstone updates desktop before push, while older tombstone loses to newer local reimport.
- [x] 3.3 Add D/C/N preservation assertion: merge helper changes only `library.json` book state and does not invoke dictionary, quote/citation, note, or annotation replica paths.
- [x] 4.1 Modify `apps/readest-app/scripts/sync-execute.mjs` with `normalizeBookTimestamp(value)` and `mergeRemoteBookTombstones(localLibrary, remoteIndexBooks)` helpers.
- [x] 4.2 Wire sync execution to fetch Android `/books/index`, merge newer remote book tombstones into desktop `library.json`, then call existing `pushBooks()`.
- [x] 4.3 Prevent stale tombstones by applying remote deletes only when `remoteDeletedAtMillis > max(updatedAt, deletedAt, importedAt, createdAt)`.
- [x] 5.1 Run focused unit tests for `prepare-engine.test.mjs` and `sync-execute.test.mjs`; keep changes limited to desktop harness scripts.
- [x] 5.3 Confirm blocked harness capabilities `14*`, `9Ma`, and `13Ma` remain out of scope and are not reclassified by this change.
- [x] 6.1 Inspect prior evidence files and real `/books/index`/manifest server behavior for `13a`, `10Ma`, `10Mb`, and `10Mc` only.
- [x] 6.2 Add focused failing unit coverage for wrapped `/books/index` tombstone payloads and live reimport timestamp serialization.
- [x] 6.3 Fix `sync-execute.mjs` minimally so wrapped remote tombstones merge into desktop and live reimports push numeric ordering timestamps that can beat older Android tombstones.
- [x] 6.4 Run focused unit tests for `prepare-engine.test.mjs` and `sync-execute.test.mjs`.
- [x] 6.5 Rerun focused real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc`. Result: all four pass after the Phase 7 follow-up; evidence `/tmp/biblioteca-dev-sync/phase2-focused/phase2-focused-followup-1782854284015.json`.
- [x] 7.1 Add focused RED coverage for stale desktop live state when `/books/index` has already lost the Android tombstone but the Android delete fixture ran in the same cycle.
- [x] 7.2 Add focused RED coverage that Android HTTP book delete records a local pending tombstone marker with a numeric `deletedAt`.
- [x] 7.3 Fix scripts minimally so `deleteBookViaHttp()` sends/records a numeric delete timestamp and `sync-execute.mjs` consumes pending Android delete tombstones before `pushBooks()`.
- [x] 7.4 Run focused unit tests for `sync-execute.test.mjs`, `prepare-engine.test.mjs`, and `sync-dev-inject-http.test.mjs`.
- [x] 7.5 Rerun focused real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` once doctor/preflight is available. Result: all four pass; preflight passed before and after execution with only Android sqlite3 CLI warning.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 2.1 | `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` | Unit | N/A — no existing prepare-engine tests found | ✅ `pnpm exec vitest run "scripts/__tests__/prepare-engine.test.mjs"` failed because tombstoned same-hash import returned `action: 'skipped'` | ✅ Focused Vitest passed after minimal `importEpubToLibrary` change | ✅ Added live same-hash duplicate idempotence case to preserve existing branch | ✅ Removed duplicate library read path while keeping logic local |
| 1.2 / 2.2 | `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` | Unit | N/A — covered by new focused fixture | ✅ Tombstoned fixture asserted `deletedAt` clears, one row remains, fresh timestamps are stamped, EPUB is copied | ✅ Focused Vitest passed with replacement of tombstoned entry | ✅ Same fixture validates stale tombstone data is not retained; duplicate case validates live entry still skips | ✅ No broader helper extraction needed |
| 3.1 / 4.1 | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit | ✅ `node --test "scripts/__tests__/sync-execute.test.mjs"`: 21/21 existing tests passing | ✅ `pnpm exec vitest run "scripts/__tests__/sync-execute.test.mjs"` failed on missing `normalizeBookTimestamp` export | ✅ Focused Vitest passed after adding timestamp normalization helper | ✅ Covered numeric millis, ISO strings, invalid strings, null, and `NaN`; merge tests exercise `localMaxMillis` paths | ✅ Kept normalization pure and local to sync-execute |
| 3.2 / 4.2 / 4.3 | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit | ✅ Same 21/21 existing sync tests passing before production changes | ✅ Newer remote tombstone and older remote tombstone tests failed because `mergeRemoteBookTombstones` did not exist | ✅ Focused Vitest passed after merging remote `/books/index` tombstones before manifest/push | ✅ Newer Android tombstone produces desktop tombstone and tombstone push; older Android tombstone loses to newer local reimport | ✅ Merge helper avoids mutating input library and wiring records `remoteBookTombstonesMerged` evidence |
| 3.3 | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit | ✅ Same 21/21 existing sync tests passing before production changes | ✅ D/C/N sentinel-file test failed because file-level tombstone merge helper did not exist | ✅ Focused Vitest passed after adding `mergeRemoteBookTombstonesIntoLibraryFile` that only writes `library.json` | ✅ Sentinel files for `dictionary.db`, `citas.db`, and `annotations.db` remain unchanged while `library.json` tombstones | ✅ No SQLite/replica path changes were introduced |
| 6.1 / 6.2 / 6.3 | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit | ⚠️ `pnpm test -- scripts/__tests__/sync-execute.test.mjs` ran the broader app suite in this workspace and exposed unrelated pre-existing failures; focused Vitest was used for the TDD gate | ✅ Added tests for wrapped `/books/index` payloads and live reimport numeric timestamp serialization before changing production code | ✅ `pnpm exec vitest run scripts/__tests__/sync-execute.test.mjs scripts/__tests__/prepare-engine.test.mjs` passed after the minimal sync-execute fix | ✅ Wrapper shape plus numeric serialization cover the two harness failure classes (`10M*` tombstone read, `13a` resurrection push over older tombstone) | ✅ Kept changes inside `sync-execute.mjs`; no blocked harness/server capability scope added |
| 7.1 / 7.3 | `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Unit | ✅ Existing focused sync-execute suite had passed before this follow-up | ✅ Added pending Android delete marker test for stale desktop live state when `/books/index` no longer carries the tombstone | ✅ `pnpm exec vitest run scripts/__tests__/sync-execute.test.mjs` passed: 1 file, 28 tests | ✅ Marker path exercises a distinct 10M branch from wrapped `/books/index` tombstones | ✅ Marker consumption is local to `sync-execute.mjs` and removes the marker after reading |
| 7.2 / 7.3 | `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Unit/HTTP inject | ✅ HTTP inject node tests had passed before adding delete coverage | ✅ Added `deleteBookViaHttp` and marker-recording coverage before the production helper | ✅ `node --test scripts/__tests__/sync-dev-inject-http.test.mjs` passed after helper implementation | ✅ Covers successful HTTP delete marker write and missing-book failure behavior | ✅ Helper reuses shared PUT JSON path and keeps marker format minimal |

## Test Summary

- **Total tests written**: 10 (2 PR 1 tests + 4 PR 2 tests + 2 Phase 6 follow-up tests + 2 Phase 7 pending-tombstone/HTTP-delete tests)
- **Total tests passing**: 30 focused Vitest tests plus focused HTTP inject node tests
- **Layers used**: Unit (30 focused Vitest tests executed) and Node HTTP-inject tests (`sync-dev-inject-http.test.mjs`)
- **Approval tests**: None — behavior changed through RED tests.
- **Pure functions created**: 3 (`normalizeBookTimestamp`, `mergeRemoteBookTombstones`, wrapped index payload extraction)

## Validation

- ✅ Safety net: `node --test "scripts/__tests__/sync-execute.test.mjs"` from `apps/readest-app`: 21 tests passed before production changes.
- ✅ RED: `pnpm exec vitest run "scripts/__tests__/sync-execute.test.mjs"` from `apps/readest-app`: 4 new tests failed on missing exports/helpers.
- ✅ GREEN: `pnpm exec vitest run "scripts/__tests__/sync-execute.test.mjs"` from `apps/readest-app`: 1 file passed, 25 tests passed.
- ✅ Final focused validation: `pnpm exec vitest run "scripts/__tests__/prepare-engine.test.mjs" "scripts/__tests__/sync-execute.test.mjs"` from `apps/readest-app`: 2 files passed, 27 tests passed.
- ❌ Focused harness validation from `apps/readest-app` with `BIBLIOTECA_DEV_SYNC_HARNESS=1` reran only `13a`, `10Ma`, `10Mb`, and `10Mc` after doctor/preflight and one bounded Android reset/reinit. All four cases still fail; reports: `/tmp/biblioteca-dev-sync/phase2-focused/phase2-focused-1782826128072.json` and `/tmp/biblioteca-dev-sync/phase2-focused/phase2-focused-10M-1782826215933.json`.
- ✅ Follow-up focused unit validation: `pnpm exec vitest run scripts/__tests__/sync-execute.test.mjs scripts/__tests__/prepare-engine.test.mjs` from `apps/readest-app`: 2 files passed, 29 tests passed.
- ✅ Follow-up real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` reran from `apps/readest-app` with `BIBLIOTECA_DEV_SYNC_HARNESS=1`: 4/4 cases passed; evidence `/tmp/biblioteca-dev-sync/phase2-focused/phase2-focused-followup-1782854284015.json`.
- ✅ Phase 7 focused sync validation: `pnpm exec vitest run scripts/__tests__/sync-execute.test.mjs` from `apps/readest-app`: 1 file passed, 28 tests passed.
- ✅ Phase 7 focused sync+prepare validation: `pnpm exec vitest run scripts/__tests__/sync-execute.test.mjs scripts/__tests__/prepare-engine.test.mjs` from `apps/readest-app`: 2 files passed, 30 tests passed.
- ✅ Phase 7 focused HTTP inject validation: `node --test scripts/__tests__/sync-dev-inject-http.test.mjs` from `apps/readest-app`: passed.
- ✅ Temporary pending marker cleanup confirmed: `/tmp/biblioteca-dev-sync/pending-android-book-tombstones.json` was removed after the focused marker test flow.
- ✅ Bounded doctor/preflight rerun: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor -- --json` from `apps/readest-app` passed `phase2.preflight` before and after the focused harness run. Overall doctor status remained `warn` only because Android lacks the `sqlite3` CLI; HTTP replica endpoints and `/books/index` evidence were available.
- ✅ Evidence file present: `/tmp/biblioteca-dev-sync/phase2-focused/phase2-focused-followup-1782854284015.json`.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` | Created in PR 1 | Added focused unit coverage for tombstoned same-hash resurrection and live duplicate idempotence. |
| `apps/readest-app/scripts/prepare-engine.mjs` | Modified in PR 1 | Reuses existing library parse, skips only live same-hash duplicates, and replaces same-hash tombstoned entries with fresh live metadata. |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modified | Added focused Vitest coverage for timestamp normalization, newer remote tombstone merge before push, older tombstone rejection, and D/C/N file preservation. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Added remote tombstone merge helpers, writes fresher Android tombstones to desktop `library.json`, pulls `/books/index` before `pushBooks()`, accepts wrapped index payloads, and serializes live reimport timestamps numerically before pushing to Android. |
| `apps/readest-app/scripts/__tests__/sync-dev-inject-http.test.mjs` | Modified | Added focused `deleteBookViaHttp` coverage for successful Android book delete marker recording and missing-book failure behavior. |
| `apps/readest-app/scripts/sync-dev-inject-http.mjs` | Modified | Added `deleteBookViaHttp()` and pending Android book tombstone marker recording with numeric delete timestamps. |
| `openspec/changes/fix-phase2-book-tombstone-reimport-mirror/tasks.md` | Modified | Marked completed PR 2 implementation/test tasks while leaving real-device harness validation open. |
| `openspec/changes/fix-phase2-book-tombstone-reimport-mirror/apply-progress.md` | Modified | Merged PR 1 apply progress with PR 2 progress and TDD evidence. |

## Deviations from Design

None — implementation matches the PR 2 design: pull Android `/books/index`, apply only fresher remote book tombstones to desktop `library.json`, then continue through the existing push path. Real-device harness validation remains a validation step, not a design deviation.

Phase 7 adds a focused harness-side pending marker for same-cycle Android book deletes when `/books/index` has already lost the tombstone. That is a narrow extension of the remote-tombstone merge design, not a D/C/N or server capability change.

## Issues Found

- No `openspec/config.yaml` exists in the repository; Strict TDD mode was resolved from the user prompt and Engram testing capabilities instead.
- The earlier package `pnpm test -- <file>` invocation did not focus the target file in this workspace and ran the wider suite. Direct focused Vitest via `pnpm exec vitest run <file>` was used for RED/GREEN gates.
- Earlier focused real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` failed before the Phase 6/7 follow-ups. After the latest focused verification, all four cases now pass: `13a` resurrects live on desktop and Android, and `10Ma`/`10Mb`/`10Mc` produce desktop and Android tombstones while preserving target semantic rows.
- Follow-up inspection found two script-level gaps consistent with the evidence: remote tombstone extraction only accepted a bare array, while some harness/HTTP state paths expose `books` wrappers; and live same-hash reimports pushed ISO timestamps without a numeric `createdAt`, which Android's book index merge cannot compare as a newer resurrection over an older tombstone.
- The 10M follow-up identified a same-cycle harness gap: after Android HTTP delete, `/books/index` can lose the tombstone before desktop sync reads it, so a local pending Android book tombstone marker is consumed by `sync-execute.mjs` before `pushBooks()` to avoid stale desktop live resurrection.
- Current doctor/preflight is available and passes `phase2.preflight`; overall doctor status remains `warn` only because Android lacks the `sqlite3` CLI.

## Remaining Tasks / Follow-up

- [x] 5.2 Run focused harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` only.
- [x] Follow-up fix applied for the script-level wrapped-index and numeric-reimport timestamp gaps.
- [x] Follow-up 10M fix applied for pending Android book tombstone marker capture/consumption and HTTP delete coverage.
- [x] Rerun focused real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` after doctor/preflight passes.

## Workload / PR Boundary

- Mode: stacked PR slice (`auto-chain`, `stacked-to-main`)
- Current work unit: PR 2 — Android `/books/index` tombstone merge before desktop push.
- Boundary: starts after PR 1 prepare reimport resurrection; ends with desktop sync applying fresher Android book tombstones and same-cycle pending Android delete markers before `pushBooks()` while preserving D/C/N paths and leaving blocked harness capabilities untouched.
- Estimated review budget impact: focused script/test slice; no Rust/server redesign, no blocked harness cases, no build.

## Status

23/23 tasks executed. Focused unit and HTTP inject tests pass after the 10M follow-up fix, and focused real-device harness verification for `13a`, `10Ma`, `10Mb`, and `10Mc` now passes. The change is ready for archive from this focused verification scope.
