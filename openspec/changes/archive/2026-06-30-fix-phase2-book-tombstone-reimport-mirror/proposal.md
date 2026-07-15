# Proposal: Fix Phase 2 Book Tombstone Reimport Mirror

## Intent

Fix the remaining real Phase 2 mirror failures where book tombstones do not round-trip correctly: desktop same-hash reimport after delete must resurrect on Android, and Android book delete must tombstone desktop without deleting D/C/N data.

## Scope

### In Scope
- Allow `prepare-engine.mjs` to replace a same-hash tombstoned desktop library entry with a live, newer reimport.
- Make `sync-execute.mjs` read Android `/books/index` and apply newer remote book tombstones to desktop `library.json` before pushing books.
- Add focused tests for both behaviors and preserve D/C/N rows.

### Out of Scope
- Android EPUB import/reimport capability (`13Ma`).
- BookNote/highlight delete capability (`14*`, `14M*`).
- Full book CRDT redesign or manifest contract changes.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: book tombstone/reimport mirror behavior for Phase 2 cases `13a`, `10Ma`, `10Mb`, `10Mc`.

## Approach

Use the existing book index contract. Desktop prepare keeps skipping live same-hash imports, but treats a same-hash tombstone as a resurrection/update and clears `deletedAt`. Sync execution pulls `/books/index`, merges newer remote tombstones into desktop `library.json`, then runs existing `pushBooks()`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/prepare-engine.mjs` | Modified | Reimport tombstone resurrection path. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Pull/apply remote book tombstones before push. |
| `apps/readest-app/scripts/__tests__/` | Modified | Focused Node tests for regression coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Timestamp ordering mismatch | Med | Normalize number and ISO timestamps in tests. |
| Stale remote tombstone hides newer local reimport | Med | Only apply tombstones newer than local live/reimport. |
| D/C/N accidental deletion | Low | Do not touch SQLite/replica paths. |

## Rollback Plan

Revert the two script changes and their tests. Existing Rust `/books/index` and `/books/delete` behavior remains unchanged.

## Dependencies

- Existing Android local sync server `/books/index`, `/books/delete`, and `/books/manifest` contracts.

## Success Criteria

- [ ] Focused prepare test proves same-hash tombstone reimport becomes live.
- [ ] Focused sync test proves Android tombstone updates desktop `deletedAt`.
- [ ] Phase 2 rerun failures `13a`, `10Ma`, `10Mb`, `10Mc` pass without changing blocked cases.
