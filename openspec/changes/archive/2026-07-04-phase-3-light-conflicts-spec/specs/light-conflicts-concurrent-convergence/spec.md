# Delta Spec: Light Conflicts — Concurrent Convergence

> **Extends:** `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md`
> **Phase:** 3 — Capa 3 (Ocasional) — Conflictos ligeros y convergencia concurrente
> **Cases:** 15–20
> **Status:** Draft
> **Type:** Delta spec (documentation-only)

---

## Dependency Notice

This delta spec depends on and inherits all requirements, scenarios, and invariants from the base spec at `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md`. All pre-existing requirements (Caso 1–14 behaviors, preflight gating, clean/reinitialize, doctor diagnostics, evidence model, reporting verdicts) apply. This delta only adds Phase 3 semantics.

---

## Purpose

Define the **PASS/FAIL/WARN criteria** for sync cases 15–20 (light conflicts, concurrent convergence) from `casos_sync.md` §🥉. These are cases where both devices create, edit, or range-touch the same logical entity before synchronizing. The spec establishes:

- **Identity rules** per entity kind — what makes two records "the same."
- **Normalization policies** for comparison keys.
- **Execution matrix** — each case runs with 4 symmetry/concurrency variants.
- **Case-level criteria** with formal Given/When/Then and verdict thresholds.
- **Edge case policies** for tombstones, group coexistence, and field-level merge.
- **Evidence minimums** — what proof converts a verdict to PASS vs WARN vs FAIL.

---

## 1. Identity Rules

### 1.1 Book Identity

| Aspect | Rule |
|--------|------|
| **Semantic key** | `book.hash` (content hash of the EPUB/PDF file) |
| Same `hash` + same `id` | Same logical book. No duplicate. MUST converge to one entry. |
| Same `hash` + different `id` | Same logical book with different instance IDs. Policy: **merge metadata by HLC**; deduplicate into one visible library entry. Both `id` values are accepted metadata; the winning record is the one with the newer HLC timestamps per field. |
| Same `title` + different `hash` | DIFFERENT books. MUST NOT merge. Both survive as separate library entries. |
| Same `hash` + tombstone + reimport | A newer `updatedAt` (reimport) MUST resurrect the book. An older tombstone MUST NOT block the reimport. Ref: base spec §Book tombstone reimport ordering, casos_sync.md §8.5–8.6, §29.1 T005–T020. |
| **Immutable fields** | `hash`, `sourceTitle`, `format` |
| **Editable by HLC** | `title`, `author`, `coverImageUrl`, `group`/`groupId`, `readingStatus`, `progress`, all `metadata.*` fields (`subtitle`, `series`, `seriesIndex`, `seriesTotal`, `isbn`, `publisher`, `published`, `language`, `description`) |
| **Evidence required** | Desktop `library.json` per-device + Android `/books/index` manifest + `_replicas` HLC timestamps |

### 1.2 Dictionary Entry Identity & Normalization

| Aspect | Rule |
|--------|------|
| **Semantic key** | `normalize(term) | normalize(language)` |
| Normalization function | `NFC(str).toLowerCase().replace(/\u00ad/g, '')` — Unicode NFC composition (canonical), then lowercase, then strip soft-hyphen U+00AD. Matches `normalizeTerm()` in `sync-filter-standalone.mjs` line 24-27. The guard clause in `computeSemanticKey` trims the input before calling `normalizeTerm`, but `normalizeTerm` itself does NOT trim. |
| **Accent policy** | **NFC composition.** `"solo"` (NFc= s o l o) and `"sólo"` (NFC= s ó l o) are DIFFERENT normalized keys. They are separate logical entries. Accents matter for identity. |
| **Soft-hyphen policy** | U+00AD (soft hyphen) is stripped by `normalizeTerm` via `.replace(/\u00ad/g, '')`. `"ab\u00adismo"` and `"abismo"` resolve to the same key. |
| **Case policy** | Case-insensitive. `"Zozobrar"` and `"zozobrar"` resolve to `"zozobrar"`. |
| Same normalized key | Same logical entry. One global dictionary entry. |
| Mergeable fields (HLC wins) | `definition`, `imagePath` — field-level merge by HLC timestamp |
| **Immutable fields** | `term` (identity), `displayTerm` (set = term at creation), `language`, `enrichmentStatus` |
| **Dictionary occurrences** (`F_D`) | Multiple occurrences per entry are PRESERVED. Each occurrence is an immutable event (`selectedText`, `cfi`, `contextBefore`, `contextAfter`). Occurrences from different books or different CFI ranges are separate records. |
| **Image coexistence** | If both devices set different `imagePath` for the same entry, the image with the newer HLC wins. The losing image is NOT deleted from filesystem but is no longer the active entry image. |
| **Evidence required** | Desktop `Readest/dictionary.db` → `dictionary_entries` + `dictionary_occurrences` rows + `_replicas` HLC + Android replica state |

### 1.3 Quote Identity & Dedup

| Aspect | Rule |
|--------|------|
| **Semantic key** | `bookHash | cfi | contentHash` |
| Same `bookHash` + same `cfi/range` | Same logical quote. After sync: ONE quote. No duplicates. |
| Same `text` + different `bookHash` | **DIFFERENT quotes** (different source book). Both survive. |
| Same `bookHash` + different `cfi/range` + same `text` | Different quotes (different location). Both survive. |
| `contentHash` role | PART OF THE IDENTITY KEY. `computeSemanticKey()` for quotes uses `bookHash | cfi | contentHash` (line 56 of `sync-filter-standalone.mjs`). If `contentHash` differs, the semantic keys differ and the quotes are treated as different for dedup purposes. `contentHash` is generated by the creating client (MD5 of text in `dev-sync-fixture.mjs`); the algorithm is a client implementation detail — the sync layer treats it as an opaque string. |
| **Quotes are immutable** | No editable fields. `quote.text`, `contextBefore`, `contextAfter`, `contentHash` are all read-only once created. |
| **Evidence required** | Desktop `Readest/citas.db` → `quotes` table + `_replicas` HLC + Android replica state |

### 1.4 Annotation Identity

| Aspect | Rule |
|--------|------|
| **Semantic key** | `book_hash | cfi | text` (immutable selected text) |
| Same `text` + same `book_hash` + same `cfi` | Same logical annotation. Policy: **deduplicate to one annotation row**. The surviving `note` is determined by HLC (newer wins). |
| Same `text` + different `book_hash` | Different annotations (different books). Both survive. |
| Same `book_hash` + different `cfi` + same `text` | Different annotations. Both survive. |
| **Immutable fields** | `text` (selected text), `color`, `style` |
| **Editable by HLC** | `note` (the user's note/comment) — field-level HLC merge |
| **Evidence required** | Desktop `Readest/annotations.db` → `annotations` table + `_replicas` HLC + Android replica state |

### 1.5 Range / Highlight Identity

| Aspect | Rule |
|--------|------|
| **Highlight storage** | NOT a SQL entity. Highlights are `BookNote` objects inside `Books/<hash>/config.json → booknotes[]`. |
| **Highlight identity** | `bookHash | cfi/range | type | {dictionaryEntryId | citeId | annotationId}` |
| **Range equality** | Same CFI range start + end → equal ranges. |
| **Range containment** | Range A wholly contained in range B → different identities. Both coexist. |
| **Range overlap** | Ranges that partially overlap → different identities. Both coexist. **No destructive collapse.** |
| **Group coexistence** | Same range + different semantic types (`dictionaryEntryId` vs `citeId` vs `annotationId`) → MUST coexist. |
| **Same range + same type + different entity IDs** | Two distinct highlights. Both coexist if they point to different semantic entities. |
| **Highlight immutability** | **BookNotes are never edited** — only created and soft-deleted. Color, range, type, and semantic link are set at creation and immutable thereafter. |
| **Colors (verified)** | Dictionary: caller-defined. Quote: `#fca5a5` (red). Annotation: `yellow`. |
| **Evidence required** | `Books/<hash>/config.json → booknotes[]` entries with `deletedAt`, HLC timestamps, and linked entity IDs. Without `config.json` evidence for range/group claims → max verdict `WARN`. |

---

## 2. Execution Matrix

### 2.1 Symmetry Variants

Every case (15–20) MUST be executed with exactly 4 variants:

| Variant | Label | Description | Purpose |
|---------|-------|-------------|---------|
| Desktop-first | `O→M` | Desktop creates/edits first. Android syncs and converges. | Control baseline from desktop. Establishes "desktop-origin" behavior. |
| Android-first | `M→O` | Android creates/edits first. Desktop syncs and converges. | Proves symmetry. No mirror phase needed. Same semantics work in both directions. |
| Concurrent A/B | `O⇄M` | Both devices create/edit BEFORE syncing. Then bidirectional sync. | Real concurrent conflict. Tests dedup, HLC ordering, field-level merge. |
| Isolated repetition | `R-n` | Each run in isolation — clean state, no state leakage from other cases. | Prevents false PASS from residual state. Each repetition starts from zero. |

### 2.2 Evidence Requirements per Run

Each run MUST produce a bundle containing:

| Evidence item | Required for | Without → max verdict |
|---------------|-------------|----------------------|
| Pre-sync snapshots (desktop + Android) | All cases | WARN |
| Post-sync snapshots (desktop + Android) | All cases | FAIL (missing = unverifiable) |
| `_replicas` / HLC evidence | All cases | WARN |
| `config.json` → `booknotes[]` | Cases 18, 19, 20 (range/group claims) | WARN |
| Sync trigger evidence (attempted/applied counts per kind) | All cases | WARN |
| Clean verification before case starts | All cases | WARN (residual state risk) |
| Operation log (what was created/edited/deleted and when) | All cases | WARN |

**Rule:** A case cannot achieve `PASS` without both `_replicas`/HLC evidence AND the `config.json` booknotes evidence when range/group claims are needed. Without these, max verdict is `WARN`.

---

## 3. Case Specifications

### 3.1 Case 15: Same Book from Both Devices

**Source:** `casos_sync.md` §8.4–8.6, §12.1–12.2, §29.3 T041

#### Given

| Device | Initial State |
|--------|---------------|
| Desktop | Book file imported with `hash=XYZ`, `id` may be A1 or same as Android |
| Android | Same EPUB/PDF file imported with `hash=XYZ`, `id` may be B1 or same as desktop |

#### When

- **Desktop-first variant:** Desktop imports → sync O→M → Android converges
- **Android-first variant:** Android imports → sync M→O → Desktop converges
- **Concurrent variant:** Both import offline simultaneously → sync O⇄M → both converge
- **Isolated variant:** Repeat any of the above starting from clean state

#### Then

| Field | Expected State |
|-------|----------------|
| Book count | Exactly ONE visible library entry across both devices |
| Metadata | Merged by HLC (newer timestamps win per field) |
| `id` conflict | If same `hash` + different `id`: deduplicate to one book. The winning `id` is the one with the newest HLC/metadata. Both original records are preserved in `_replicas`. |
| Tombstone interaction | If a tombstone exists on one side and the reimport is newer: book is LIVE on both. Ref: base spec §Book tombstone reimport ordering. |

#### Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Exactly 1 book with hash=XYZ on both devices. Metadata converged. No duplicate library entry. `_replicas` evidence shows dedup applied. |
| **FAIL** | Two separate books with hash=XYZ on either device (duplicate). OR data loss of book metadata. OR tombstone blocks a newer reimport. |
| **WARN** | Metadata convergence cannot be verified (missing field-level timestamps). OR only one device has the deduped book. OR `_replicas` evidence incomplete. |

---

### 3.2 Case 16: Same Word from Both Devices

**Source:** `casos_sync.md` §16.4, §12.3, §22.4

> **PRE-VERIFIED** — Real device (Nothing Phone A065). Verified in `fix-semantic-dedup-sync`.

#### Given

| Device | Initial State |
|--------|---------------|
| Desktop | Book L1 + `H_D1` → `D1(term="zozobrar")` + `F_D1` |
| Android | Book L2 + `H_D2` → `D2(term="zozobrar")` + `F_D2` |

#### When

- Both devices create the same normalized dictionary term before syncing
- Desktop-first / Android-first / Concurrent / Isolated variants apply

#### Then

| Field | Expected State |
|-------|----------------|
| Dictionary entries count | EXACTLY ONE global entry for `normalize("zozobrar")` across both devices |
| Definition | The definition with the newer HLC wins. If both set definitions, field-level HLC determines survivor. |
| `imagePath` | HLC-wins per field. Different from definition — each field resolved independently. |
| Occurrences | Both `F_D1` and `F_D2` PRESERVED. The entry has 2 occurrences. |
| Highlights | Both `H_D1` and `H_D2` preserved. Two separate highlights pointing to the same global entry. |

#### Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Exactly 1 dictionary entry for `"zozobrar"` on both devices. Both occurrences (`F_D1`, `F_D2`) present. Definition and imagePath resolved by HLC. Highlights `H_D1` and `H_D2` survive. |
| **FAIL** | Two separate dictionary entries for the same word (dedup failure). OR data loss of one occurrence. OR one device loses a highlight. OR definition/image disappears. |
| **WARN** | Occurrence count differs between devices (transient sync). OR definition merge cannot be verified (missing field-level HLC). OR `config.json` missing for highlight claims. |

**Pre-verified evidence path:** `fix-semantic-dedup-sync` — real device log with replica `sent=1` for dictionary-entry and `applied=1` on Android. Both occurrences confirmed present.

---

### 3.3 Case 17: Same Quote / Same Range from Both Devices

**Source:** `casos_sync.md` §17.1, §12.4, §22.3

> **PRE-VERIFIED** — Real device (Nothing Phone A065). Verified in `fix-semantic-dedup-sync`.

#### Given

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_C1(range=100-120)` → `C1(text="...")` |
| Android | Book `L` + `H_C2(range=100-120)` → `C2(text="...")` |

#### When

- Both devices create a quote on the same book at the same CFI range before syncing
- Desktop-first / Android-first / Concurrent / Isolated variants apply

#### Then

| Field | Expected State |
|-------|----------------|
| Quote count | EXACTLY ONE logical quote on both devices |
| `contentHash` evidence | Both quotes have the same `contentHash` (or compatible for the same text) |
| Highlight count | One highlight `H_C` survives (not two). If both appear, they are the same BookNote resolved to the same `citeId`. |
| Dedup mechanism | `bookHash | cfi | contentType(contentHash)` key eliminates the duplicate |

#### Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Exactly 1 quote + 1 highlight on both devices. Same `bookHash`, same `cfi`, same `text`. No duplicate quote rows. |
| **FAIL** | Two quote rows for the same book+range+text (duplicate). OR one device shows two highlights for the same quote. OR text content diverges. |
| **WARN** | Quote count matches but highlight count differs. OR `_replicas` evidence shows two quote entries with same semantic key (dedup applied late or on one side only). |

**Pre-verified evidence path:** `fix-semantic-dedup-sync` — real device log confirming `sent=1` quote, `applied=1` on Android, single quote row in `citas.db`.

---

### 3.4 Case 18: Edit Semantic Datum with Fixed Highlight

**Source:** `casos_sync.md` §13.5–13.7, §29.4 T063

#### Given

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D(range=100-120)` → `D(term="abismo", definition="deep hole")` |
| Android | Same book `L` + same `H_D` → `D(term="abismo", definition="deep hole")` (synced, converged) |

#### When

1. Desktop edits `D.definition` from `"deep hole"` to `"profound void"` (editable field)
2. Desktop syncs to Android
3. Android receives the updated definition

**Variants:**
- **Desktop-first:** Desktop edits, sync O→M, Android converges
- **Android-first:** Android edits, sync M→O, Desktop converges
- **Concurrent:** Both edit definition on the same datum before syncing → HLC wins
- **Isolated:** Repeat from clean state

#### Then

| Field | Expected State |
|-------|----------------|
| Definition | Updated to newer HLC value. On both devices. |
| Highlight `H_D` range | **UNCHANGED.** `range=100-120` remains identical. The highlight is a visual marker, not affected by datum edits. |
| Highlight color | **UNCHANGED.** Color was set at creation. |
| Highlight BookNote | `BookNote` in `config.json` must show the same CFI range before and after. |
| Datum identity | Same `term`, same `id`, same `language`. Only `definition` changed. |

#### Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Definition updated on both devices to the newer HLC value. Highlight range in `config.json` is identical to pre-edit snapshot. Highlight color unchanged. No duplicate entries. |
| **FAIL** | Highlight range changed (drifted). OR highlight color changed. OR definition update lost. OR datum duplicated. OR BookNote detached from the datum. |
| **WARN** | Definition converged but `config.json` snapshot missing (cannot verify highlight stability). OR definition updated but highlight `dictionaryEntryId` reference lost and re-created. |

---

### 3.5 Case 19: Same Range, Different Groups

**Source:** `casos_sync.md` §15.3, §19.1–§19.3

#### Given

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D(range=100-110)` → `D(term="abismo")` |
| Android | Book `L` + `H_C(range=100-110)` → `C(text="...")` |

#### When

- Desktop creates a dictionary highlight at range 100-110
- Android creates a quote highlight at the SAME range 100-110
- Both sync

**Variants:**
- **Desktop-first:** Dictionary created first, sync, then quote created, sync
- **Android-first:** Quote created first, sync, then dictionary, sync
- **Concurrent:** Both created offline before any sync
- **Isolated:** Repeat from clean state

#### Then

| Field | Expected State |
|-------|----------------|
| Dictionary entry | Present on both devices. One entry for `"abismo"`. |
| Quote | Present on both devices. One quote with the text. |
| Highlights | **TWO** distinct highlights on the SAME range: one `H_D` (dictionary, caller-defined color) and one `H_C` (quote, `#fca5a5` red). |
| `config.json` evidence | `booknotes[]` MUST contain BOTH entries with distinct `dictionaryEntryId` and `citeId` respectively. Both must have `deletedAt: null`. |

#### Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Both devices have: (a) dictionary entry, (b) quote, (c) two separate highlights for the same range pointing to different semantic entities. `config.json` proves both BookNotes coexist without deletion. |
| **FAIL** | One highlight collapsed/deleted due to range conflict. OR one semantic datum (D or C) missing. OR both highlights merged into one. OR data loss. |
| **WARN** | Highlights present but `config.json` evidence missing or incomplete. OR highlight count differs between devices (one device still converging). |

---

### 3.6 Case 20: Overlapping Ranges

**Source:** `casos_sync.md` §15.4

#### Given

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_C(range=100-150)` → `C(text="...")` |
| Android | Book `L` + `H_N(range=120-180)` → `N(note="...")` |

#### When

- Desktop creates a quote highlight spanning CFI 100-150
- Android creates an annotation highlight spanning CFI 120-180 (partial overlap: 120-150 is shared territory)
- Both sync

**Variants:**
- **Desktop-first:** Quote created first, sync, then annotation, sync
- **Android-first:** Annotation created first, sync, then quote, sync
- **Concurrent:** Both created offline before any sync
- **Isolated:** Repeat from clean state

#### Then

| Field | Expected State |
|-------|----------------|
| Quote | Present on both devices with `range=100-150`. Immutable. |
| Annotation | Present on both devices with `range=120-180`. `note` editable by HLC. |
| Highlights | **TWO** distinct highlights with DIFFERENT ranges. `H_C(range=100-150)` and `H_N(range=120-180)` coexist. |
| `config.json` evidence | `booknotes[]` MUST contain both BookNotes with their respective ranges. Neither highlights is deleted or range-modified due to the overlap. |
| Coexistence rule | **Partial overlap → both survive. No destructive collapse.** The ranges are independent geometric identities. |

#### Verdict Criteria

| Verdict | Condition |
|---------|-----------|
| **PASS** | Both devices have: (a) quote with range 100-150, (b) annotation with range 120-180, (c) both ranges in `config.json` booknotes. Neither range was modified or collapsed. Both semantic data present. |
| **FAIL** | One range was destructively collapsed into the other. OR one datum/quote missing. OR only one highlight survives. OR ranges were merged into a super-range that loses fidelity. |
| **WARN** | Ranges preserved but `config.json` evidence missing. OR one device still converging (transient). |

---

## 4. Edge Case Policy

### 4.1 Tombstones and Reimport after Delete (for Case 15)

| Rule | Description |
|------|-------------|
| Tombstone identity | A tombstone is a book deletion marker tied to a specific `hash` + generation. |
| Same-hash reimport | A reimport of the same EPUB/PDF (`hash=XYZ`) with `updatedAt > deletedAt` MUST resurrect the book. |
| Multiple tombstones | Two tombstones (one from each device) for the same hash do NOT compound. A single newer reimport beats all older tombstones. |
| Stale tombstone after reimport | An older tombstone arriving AFTER a newer reimport (out-of-order delivery) MUST NOT hide the reimport. HLC ordering: the reimport wins per base spec §Book tombstone reimport ordering. |
| **Evidence requirement** | For PASS verdict, the report MUST prove `updatedAt > deletedAt` for the winning reimport. Without HLC timestamps: max WARN. |

### 4.2 Group Coexistence Rules (for Cases 19, 20)

| Rule | Description |
|------|-------------|
| Same-range coexistence | Two highlights with the same CFI range but different `{dictionaryEntryId | citeId | annotationId}` MUST coexist. |
| Different-type coexistence | Dictionary + Quote + Annotation on the same range → THREE highlights. All coexist. |
| Same-type different entity | Two dictionary entries on the same range (e.g., two different words) → TWO highlights. Both coexist. |
| Overlap coexistence | Ranges that partially overlap → both survive as independent geometric identities. |
| **Never collapse** | The system MUST NOT collapse two highlights into one, merge ranges, or delete one highlight to "resolve" an overlap. Ranges are immutable after creation. |
| **Evidence floor** | Without `config.json` booknotes proving coexistence → max WARN. Counts from replica alone are insufficient for range/group coexistence claims. |

### 4.3 Field-level Merge vs Entity-level Merge

| Aspect | Rule |
|--------|------|
| Entity-level identity | Dedup by semantic key (identity rules above) happens at entity level: ONE logical row per key. |
| Field-level merge | Editable fields are merged INDEPENDENTLY by HLC. `definition` and `imagePath` on a dictionary entry have separate HLC timestamps and are resolved separately. |
| Immutable fields never merge | `term`, `language`, `text`, `cfi`, `selectedText`, `hash` — these are never overwritten. On dedup, the first-created value stands (or the one with the highest HLC if timestamps exist, but semantically they should be identical). |
| Mixed edit + create concurrent | If A creates a datum with `definition=A` and B creates the same datum (same key) with `definition=B`, field-level HLC determines which definition survives. The entity itself is deduplicated to one. |
| Edit + concurrent delete | Ref: base spec §Book tombstone reimport ordering for book tombstones. For dictionary/quote/annotation tombstones: newer edit beats older delete. Newer delete beats older edit. Rule: **HLC timestamp decides at entity level** for delete vs edit conflicts. |

---

## 5. Verification Evidence Requirements

### 5.1 Evidence Minimums per Verdict

| Claim | Minimum Evidence for PASS | Without → max verdict |
|-------|---------------------------|-----------------------|
| Entity convergence | `_replicas` HLC timestamps + post-sync state on both devices | WARN |
| No duplicates | Row counts match expectations + replica dedup evidence | FAIL if duplicates visible; WARN if unreproducible |
| Range/group coexistence | `config.json` → `booknotes[]` with all expected entries + ranges | WARN |
| Field-level merge | Per-field HLC timestamps in `_replicas` | WARN |
| Highlight stability (C18) | Pre/post `config.json` snapshots showing identical range + type + color | WARN |
| Tombstone defeat (C15) | HLC timestamps proving `updatedAt > deletedAt` for the winning reimport | WARN |
| Desired book count | `library.json` / `/books/index` manifest count per device | FAIL if wrong; WARN if one device not verified |

### 5.2 Verdict Determinism Matrix

```
                    Evidence Complete          Evidence Partial        Evidence Missing
Converged           ───────── PASS ──────       ──────── WARN ─────       ────── WARN ─────
Diverged            ───────── FAIL ──────       ──────── FAIL ─────       ────── WARN ─────
Ambiguous counts    ───────── WARN ──────       ──────── WARN ─────       ────── WARN ─────
```

### 5.3 Pre-verified Cases: Evidence Path Reference

**Cases 16 and 17** were pre-verified on real device (Nothing Phone A065) under `fix-semantic-dedup-sync`. Evidence saved at:

- Case 16: Engram observation logs from `2026-07-04-fix-semantic-dedup-slice2` session. Desktop `dictionary.db` shows 1 entry, 2 occurrences. Android replica state confirms `dictionary-entry sent=1, applied=1`.
- Case 17: Engram observation logs from same session. Desktop `citas.db` shows 1 quote. Android replica state confirms `quote sent=1, applied=1`.

These cases do NOT need re-execution but their PASS criteria are formally defined here for the first time. The existing evidence satisfies the criteria defined in §3.2 and §3.3.

### 5.4 Reporting Template

Each case execution MUST produce a structured report:

```markdown
## Case {N}: {Name} — {Variant}

### Devices
- Desktop: {snapshot path}
- Android: {snapshot path}

### Operations
- Desktop: {what was created/edited/deleted}
- Android: {what was created/edited/deleted}

### Sync Order
{desktop-first | android-first | concurrent | isolated-N}

### Evidence
- `_replicas` HLC: {path}
- `config.json` booknotes: {path}
- Pre-snapshots: {path}
- Post-snapshots: {path}

### Verdict
{PASS | FAIL | WARN}

### Diagnosis (if not PASS)
{reasoning}

### Evidence Gaps (if any)
{what was missing}
```

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-07-04 | Initial delta spec for Phase 3 light conflicts. Cases 15–20. Identity rules, execution matrix, PASS/FAIL/WARN criteria, edge policy, evidence requirements. | SDD Spec |
