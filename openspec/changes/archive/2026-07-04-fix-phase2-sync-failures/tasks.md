# Tasks: Fix Phase 2 Sync Failures

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450-650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 Android delete API → PR 2 desktop tombstone propagation → PR 3 dictionary HLC convergence + rerun |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Android `/books/delete` contract | PR 1 | Base `main`; Rust tests included. |
| 2 | Desktop delete-book tombstone push | PR 2 | Base `main` after PR 1; Node tests included. |
| 3 | Dictionary definition HLC convergence | PR 3 | Base `main` after PR 2; Node tests and real-device rerun evidence included. |

## Phase 1: PR 1 — Android Book Delete Contract

- [x] 1.1 RED: add `apps/readest-app/src-tauri/src/local_sync_server.rs` tests for `PUT /books/delete`, idempotent missing hash, manifest exclusion, and D/C/N data preservation.
- [x] 1.2 GREEN: add `Route::BooksDelete`, body parsing, CORS coverage, and tombstone persistence in `local_sync_server.rs`.
- [x] 1.3 VERIFY: run `cargo test -p Biblioteca local_sync_server --manifest-path apps/readest-app/src-tauri/Cargo.toml`.

## Phase 2: PR 2 — Desktop Delete Propagation

- [x] 2.1 RED: add `apps/readest-app/scripts/__tests__/sync-dev-inject.test.mjs` coverage proving `deleteBook()` writes `deletedAt`, `updatedAt`, `downloadedAt:null` instead of removing the row.
- [x] 2.2 RED: add `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` coverage proving local tombstones are pushed to Android `/books/index` and manifest evidence reports deletion.
- [x] 2.3 GREEN: update `apps/readest-app/scripts/sync-dev-inject.mjs`, `sync-execute.mjs`, and only necessary `dev-sync-fixture.mjs` return expectations.
- [x] 2.4 VERIFY: run `node --test apps/readest-app/scripts/__tests__/sync-dev-inject.test.mjs apps/readest-app/scripts/__tests__/sync-execute.test.mjs`.

## Phase 3: PR 3 — Dictionary Definition Convergence

- [x] 3.1 RED: add `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` cases for newer desktop `definition`, stale desktop rejection, and detached/source-unavailable convergence.
- [x] 3.2 GREEN: update `apps/readest-app/scripts/sync-execute.mjs` so replica freshness uses max(row timestamp, field envelope HLCs, deleted HLC) before filtering/push.
- [x] 3.3 GREEN: VERIFIED — no Rust change needed. `merge_fields_jsonb()` in `visible_repo.rs` already handles field-level HLC correctly. The bug was that rows never arrived at Rust due to Node-side filtering with artificially low `updated_at_ts`. Fixed by making `rowToReplica()` compute `updated_at_ts` as max of all timestamps.
- [x] 3.4 VERIFY: run `node --test apps/readest-app/scripts/__tests__/sync-execute.test.mjs` and `pnpm --filter biblioteca-app test -- src/__tests__/services/sync --run` if Rust/TS merge tests are touched.

## Phase 4: Real-Device Phase 2 Verification

- [x] 4.1 SUPERSEDED: the old rerun refs `9a`, `10a`, `10b`, `11b`, `12a`, and `12b` are administratively replaced by the newer documented/verified Phase 2 matrix by explicit user decision. Evidence: `openspec/changes/archive/2026-07-03-add-phase2-harness-capabilities/verify-report.md` reports PASS with `40/40` (`100%`) reliability for `9Ma`, `13Ma`, `14a`, `14b`, `14c`, `14Ma`, `14Mb`, and `14Mc` using `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783061589013-repeat.json`; `openspec/changes/archive/2026-06-30-fix-phase2-book-tombstone-reimport-mirror/verify-report.md` reports PASS WITH WARNINGS for `13a`, `10Ma`, `10Mb`, and `10Mc`.
- [x] 4.2 SUPERSEDED: the old scope guard is administratively satisfied by the newer verified matrix and main-spec deltas for `10Ma`/`10Mb`/`10Mc`, `9Ma`, `13Ma`, and `14*`; no BookNote semantic delete implementation is added in this change.

### Administrative reconciliation note

| Pending item | Resolution | Evidence |
|--------------|------------|----------|
| `4.1 RERUN` for old refs `9a`, `10a`, `10b`, `11b`, `12a`, `12b` | Superseded by explicit user decision; old refs are officially replaced by the newer Phase 2 matrix documented and verified later. | `openspec/changes/archive/2026-07-03-add-phase2-harness-capabilities/verify-report.md` (`PASS`, `40/40`, `100%`, refs `9Ma`, `13Ma`, `14a`, `14b`, `14c`, `14Ma`, `14Mb`, `14Mc`, evidence `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783061589013-repeat.json`) and `openspec/changes/archive/2026-06-30-fix-phase2-book-tombstone-reimport-mirror/verify-report.md` (`PASS WITH WARNINGS`, refs `13a`, `10Ma`, `10Mb`, `10Mc`). |
| `4.2 SCOPE GUARD` for BookNote semantic delete follow-up | Superseded/satisfied administratively; this change remains non-implementation-only for that scope guard. | Main spec now contains later deltas for `10Ma`/`10Mb`/`10Mc`, `9Ma`, `13Ma`, and `14*`; no archive move or spec mutation is performed here. |
