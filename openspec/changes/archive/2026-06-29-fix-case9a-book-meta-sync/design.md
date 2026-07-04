# Design: fix-case9a-book-meta-sync

## Technical Approach

Two isolated fixes addressing Phase 2 harness failures:

- **P0**: In `pushBooks()`, when a book's hash exists on remote, compare `updatedAt` timestamps. If local is newer, push a metadata-only update via `PUT /books/index` (no asset push). Track as `updated` counter.
- **P1**: Replace file-enumeration `cleanAndroid()` with `adb shell pm clear <package>` for a guaranteed-clean Android state. Keep file-based fallback if `pm clear` fails.

No new network endpoints, data structures, or Android-side changes.

## Architecture Decisions

### Decision: updatedAt comparison vs. field-level diff

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Compare `updatedAt` timestamps | Relies on existing timestamp infrastructure; fixture already bumps `updatedAt` | **Chosen** — minimal, correct, no new schema |
| Deep field comparison | Precise but fragile — fields may diverge or be added | Rejected — over-engineered |
| Always push all live books | Simplest, but wasteful for large libraries | Rejected — unnecessary bandwidth |

### Decision: pm clear vs. adding missing paths

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `adb shell pm clear <package>` | Nuclear clean; `spawnAndroidClean()` already re-injects settings.json | **Chosen** — guaranteed clean, fewer edge cases |
| Add shared_prefs/app_webview paths | Targeted but may miss residual storage (`no_backup/`, `code_cache/`) | Rejected — leaky abstraction |
| Hybrid (both) | Redundant and unnecessary since `pm clear` + settings re-injection suffices | Rejected |

### Decision: Keep file-based fallback for cleanAndroid()

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Try `pm clear` first, fallback to file-by-file `run-as rm -rf` | Slightly more code, but handles edge case where `pm` is unavailable | **Chosen** — conservative, minimal risk |
| Only `pm clear` | Simpler, but breaks on non-standard Android builds | Rejected — fragile |

## Data Flow

### P0 — Metadata update push

```
pushBooks() per local book:
  ├── deletedAt set? → push tombstone via PUT /books/index → tombstonesPushed++
  ├── NOT in remoteBooks? → push library entry + assets via PUT /books/index + pushBookAssets → sent++
  ├── IN remoteBooks AND local.updatedAt > remote.updatedAt?
  │     → push metadata-only via PUT /books/index (NO assets) → updated++
  └── IN remoteBooks AND local.updatedAt <= remote.updatedAt? → skip completely
```

### P1 — Android clean (spawnAndroidClean → cleanAndroid)

```
spawnAndroidClean():
  1. Try: adb shell pm clear <package>          // NEW: nuclear clean
     └─ On failure: adb shell run-as ... rm -rf  // FALLBACK: file-by-file (existing)
  2. adb shell am force-stop <package>          // existing
  3. Inject settings.json                       // existing
  4. adb shell am start ...                     // existing
  5. Health check loop                          // existing
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | `pushBooks()`: add `updatedAt` comparison; push metadata-only updates; return `updated` counter |
| `apps/readest-app/scripts/dev-sync-reset.mjs` | Modify | `cleanAndroid()`: try `pm clear` first, fallback to file-by-file `run-as rm -rf` |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modify | Add test cases for metadata update push path |

## Interfaces / Contracts

### pushBooks() return value (modified)

```js
// Current
return { sent, tombstonesPushed };

// New
return { sent, updated, tombstonesPushed };
// sent:     new books pushed with assets
// updated:  existing books with newer updatedAt, metadata-only
// tombstonesPushed: deleted books pushed
```

### cleanAndroid() signature (unchanged)

```js
async function cleanAndroid({ dryRun }) → { target, root, ..., counts, ... }
```

No signature change — behavior change only: tries `pm clear` first, falls back to file enumeration.

## Testing Strategy

### P0 — pushBooks metadata update detection

| Layer | What | Approach |
|-------|------|----------|
| Unit | Metadata-updated book is pushed | Local book with `updatedAt > remoteBook.updatedAt` → verify `transport.pushBookLibrary` called exactly once with that book, `pushBookAssets` NOT called |
| Unit | Unchanged book is still skipped | Local book with `updatedAt <= remoteBook.updatedAt` → verify no push |
| Unit | `updated` counter returned correctly | Happy path with 1 new + 1 updated + 1 tombstone → verify `{ sent:1, updated:1, tombstonesPushed:1 }` |
| Unit | Asset push NOT sent for metadata update | Mock transport tracks `pushBookAsset` calls → verify 0 calls for updated books |

### P1 — Android clean (dev-sync-reset)

Covered by existing harness phase 2 e2e (Caso 9a pass/fail). No additional unit tests.

## Migration / Rollout

No migration required. Both changes are additive — the old behavior (skip all existing books; file-enumeration clean) is a safe subset of the new behavior.

## Open Questions

- None. Both approaches are validated by the exploration phase and the proposal.
