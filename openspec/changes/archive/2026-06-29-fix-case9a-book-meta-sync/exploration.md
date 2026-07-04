## Exploration: fix-case9a-book-meta-sync

### Current State

**P0: `pushBooks()` skips metadata updates (sync-execute.mjs)**

`pushBooks()` at line 425 of `sync-execute.mjs` iterates local library entries and:
1. Pushes tombstones (deletedAt set) unconditionally via `PUT /books/index`
2. **Skips** books whose hash already exists in the remote manifest: `if (remoteBooks.has(book.hash)) continue;`
3. Pushes new books (hash not on remote) + assets

Book `hash` is derived from EPUB content. Metadata edits (title, author, metadata fields) don't change the hash. So `pushBooks()` **never sends metadata updates** to Android. The Android `PUT /books/index` handler (`serve_put_books_index()`) already supports merge — it does `merged[idx] = book` for existing hashes with tombstone guards. The data path works; the issue is only that the desktop never triggers it for metadata-changed books.

The `rowToReplica()` HLC freshness fix from the prior change (`fix-phase2-sync-failures`) addressed dictionary-entry definition convergence (replica-level), but book metadata sync uses a totally separate path (`pushBooks` → `PUT /books/index`, not replicas).

**P1: Android clean misses shared_prefs / WebView (dev-sync-reset.mjs)**

`cleanAndroid()` in `dev-sync-reset.mjs` deletes files under `readestDir` (`/data/data/<pkg>/Readest/`) plus `/data/data/<pkg>/settings.json` and `Books/*`. It does NOT clean:
- `/data/data/<pkg>/shared_prefs/` — Android SharedPreferences (persists across force-stop)
- `/data/data/<pkg>/app_webview/` — WebView localStorage / IndexedDB

These residuals cause replica or settings state to survive force-stop + restart, producing false failures in harness cases.

`spawnAndroidClean()` in `dev-sync-cycle.mjs` already does force-stop + settings re-injection after the reset, but the residual WebView/shared_prefs data pollutes the clean state.

### Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` (pushBooks) | P0 bug | `remoteBooks.has(book.hash)` skip prevents metadata update propagation |
| `apps/readest-app/scripts/dev-sync-reset.mjs` (cleanAndroid) | P1 bug | Misses shared_prefs, app_webview in Android cleanup targets |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` (spawnAndroidClean) | P1 related | Force-stop already done; adding shared_prefs/app_webview cleanup here too |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Tests | Needs test for metadata-update push path |

### Approaches

**P0 — pushBooks metadata update detection**

1. **Compare `updatedAt` timestamps** — if local `book.updatedAt > remoteBook.updatedAt`, push the metadata-only update (no assets)
   - Pros: Minimal change, no new fields needed, uses existing timestamp infrastructure
   - Cons: Requires reliable `updatedAt` bumping on edit (already done by fixture harness)
   - Effort: Low

2. **Always push all live books** — remove the `remoteBooks.has(book.hash)` skip entirely
   - Pros: Simplest possible change
   - Cons: Sends ALL books every sync cycle (wasteful bandwidth for large libraries)
   - Effort: Very Low

3. **Deep field comparison** — compare title, author, metadata fields between local and remote
   - Pros: Most precise
   - Cons: Fragile (fields may diverge), more complex, unnecessary since `updatedAt` is the canonical signal
   - Effort: Medium

**P1 — Android clean completeness**

1. **Add missing paths** — append `shared_prefs`, `app_webview`, `cache` to the ADB `run-as rm -rf` targets
   - Pros: Targeted, no behavior change, works with existing run-as mechanism
   - Cons: Might miss other residual storage (e.g., `no_backup/`, `code_cache/`)
   - Effort: Low

2. **Use `pm clear <package>`** — nuclear option that wipes all app data
   - Pros: Guarantees clean state, `spawnAndroidClean()` already re-injects settings.json
   - Cons: More aggressive, stops the app process (already done by force-stop)
   - Effort: Low

3. **Hybrid** — add specific paths + `pm clear` as fallback
   - Pros: Belt-and-suspenders
   - Cons: Redundant, `pm clear` alone suffices since settings is re-injected
   - Effort: Low

### Recommendation

**P0**: Approach 1 (compare `updatedAt`). It's the minimal semantic check — uses the existing timestamp infrastructure that's already maintained by the fixture/edit harness. Only sends metadata (no assets), keeping the push lightweight. Return a new `updated` counter for observability.

**P1**: Approach 2 (use `pm clear`). Since `spawnAndroidClean()` already force-stops + re-injects settings.json, `pm clear` provides a guaranteed-clean slate without enumerating paths. Simpler, more robust, fewer edge cases.

### Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `updatedAt` not bumped on desktop edit | Low | Fixture harness (`updateBook()`) already bumps `updatedAt`. Verify with test. |
| Android `PUT /books/index` rejects metadata-only push | Very Low | It already does `merged[idx] = book` — a full replacement. No per-field merge needed. |
| `pm clear` not available on all Android builds | Low | `pm` is part of Android shell; debug builds always have it. |
| `pm clear` removes settings before re-injection | None | `spawnAndroidClean()` already re-injects settings.json after clear. |

### Ready for Proposal

Yes. Both root causes are well-understood, approaches are clear, and effort is low.
