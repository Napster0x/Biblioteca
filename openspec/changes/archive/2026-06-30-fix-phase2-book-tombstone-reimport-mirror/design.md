# Design: Fix Phase 2 Book Tombstone Reimport Mirror

## Technical Approach

Make the smallest desktop harness changes needed for book tombstone convergence. `prepare-engine.mjs` will keep the same-hash live-book skip, but a same-hash tombstoned entry becomes a legitimate resurrection: copy the EPUB, replace/update the library entry, clear `deletedAt`, and stamp fresh `importedAt`/`updatedAt`. `sync-execute.mjs` will pull Android `/books/index` before `pushBooks()`, merge only newer remote book tombstones into desktop `library.json`, then push the resulting local library through the existing path.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Keep fix in scripts | Modify `prepare-engine.mjs` and `sync-execute.mjs` only | Rust server rewrite or CRDT redesign | Existing Android `/books/index` already supports tombstones and newer live reimport; Phase 2 failures are desktop harness gaps. |
| Tombstone resurrection | Same hash + `deletedAt` means replace with live entry and clear tombstone | Always skip same hash; create duplicate row | Hash remains the semantic book identity, so resurrection must update the existing row instead of duplicating it. |
| Remote tombstone merge | Pull `/books/index`, apply remote tombstones only when their delete timestamp is newer than the local book timestamp | Trust manifest only; overwrite all local books | Manifest omits tombstones. Full overwrite risks stale remote data hiding a newer desktop reimport. |
| Preserve semantic rows | Do not touch dictionary/quote/annotation SQLite merge code | Cascade delete D/C/N by book hash | Proposal explicitly requires D/C/N preservation; book deletion is a library tombstone, not semantic-row deletion. |

## Data Flow

```text
prepare EPUB ──same hash tombstone──→ live library entry

sync-execute:
Android /books/index ──newer tombstones──→ desktop library.json
desktop library.json ──existing pushBooks──→ Android /books/index/assets
replica D/C/N paths ──────────────────────→ unchanged
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/prepare-engine.mjs` | Modify | In `importEpubToLibrary`, distinguish live duplicate from tombstoned duplicate; replace tombstone with fresh live metadata. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Add timestamp normalization and remote book tombstone merge helper; call it after pulling `/books/index` and before `pushBooks()`. |
| `apps/readest-app/scripts/__tests__/prepare-engine.test.mjs` | Create | Node test for same-hash tombstone reimport clearing `deletedAt` and preserving single library row. |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modify | Add strict tests for numeric/ISO timestamp comparison and remote tombstone merge without D/C/N side effects. |

## Interfaces / Contracts

No external API changes. Add small exported helpers only if needed for tests:

```js
normalizeBookTimestamp(value) // number | ISO string | null -> millis, invalid -> 0
mergeRemoteBookTombstones(localLibrary, remoteIndexBooks) // returns { library, applied }
```

Comparison rule: a remote book with `deletedAt` is applied when `remoteDeletedAtMillis > localMaxMillis`, where `localMaxMillis` is max of local `updatedAt`, `deletedAt`, `importedAt`, and `createdAt`. Live remote entries are not pulled into desktop by this helper.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Same-hash tombstone reimport | RED test in `prepare-engine.test.mjs`, then minimal fix. |
| Unit | Remote tombstone merge ordering | Tests in `sync-execute.test.mjs` for ISO/numeric timestamps, stale tombstone rejection, and newer tombstone application. |
| Regression | D/C/N preservation | Assert merge helper only returns book-library changes and does not invoke SQLite replica paths. |
| Harness | Phase 2 real cases | After focused tests pass, rerun real harness validation for `13a`, `10Ma`, `10Mb`, `10Mc`; blocked harness capabilities remain out of scope. |

## Migration / Rollout

No migration required. Existing `library.json` tombstones are reused; future reimports and syncs converge through the updated scripts.

## Open Questions

None.
