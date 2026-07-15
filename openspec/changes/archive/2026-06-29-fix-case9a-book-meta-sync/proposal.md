# Proposal: fix-case9a-book-meta-sync

## Intent

Fix two Phase 2 harness failures:
- **P0**: Book metadata edits (title, author) never reach Android because `pushBooks()` skips books whose hash already exists in the remote manifest
- **P1**: Android `dev-sync-reset` doesn't clear `shared_prefs` or WebView localStorage, leaving residual replica data that poisons harness state

## Scope

### In Scope

- Fix `pushBooks()` in `sync-execute.mjs` to detect and push metadata updates when local `updatedAt > remoteBook.updatedAt`
- Fix `cleanAndroid()` in `dev-sync-reset.mjs` (or `spawnAndroidClean()` in `dev-sync-cycle.mjs`) to use `pm clear` for guaranteed-clean Android state
- Update `sync-execute.test.mjs` with test cases for the metadata update path

### Out of Scope

- Dictionary / quote / annotation replica sync (already fixed in prior change `fix-phase2-sync-failures`)
- BookNote semantic delete runner
- Any production sync redesign or UI changes

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `sync-crdt-hlc-real-device-harness`: tighten Phase 2 expectations for book metadata propagation and Android clean completeness

## Approach

**P0 — pushBooks metadata update detection**: In `pushBooks()`, when a book's hash exists on remote, compare `updatedAt` timestamps. If local `updatedAt > remote.updatedAt`, push the library entry via `transport.pushBookLibrary([book])` (metadata only, no assets). Track as `updated` counter in return value.

**P1 — Android clean completeness**: Replace the file-enumeration approach in `cleanAndroid()` (or augment `spawnAndroidClean()`) with `adb shell pm clear <package>` after the existing file cleanup. The cycle script already force-stops + re-injects settings.json after clear.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` (pushBooks) | Modified | Add `updatedAt` comparison; push metadata updates for existing books |
| `apps/readest-app/scripts/dev-sync-reset.mjs` (cleanAndroid) | Modified | Add `pm clear` or missing target paths |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` (spawnAndroidClean) | Modified | Use `pm clear` for reliable clean |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modified | Test metadata update push path |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `updatedAt` not bumped on desktop edit | Low | Fixture `updateBook()` bumps it; test verifies |
| `pm clear` incompatible with some Android builds | Very Low | Standard Android shell command, works on all debug builds |
| Metadata push overwrites Android-only fields | Low | Desktop library.json is authoritative for metadata; Android has same schema |

## Rollback Plan

Revert `sync-execute.mjs` pushBooks change, dev-sync-reset.mjs changes, and test additions. Metadata sync falls back to "new books only" (previous behavior), harness clean falls back to file-enumeration approach.

## Dependencies

- Real Android device/dev server reachable for Phase 2 rerun

## Success Criteria

- [ ] Test proves metadata update is pushed: local book with newer `updatedAt` reaches Android `/books/index`
- [ ] Test proves unchanged books are still skipped (no regressions)
- [ ] Phase 2 Case 9a passes: book metadata edit propagates from desktop to Android
- [ ] `adb shell pm clear` or equivalent reliably cleans Android state without residual data
