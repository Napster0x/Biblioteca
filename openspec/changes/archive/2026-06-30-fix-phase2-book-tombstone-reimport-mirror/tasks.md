# Tasks: Fix Phase 2 Book Tombstone Reimport Mirror

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 220-340 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 prepare resurrection → PR 2 sync tombstone merge + harness |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Desktop same-hash tombstone reimport resurrection | PR 1 | `prepare-engine.mjs` + focused unit test; base `main`. |
| 2 | Android book tombstone merge before desktop push | PR 2 | `sync-execute.mjs` + sync tests + focused harness validation; stacked on PR 1. |

## Phase 1: RED tests for prepare resurrection

- [x] 1.1 Create `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` proving same-hash tombstoned EPUB reimport clears `deletedAt`, stamps newer `updatedAt`, and keeps one library row.
- [x] 1.2 Assert stale tombstone data cannot re-delete the newer reimported book in the prepare test fixture.

## Phase 2: GREEN prepare implementation

- [x] 2.1 Modify `apps/readest-app/scripts/prepare-engine.mjs` `importEpubToLibrary` to skip live same-hash duplicates but resurrect same-hash tombstoned entries.
- [x] 2.2 Ensure resurrected entries copy the EPUB, preserve hash identity, clear `deletedAt`, and refresh `importedAt`/`updatedAt`.

## Phase 3: RED tests for sync tombstone ordering

- [x] 3.1 Add `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` cases for numeric and ISO timestamp normalization, invalid/null values, and `localMaxMillis` comparison.
- [x] 3.2 Add sync tests where newer Android `/books/index` tombstone updates desktop before push, while older tombstone loses to newer local reimport.
- [x] 3.3 Add D/C/N preservation assertion: merge helper changes only `library.json` book state and does not invoke dictionary, quote/citation, note, or annotation replica paths.

## Phase 4: GREEN sync implementation

- [x] 4.1 Modify `apps/readest-app/scripts/sync-execute.mjs` with `normalizeBookTimestamp(value)` and `mergeRemoteBookTombstones(localLibrary, remoteIndexBooks)` helpers.
- [x] 4.2 Wire sync execution to fetch Android `/books/index`, merge newer remote book tombstones into desktop `library.json`, then call existing `pushBooks()`.
- [x] 4.3 Prevent stale tombstones by applying remote deletes only when `remoteDeletedAtMillis > max(updatedAt, deletedAt, importedAt, createdAt)`.

## Phase 5: Focused validation and cleanup

- [x] 5.1 Run focused unit tests for `prepare-engine.test.mjs` and `sync-execute.test.mjs`; keep changes limited to desktop harness scripts.
- [x] 5.2 Run focused harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` only. Result: all four still fail; see focused verification evidence in `verify-report.md`.
- [x] 5.3 Confirm blocked harness capabilities `14*`, `9Ma`, and `13Ma` remain out of scope and are not reclassified by this change.

## Phase 6: Focused follow-up for failed harness evidence

- [x] 6.1 Inspect prior evidence files and real `/books/index`/manifest server behavior for `13a`, `10Ma`, `10Mb`, and `10Mc` only.
- [x] 6.2 Add focused failing unit coverage for wrapped `/books/index` tombstone payloads and live reimport timestamp serialization.
- [x] 6.3 Fix `sync-execute.mjs` minimally so wrapped remote tombstones merge into desktop and live reimports push numeric ordering timestamps that can beat older Android tombstones.
- [x] 6.4 Run focused unit tests for `prepare-engine.test.mjs` and `sync-execute.test.mjs`.
- [x] 6.5 Rerun focused real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc`. Result: all four pass after the Phase 7 follow-up; see `/tmp/biblioteca-dev-sync/phase2-focused/phase2-focused-followup-1782854284015.json`.

## Phase 7: Focused follow-up for `10M*` Android delete resurrection

- [x] 7.1 Add focused RED coverage for stale desktop live state when `/books/index` has already lost the Android tombstone but the Android delete fixture ran in the same cycle.
- [x] 7.2 Add focused RED coverage that Android HTTP book delete records a local pending tombstone marker with a numeric `deletedAt`.
- [x] 7.3 Fix scripts minimally so `deleteBookViaHttp()` sends/records a numeric delete timestamp and `sync-execute.mjs` consumes pending Android delete tombstones before `pushBooks()`.
- [x] 7.4 Run focused unit tests for `sync-execute.test.mjs`, `prepare-engine.test.mjs`, and `sync-dev-inject-http.test.mjs`.
- [x] 7.5 Rerun focused real-device harness validation for `13a`, `10Ma`, `10Mb`, and `10Mc` once doctor/preflight is available. Result: all four pass with `phase2.preflight` passing before and after execution.
