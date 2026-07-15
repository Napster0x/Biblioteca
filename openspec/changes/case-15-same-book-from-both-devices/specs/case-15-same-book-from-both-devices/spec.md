# Case 15: Same Book From Both Devices — Specification

## Purpose

This spec defines the **real-device verification protocol** for Case 15 (same EPUB/PDF imported on both devices before syncing). The code ALREADY handles basic dedup (hash-based identity at all merge layers). This change:
- Verifies all 4 symmetry variants (O→M, M→O, O⇄M, R-n) on real devices
- Tests concurrent metadata-edit (both edit title offline → newer `updatedAt` wins)
- Negative-tests same-title-different-hash (MUST NOT merge)
- Documents current book identity model for the record

No product code modifications — this is a TESTING/VERIFICATION change.

**Source:** `casos_sync.md` §8.4–8.6, §12.1–12.2, §29.3 T041–T042
**Main spec:** `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` §3.1 Case 15

---

## 1. Test Scenarios

### Scenario 15a — Desktop-first (same book, same hash)

| Aspect | Detail |
|--------|--------|
| **Given** | Desktop has book L(hash=XYZ, file=`sample-alice.epub`). Android has nothing (empty library). |
| **When** | Sync desktop→android (O→M). |
| **Then** | Both devices have exactly ONE book with hash=XYZ. No duplicate entries in `library.json` (desktop) or `/books/index` manifest (Android). |
| **PASS** | Desktop `library.json` count = 1 entry (hash=XYZ). Android `/books/index` has exactly 1 book with hash=XYZ. Asset files (EPUB, cover, config) present in `Books/XYZ/`. |
| **FAIL** | Two library entries with hash=XYZ on either device. Missing book on Android. Duplicate manifest entry. |

### Scenario 15b — Android-first (same book, same hash)

| Aspect | Detail |
|--------|--------|
| **Given** | Android has book L(hash=XYZ) imported via `--import-book`. Desktop has nothing. |
| **When** | Sync android→desktop (M→O). |
| **Then** | Both devices have exactly ONE book with hash=XYZ. No duplicate. |
| **PASS** | Android `/books/index` shows 1 book. Desktop `library.json` has exactly 1 entry with hash=XYZ, matching title/author/metadata. Assets present on both sides. |
| **FAIL** | Desktop has 0 books (sync failed to pull from Android). Duplicate entries on either side. Title/author mismatch. |

### Scenario 15c — Concurrent import (same EPUB, no sync in between)

| Aspect | Detail |
|--------|--------|
| **Given** | Desktop imports L(hash=XYZ) offline. Android ALSO imports L(hash=XYZ) offline. Neither has synced yet. |
| **When** | Sync bidireccional (O⇄M). |
| **Then** | ONE logical book L(hash=XYZ) on both sides. `mergeRemoteBookMetadata` dedup by hash → only one entry per device survives. |
| **PASS** | Desktop: 1 entry in `library.json` with hash=XYZ. Android: 1 book in manifest with hash=XYZ. No duplicate library rows. `_replicas` evidence shows dedup applied at pushBooks or mergeRemoteBookMetadata layer. |
| **FAIL** | 2+ entries with same hash on either device. Duplicate rows survive post-sync. |
| **WARN** | One device has 1 entry, the other has 2 (transient). Self-heals on second sync. |

### Scenario 15d — Concurrent metadata divergence

| Aspect | Detail |
|--------|--------|
| **Given** | Both have L(hash=XYZ) with same initial metadata (title="Alice"). Desktop offline edits title="Título A". Android offline edits title="Título B". Both edits have `updatedAt` timestamps set before syncing. |
| **When** | Sync bidireccional (O⇄M). |
| **Then** | Both devices converge to the title with the newer `updatedAt`. The losing title is NOT preserved (current behavior is entity-level `updatedAt` wins — NOT field-level merge). |
| **PASS** | Both devices show the same title. The title comes from the side with the higher `updatedAt` at merge time. No duplicate library entries. |
| **FAIL** | Each device keeps its own divergent title (no convergence). Duplicate book entry appears. Data loss (book disappears entirely). |
| **WARN** | Metadata converges after one sync but `updatedAt` ordering cannot be verified (missing timestamps). Transient divergence that self-heals on second sync. |

### Scenario 15e — Same title, different hash (negative test)

| Aspect | Detail |
|--------|--------|
| **Given** | Desktop has L1(hash=AAA, title="Odisea"). Android has L2(hash=BBB, title="Odisea"). Different files with same metadata title. |
| **When** | Sync bidireccional (O⇄M). |
| **Then** | Both devices have TWO books. MUST NOT merge by title. Hash is the sole identity key. |
| **PASS** | Desktop `library.json` contains 2 entries (AAA + BBB). Android manifest contains 2 entries. Both books survive independently. |
| **FAIL** | Only 1 book after sync (false merge by title). One book's data overwrites the other. Title-based dedup incorrectly applied. |
| **WARN** | Both books present but metadata cross-contaminated (e.g. title of one applied to other). Self-heals on second sync. |

---

## 2. Evidence Requirements

Per scenario, each execution MUST produce:

| Evidence item | Source | Required for PASS |
|---------------|--------|-------------------|
| Pre-sync Desktop `library.json` | `dev:sync:state` | ✅ |
| Pre-sync Android `/books/index` manifest | `dev:sync:state` | ✅ |
| Post-sync Desktop `library.json` | `dev:sync:state` | ✅ |
| Post-sync Android `/books/index` manifest | `dev:sync:state` | ✅ |
| Desktop HLC timestamps (book `updatedAt`) | `library.json` entry per book | ✅ (scenarios 15d, 15e) |
| Android HLC timestamps | `/books/index` entry per book | ✅ (scenarios 15d, 15e) |
| `_replicas` evidence | Desktop SQLite `_replicas` tables | ✅ (concurrent scenarios) |
| `assertCase15` verdict | `dev:sync:assert` engine | ✅ |
| Clean verification pre-case | `dev:sync:state` (empty both sides) | ✅ |
| Operation log | CLI stdout / cycle report JSON | ✅ |

### Pre-sync state snapshot (per scenario)

```json
{
  "desktop": {
    "library": { "facts": [{ "hash": "XYZ", "title": "…", "updatedAt": 1783000000000 }] }
  },
  "android": {
    "bookIndex": { "facts": [{ "hash": "XYZ", "title": "…", "updatedAt": 1783000000000 }] }
  }
}
```

### Post-sync state snapshot (per scenario)

Same shape. Difference in `facts` array length (must be 1 per hash, never >1 for same hash on either side).

---

## 3. Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Expected state achieved on both devices. No duplicate book entries. No data loss. Metadata converged (scenario 15d). Two distinct book entries for different hashes (scenario 15e). All evidence items present. |
| **FAIL** | Duplicate book entries on either device. Data loss (existing book disappears). Metadata divergence (each side keeps own version). False merge by title (scenario 15e). Tombstone incorrectly blocks a reimport. |
| **WARN** | Transient divergence that self-heals within 2 sync cycles. Timing issues without data corruption. Missing evidence for one side (e.g. Android SQLite inaccessible). `assertCase15` reports no duplicates but HLC timestamps unavailable. |

### Determinism Matrix

```
                     Evidence Complete     Evidence Partial     Evidence Missing
Converged            ──────── PASS ────     ──────── WARN ───     ────── WARN ─────
Duplicates detected  ──────── FAIL ────     ──────── FAIL ───     ────── WARN ─────
Divergent metadata   ──────── FAIL ────     ──────── FAIL ───     ────── WARN ─────
```

---

## 4. Harness Protocol

### Environment setup

```bash
# Terminal 1: dev server
pnpm dev:server

# Terminal 2: Tauri desktop
pnpm dev:tauri

# Terminal 3: Android (via Tauri)
pnpm dev:android
```

### Precondition: doctor + verify connectivity

```bash
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:doctor
```

### Scenario 15a — Desktop-first (O→M)

```bash
# 1. Clean both devices
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:reset --target all --confirm DELETE_DEV_SYNC_STATE

# 2. Import EPUB on desktop (sample-alice.epub)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:prepare --file tests/fixtures/sample-alice.epub

# 3. State before sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label pre-15a

# 4. Sync desktop→android
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:trigger

# 5. State after sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label post-15a

# 6. Assert: no duplicate hash on either side, 1 book each
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:assert --case 15 --snapshot pre-15a --snapshot post-15a
```

### Scenario 15b — Android-first (M→O)

```bash
# 1. Clean both devices
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:reset --target all --confirm DELETE_DEV_SYNC_STATE

# 2. Import EPUB on Android via HTTP
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:fixture --target android-http \
  --case15 <book-hash> --import-book tests/fixtures/sample-alice.epub --title "Alice"

# 3. State before sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label pre-15b

# 4. Sync android→desktop
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:trigger

# 5. State after sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label post-15b

# 6. Assert
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:assert --case 15 --snapshot pre-15b --snapshot post-15b
```

### Scenario 15c — Concurrent import (O⇄M)

```bash
# 1. Clean both devices
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:reset --target all --confirm DELETE_DEV_SYNC_STATE

# 2. Import on desktop
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:prepare --file tests/fixtures/sample-alice.epub

# 3. Import on Android (same EPUB, different instance — NO sync between steps 2 and 3)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:fixture --target android-http \
  --case15 <book-hash> --import-book tests/fixtures/sample-alice.epub --title "Alice"

# 4. State before sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label pre-15c

# 5. Sync bidireccional
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:trigger

# 6. State after sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label post-15c

# 7. Assert: exactly 1 book per device, same hash, no duplicate
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:assert --case 15 --snapshot pre-15c --snapshot post-15c
```

### Scenario 15d — Concurrent metadata divergence

```bash
# 1. Clean + seed both with same book (sync first to establish baseline)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:reset --target all --confirm DELETE_DEV_SYNC_STATE
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:prepare --file tests/fixtures/sample-alice.epub
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:trigger
# Verify both have the book
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label pre-15d-baseline

# 2. Desktop edits title offline (older timestamp)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:fixture \
  --edit books:<hash>:title="Título A" --hlc <older-timestamp>

# 3. Android edits title offline (newer timestamp)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:fixture --target android-http \
  --edit books:<hash>:title="Título B" --hlc <newer-timestamp>

# 4. State before sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label pre-15d

# 5. Sync bidireccional
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:trigger

# 6. State after sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label post-15d

# 7. Assert: title is "Título B" (newer updatedAt wins)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:assert --case 15 --snapshot pre-15d --snapshot post-15d
```

### Scenario 15e — Same title, different hash (negative test)

```bash
# 1. Clean both devices
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:reset --target all --confirm DELETE_DEV_SYNC_STATE

# 2. Import EPUB with hash=AAA on desktop
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:prepare --file tests/fixtures/sample-alice.epub

# 3. Inject stub book with hash=BBB, same title on desktop (simulates second edition)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:fixture --case15 BBB --title "Alice"

# 4. State before sync (desktop has 2 books, Android has 0)
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label pre-15e

# 5. Sync bidireccional
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:trigger

# 6. State after sync
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:state --label post-15e

# 7. Assert: 2 books per device, both hashes present, no merge by title
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:assert --case 15 --snapshot pre-15e --snapshot post-15e
```

### Reliability runner (all variants)

```bash
BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle -- \
  --case-ref 15a,15b,15c,15d,15e \
  --repeat 5 \
  --repeat-timeout-ms 120000 \
  --min-success-rate 0.8 \
  --clean-android
```

---

## 5. Documentation: Current Book Identity Model

### Identity

- **Books use `hash` as sole identity key.** There is NO `id` field on the `Book` type (`apps/readest-app/src/types/book.ts`). The `Book` interface has `hash: string`, `title`, `author`, `updatedAt`, `deletedAt`, `createdAt`, `importedAt`, `filePath`, `fileName`, `format`, `sourceTitle`, `coverImageUrl`, `groupId`, `readingStatus`, `progress`, `metadata` — but no `id`.
- The spec's "same hash + different id" clause (from Phase 3 §1.1) applies to **replica entities** (dictionary-entry, occurrence, quote, annotation) which DO have `id` fields. For books, there is no `id` to differ.
- Confirmed: `apps/readest-app/scripts/dev-sync-fixture.mjs` `injectBookForDesktop()` stores `{ hash, title, author, updatedAt, createdAt }` — no `id`.

### Merge layers (all use `Map<hash, book>`)

| Layer | Function | Dedup key |
|-------|----------|-----------|
| Push to Android | `pushBooks()` in `sync-execute.mjs` | `book.hash` — `remoteBooks.get(book.hash)` check |
| Pull from Android | `mergeRemoteBookMetadata()` in `sync-execute.mjs` | `book.hash` — `indexByHash` Map |
| Local import merge | `mergeImportedLibraryBooks()` in `libraryService.ts`/`prepare-engine.mjs` | `book.hash` — avoids duplicate import |
| Tombstone merge | `mergeRemoteBookTombstones()` in `sync-execute.mjs` | `book.hash` — `indexByHash` Map |

### Metadata convergence

- Metadata merge is **entity-level by `updatedAt`** — NOT field-level.
- `mergeRemoteBookMetadata()` compares `localBookMaxMillis(localBook)` vs `localBookMaxMillis(remoteBook)`. The winner is the max of `{ updatedAt, deletedAt, importedAt, createdAt }`. If remote is newer, the entire remote book object replaces the local one (`{ ...localBook, ...remoteBook }`).
- Field-level HLC merge for books does not exist. This is the current behavior and satisfies Case 15 PASS criteria.
- `updatedAt` format: milliseconds epoch for stub entries, ISO 8601 for real imports. `normalizeBookTimestamp()` handles both.

### `assertCase15` implementation

Located at `apps/readest-app/scripts/assert-engine.mjs:305-335`. Verifies:
- Each side (desktop, android) has at most 1 occurrence per book hash
- Returns `{ verdict: 'PASS'|'FAIL', failures: [...] }` with per-hash duplicate counts

### Current behavior satisfies Case 15

No product code changes needed. The existing merge logic correctly:
1. Dedup same-hash books (all layers)
2. Converge metadata by newer `updatedAt`
3. Reject title-based merging (different hash = different book)
4. Handle tombstone + reimport ordering (newer timestamp beats older tombstone)

---

## 6. Persistence

- **Engram:** topic_key `sdd/case-15-same-book-from-both-devices/spec`, type `architecture`, capture_prompt: false
- **Filesystem:** `openspec/changes/case-15-same-book-from-both-devices/specs/case-15-same-book-from-both-devices/spec.md`

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-07-04 | Created Case 15 specification — 5 scenarios (15a-15e), evidence requirements, verdict criteria, harness protocol, book identity documentation | SDD Spec |
