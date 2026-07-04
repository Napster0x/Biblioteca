# Design: Fix Phase 2 Sync Failures

## Technical Approach

Fix the contract where Phase 2 actually exercises sync: Android book deletion must be an HTTP tombstone operation, desktop tombstones must be pushed during `sync-execute`, and dictionary-entry pushes must compare row freshness from field HLCs so `definition` edits are not filtered or skipped. BookNote runner remains out of scope.

## Root-Cause Hypotheses and Verification

| Failure | Hypothesis | Verify with |
|---|---|---|
| Android `/books/delete` 404 | `deleteBookViaHttp()` calls `PUT /books/delete`, but `local_sync_server.rs::parse_route` has only `/books/index`, `/books/manifest`, and asset routes. | Add route/parser and integration test expecting 200 for `PUT /books/delete`. |
| Desktop delete not removing Android manifest | `sync-dev-inject.mjs::deleteBook()` physically removes the book from desktop `library.json`; `sync-execute.mjs` skips missing local books and only pushes live books, so Android never sees a tombstone. | Script test: deleting desktop creates/pushes `deletedAt`; sync-execute sends tombstone to `/books/index`; manifest excludes live asset while `/books/index` retains tombstone. |
| `dictionary_entries.definition` not converging | `rowToReplica()` stores per-field timestamps, but `updated_at_ts` uses row `updated_at`. If fixture edits only update `replica_timestamps.definition`, filtering/push HLC gates can treat the row as unchanged even when `definition.t` is newer. | Unit test row with stale `updated_at`, newer `replica_timestamps.definition`; ensure it is pushed and Android app table changes definition. |

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Book delete API | Implement `PUT /books/delete` as tombstone writer over `library.json`. | Change harness to `PUT /books/index`; physical delete assets. | Existing HTTP client already defines the contract; tombstones preserve convergence evidence and avoid destructive asset cleanup. |
| Desktop delete representation | Change desktop `deleteBook()` to write a tombstone entry with `deletedAt`, `updatedAt`, `downloadedAt:null` instead of removing the row. | Keep physical removal and infer delete during sync. | Sync needs explicit state. Missing rows are ambiguous: never existed, filtered, or deleted. |
| Book sync propagation | `sync-execute` pushes tombstones whose hash is absent or live on Android. | Pull-only reconciliation. | Existing Android `serve_put_books_index()` already preserves tombstones and guards stale live resurrection. |
| Dictionary freshness | Derive replica `updated_at_ts` as max(row timestamp, all field envelope HLCs, deleted HLC). Apply same logic before filtering. | Patch only Rust merge. | Rust already merges `definition` by field HLC once a row arrives; the likely loss happens before/at push filtering. |

## Data Flow

### Book delete

| Step | Desktop delete | Android delete |
|---|---|---|
| 1 | `dev-sync-fixture --delete-book HASH` | `deleteBookViaHttp(HASH)` |
| 2 | `deleteBook()` updates matching `library.json` entry: `deletedAt=ts`, `updatedAt=ts`, `downloadedAt=null` | `PUT /books/delete {hash}` |
| 3 | `sync-execute` reads local tombstone | `local_sync_server` tombstones matching entry, or inserts minimal tombstone if absent |
| 4 | `transport.pushBookLibrary([tombstone])` to Android `/books/index` | `GET /books/manifest` omits live assets but `/books/index` exposes tombstone for peer sync |

```
desktop library tombstone ──PUT /books/index──→ Android library.json
        │                                      │
        └────────── next manifest pull sees deletion evidence ──────────┘
```

### Dictionary definition update

| Step | Component | Rule |
|---|---|---|
| 1 | `sync-dev-sqlite` | Edit writes `replica_timestamps.definition = newer HLC`. |
| 2 | `rowToReplica()` | `updated_at_ts = max(fallbackUpdatedAt, field envelope HLCs, deleted HLC)`. |
| 3 | `filterUnchangedReplicas()` | Newer row is not skipped by stale row `updated_at`. |
| 4 | Android `visible_repo.push()` | `merge_fields_jsonb()` applies newer `definition` and preserves older absent fields. |

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modify | Add `Route::BooksDelete`, request body parsing, tombstone helper, CORS method coverage, route/integration tests. |
| `apps/readest-app/scripts/sync-dev-inject.mjs` | Modify | Convert `deleteBook()` from physical removal to tombstone update/insert. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Push local book tombstones and compute replica row HLC from max field timestamp. |
| `apps/readest-app/scripts/sync-dev-inject-http.mjs` | Modify | Keep `/books/delete`; add tests for success/error body if needed. |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modify | No semantic expansion; only adjust expectations if `deleteBook()` return action changes. |
| `apps/readest-app/scripts/__tests__/*.test.mjs` | Modify | Add focused failing tests for tombstone and dictionary HLC freshness. |

## Interfaces / Contracts

- `PUT /books/delete` body: `{ "hash": string, "deletedAt"?: number }`.
- Response: `{ "deleted": true, "hash": string, "action": "tombstoned" | "not-found-tombstone-created" }`.
- Tombstone shape MUST include `hash`, `deletedAt`, `updatedAt`, `downloadedAt:null`; metadata fields MAY be preserved from the existing book.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Rust unit/integration | Route parsing, `/books/delete`, tombstone persistence, manifest behavior. | Existing raw TCP tests in `local_sync_server.rs`. |
| Node unit | Desktop `deleteBook()` tombstones; `sync-execute` pushes tombstones; `rowToReplica()` max-HLC. | `node:test` under `scripts/__tests__`. |
| Harness | Phase 2 P0/P1 cases 9a, 10a, 10b, 11b, 12a, 12b. | Real-device rerun after tests pass; do not address P2 BookNote. |

## Migration / Rollout

No migration required. Existing live library entries are converted to tombstones only when deleted.

## Slicing Recommendation

Use auto-chain stacked-to-main in three reviewable slices: (1) Android `/books/delete` endpoint + Rust tests, (2) desktop delete/tombstone propagation + Node tests, (3) dictionary max-HLC freshness + convergence tests.

## Open Questions

- None.
