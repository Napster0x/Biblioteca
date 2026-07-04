# Design: Case 15 — Same Book From Both Devices

## Technical Approach

Extend `dev-sync-cycle.mjs` with 5 case-refs (15a–15e). Each imports the same EPUB via `--case15 <hash> --import-book <path>` from different device combos, syncs, and asserts via `assertCase15` + new helpers. Zero product code — only harness assertions. Execution follows `ciclo_harness.md`: clean → create → sync → capture → compare → report → clean.

---

## Architecture Decisions

### Decision 1: Case-Ref Identifiers

| Ref | Variant | Fixture Setup | Sync | Assert |
|-----|---------|--------------|------|--------|
| **15a** | Desktop-first (O→M) | Desktop: `--case15 HASH --import-book <epub>` | POST trigger | `assertCase15(post)` |
| **15b** | Android-first (M→O) | Android: `--case15 HASH --import-book <epub>` | POST trigger | `assertCase15(post)` |
| **15c** | Concurrent import (O⇄M) | Desktop + Android import same hash (no sync between) | POST trigger | `assertCase15(post)` + `assertBookCount(1)` |
| **15d** | Metadata divergence | Phase 1: import desktop → sync. Phase 2: `--edit books:HASH:title=T1` (desktop) + `--target android-http --edit books:HASH:title=T2` (Android, later HLC) → sync | 2× POST trigger | `assertMetadata(HASH, title, T_newer)` both sides |
| **15e** | Same title, diff hash (negative) | Desktop: `--case15 AAA --import-book <epub1>`. Android: `--case15 BBB --import-book <epub2> --title "Same Title"`. No sync between. | POST trigger | `assertBookCount(2)` both sides, both hashes present |

All use `--hlc` for deterministic ordering on 15d. 15d uses pipeline mode.

### Decision 2: Reliability Target

`--repeat 5 --min-success-rate 0.8` per Phase 3 spec §5 (>80%). Domain classification: product (dup books) → FAIL; environment (USB flake) → retry; harness → fix.

### Decision 3: Assertion Suite

| Assertion | Exists? | Location | What it checks |
|-----------|---------|----------|----------------|
| `assertCase15({desktop, android})` | ✅ Yes | `assert-engine.mjs:305` | No duplicate hash per side |
| `assertBookCount(state, expected)` | ❌ New | `assert-engine.mjs` | `library.summary.count` + `bookIndex.facts` == expected |
| `assertMetadata(state, hash, field, val)` | ❌ New | `assert-engine.mjs` | Field value matches on both sides |
| `assertNoDuplicate(state, hash)` | ⚠️ Covered | Same as assertCase15 | — |

`computeCaseAcceptanceVerdict` gains handlers for 15a–15e in `dev-sync-cycle.mjs`.

### Decision 4: 15d — Concurrent Metadata

Two-phase via `--pipeline`:
- Phase 1: `{ prepare: { import: { file: epubPath } }, sync: true }` — baseline.
- Phase 2: `{ prepare: { edit: [...] }, sync: true }` — both edit titles offline, Android with +5s HLC.

**Entity-level `updatedAt` merge.** Books have no per-field HLC timestamps. Newer `updatedAt` wins the entire record. This is the current behavior and satisfies Case 15 PASS criteria.

### Decision 5: Book Identity Model (for evidence)

Document in verify-report:

```
Book identity model (Case 15):
- Semantic key: book.hash (EPUB content hash) — immutable.
- No `id` field on Book type. Identity = hash only.
- Metadata merge: entity-level updatedAt comparison. Newer wins all fields atomically.
- No field-level HLC merge for books (dictionary entries have this; books do not).
- Same hash → ONE book. Same title + different hash → DIFFERENT books, never merged.
- Tombstone + reimport: newer updatedAt beats older deletedAt.
```

Satisfies Phase 3 spec §3.1 PASS criteria.

### Decision 6: Execution Plan

Order: basics first, complexity last.

| Step | Scenarios | Repeats | Execs |
|------|-----------|---------|-------|
| 1 | 15a + 15b (basic one-way) | 5 each | 10 |
| 2 | 15c (concurrent import) | 5 | 5 |
| 3 | 15d (metadata divergence) | 5 | 5 |
| 4 | 15e (negative) | 5 | 5 |
| **Total** | 5 scenarios | — | **25** |

Run: `dev:sync:cycle --case-ref 15a,15b,15c,15d,15e --repeat 5 --min-success-rate 0.8 --clean-android`

---

## Data Flow

```
Desktop library.json (hash=XYZ) ◄──sync──► Android /books/index (hash=XYZ)
        assertCase15: no dup             assertCase15: no dup
        assertBookCount(1)               assertBookCount(1)
```

15d: `updatedAt` decides metadata winner. 15e: AAA + BBB coexist as separate books.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `scripts/assert-engine.mjs` | Modify | Add `assertBookCount`, `assertMetadata` |
| `scripts/dev-sync-cycle.mjs` | Modify | Add `computeCaseAcceptanceVerdict` for 15a–15e; pipeline support for 15d |
| `scripts/dev-sync-fixture.mjs` | None | Already supports `--case15 --import-book --edit` |
| `openspec/changes/.../design.md` | Create | This document |

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | New assertions (`assertBookCount`, `assertMetadata`) | Add test cases in `dev-sync-cycle.test.mjs` |
| E2E | All 5 variants × 5 repeats | `dev:sync:cycle` with flags above |

## Open Questions

None. Exploration confirmed basic dedup works. All decisions above.
