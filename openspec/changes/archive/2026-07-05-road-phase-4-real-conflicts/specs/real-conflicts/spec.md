# Delta for Sync CRDT+HLC Real Device Harness — Phase 4: Real Conflicts

> **Phase:** 4 — Capa 4 (Conflictos Reales) — Conflictos reales
> **Cases:** 21–26
> **Source:** `casos_sync.md` §12.1–12.6, §13.3–13.4, §14.5–14.7, §15.6–15.7

## ADDED Requirements

### Purpose

Define **PASS/FAIL/WARN criteria** for sync cases 21–26, which test true concurrent conflict: same-field edit, edit-vs-delete resolution, concurrent creation dedup, annotation coexistence on same range, highlight type integrity, and highlight group pointer validation. This phase establishes:

- **Same-field edit resolution** by HLC LWW with deterministic nodeId tiebreak.
- **Edit-vs-delete resolution** by entity-level HLC comparison.
- **Concurrent creation dedup** across books, dictionary entries, quotes from same range, and quotes from different books.
- **Annotation coexistence** — two distinct annotations on the same range both survive.
- **Highlight type integrity** — mutation of semantic highlight group type MUST be rejected.
- **Highlight group pointer validation** — cross-type pointers between highlight and entity MUST be detected as invalid.

### §1 Execution Matrix

#### 1.1 Phase 4 Variant Strategy

Phase 4 uses a reduced variant set. O→M and M→O are redundant with Phase 2/3 and SHALL NOT be re-executed:

| Variant | Label | Description | Purpose |
|---------|-------|-------------|---------|
| Concurrent A/B | `O⇄M` | Both devices act BEFORE syncing. Then bidirectional sync. | Real concurrent conflict. Tests LWW by HLC, edit-vs-delete, dedup under race. |
| Isolated repetition | `R-n` | Each run in isolation — clean state, no state leakage. Repeat 5× per sub-case. | Proves determinism and >80% reliability threshold. |

#### 1.2 Evidence Requirements per Run

Each run MUST produce an evidence bundle with all Phase 3 §2.2 items plus:

| Evidence item | Required for | Without → max verdict |
|---------------|-------------|----------------------|
| Pre-sync snapshots (both devices) | All cases | WARN |
| Post-sync snapshots (both devices) | All cases | FAIL (unverifiable) |
| `_replicas` per-field HLC timestamps | Cases 21, 22 | WARN |
| `config.json` → `booknotes[]` | Cases 23, 24, 25, 26 | WARN |
| Sync trigger evidence (attempted/applied per kind) | All cases | WARN |
| Operation log with HLC timestamps | All cases | WARN |
| Full HLC tuple (physical, counter, nodeId) | Case 21d | WARN (if tiebreak not triggered) |

### §2 Case Specifications

#### 2.1 Case 21: Same-field Edit (Editar mismo campo)

**Source:** `casos_sync.md` §13.3, §13.4

These cases test LWW by HLC for the same editable field on the same semantic entity. The entity MUST remain a single logical row; the field value MUST converge to the newer HLC.

##### 2.1.1 R-P4.21.a — Both edit D.definition

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D` → `D(term="abismo", definition="deep hole")` |
| Android | Same `L`, same `H_D` → `D(term="abismo", definition="deep hole")`, converged |

**When**

Both edit `D.definition` concurrently before syncing (O⇄M). Desktop sets `"profound void"` (HLC=10). Android sets `"very deep chasm"` (HLC=11). Then bidirectional sync.

**Then**

| Field | Expected State |
|-------|----------------|
| Dictionary entry | EXACTLY ONE for `normalize("abismo")` across both devices |
| Definition | `"very deep chasm"` (HLC=11 wins). Same on both. |
| `imagePath` | Unchanged |
| Highlights | `H_D` preserved, range and color unchanged |
| Occurrences | All existing occurrences preserved |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | One dictionary entry. Definition converged to newer-HLC value. `_replicas` evidence proves field-level LWW. Highlight unchanged. |
| **FAIL** | Duplicate entries (dedup failure). OR definition reverted to stale value. OR data loss. OR highlight detached. |
| **WARN** | Definition converged but per-field HLC evidence missing. OR transient mismatch between devices. |

##### 2.1.2 R-P4.21.b — Both edit N.note

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_N` → `N(text="selected", note="original idea")` |
| Android | Same `L`, `H_N` → `N(text="selected", note="original idea")`, converged |

**When** — Desktop edits `N.note` to `"revised analysis"` (HLC=10). Android edits `N.note` to `"alternative interpretation"` (HLC=12). Both sync O⇄M.

**Then**

| Field | Expected State |
|-------|----------------|
| Annotation | EXACTLY ONE for `book_hash\|cfi\|text` key |
| `note` | `"alternative interpretation"` (HLC=12 wins). `text` immutable. |
| Highlight | `H_N` preserved, range and color unchanged |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | One annotation. `note` converged to newer-HLC value. `text` unchanged. Field-level HLC evidence. |
| **FAIL** | Two annotation rows (dedup failure). OR `note` stale. OR `text` overwritten. OR highlight lost. |
| **WARN** | `note` converged but field-level HLC evidence incomplete. |

##### 2.1.3 R-P4.21.c — Both edit L.title

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L(title="Original", hash=XYZ)` |
| Android | Same book `L(title="Original", hash=XYZ)`, converged |

**When** — Desktop edits `L.title` to `"Desktop Title"` (HLC=9). Android edits `L.title` to `"Android Title"` (HLC=14). Both sync O⇄M.

**Then**

| Field | Expected State |
|-------|----------------|
| Book count | EXACTLY ONE library entry for `hash=XYZ` |
| `title` | `"Android Title"` (HLC=14 wins). Same on both. |
| Other metadata | Unchanged. `hash`, `sourceTitle`, `format` immutable. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | One book. Title converged to newer-HLC value. No duplicate. Hash preserved. |
| **FAIL** | Two entries for same hash. OR title stale. OR hash changed. |
| **WARN** | Title converged but only book-level (not field-level) HLC available. |

##### 2.1.4 R-P4.21.d — Same field, same HLC time → nodeId tiebreak

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D` → `D(term="suerte", definition="chance")`, nodeId=`desktop-node` |
| Android | Same D, same H_D, nodeId=`android-node`, converged |

**When** — Desktop edits `D.definition` to `"fate"` at HLC=(1000, 1, desktop-node). Android edits `D.definition` to `"luck"` at HLC=(1000, 1, android-node). Both sync O⇄M.

**Then**

| Field | Expected State |
|-------|----------------|
| Definition | Converges to ONE value. Winner determined by deterministic nodeId comparison. |
| Tiebreak rule | HLC (physical, counter, nodeId) produces total order. Same physical+logical → nodeId decides. |
| Determinism | Repeated R-n execution MUST produce the SAME winner for the same nodeId pair. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | One definition on both devices. Winner is deterministic (same nodeId wins every R-n run). `_replicas` shows equal HLC timestamps with different nodeIds. |
| **FAIL** | Non-deterministic winner (changes between runs). OR devices stuck with different definitions. OR duplicate entry. |
| **WARN** | Tiebreak not triggered (times differed). OR nodeId evidence not recorded. |

**Edge:** Repeated R-n runs MUST produce the same winner. If the winner varies, that is a FAIL.

#### 2.2 Case 22: Edit vs Delete (Editar vs borrar)

**Source:** `casos_sync.md` §14.5, §14.7

These cases test HLC-based resolution when one device deletes an entity and the other edits it concurrently. The entity-level HLC timestamp determines winner.

##### 2.2.1 R-P4.22.a — A deletes D, B edits D.definition

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D` → `D(term="valle", definition="valley")` |
| Android | Same D, converged |

**When** — Desktop deletes D (tombstone HLC=12). Android edits definition to `"gorge"` (HLC=11). Both sync O⇄M.

**Then — delete HLC > edit HLC**

| Field | Expected State |
|-------|----------------|
| D entry | TOMBSTONED on both devices |
| Definition edit | LOST (lower HLC). NOT visible on either device. |
| Highlight | `H_D` soft-deleted or marked unresolved |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | D tombstoned on both. Edit value NOT visible. `_replicas` evidence proves tombstone HLC > edit HLC. |
| **FAIL** | Edit value visible (resurrection). OR D live on one device. OR duplicate. |
| **WARN** | D tombstoned but HLC ordering evidence incomplete. |

**Variant — edit HLC > delete HLC:** Desktop deletes (HLC=10). Android edits (HLC=14). Then D is LIVE with `definition="gorge"`. Tombstone ignored. Apply analogous criteria.

##### 2.2.2 R-P4.22.b — BLOCKED: A deletes C, B edits C

**Source:** `casos_sync.md` §14.6, §13.6

**Status: NOT APPLICABLE**

**Rationale:** Quotes are immutable per §13.6. The `Cite` type has no editable fields (no `note`, no mutable `text`). There is no valid edit operation for quotes. The harness MUST report `BLOCKED` and deduct this sub-case from the success denominator.

##### 2.2.3 R-P4.22.c — A deletes N, B edits N.note

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_N` → `N(text="selected", note="original")` |
| Android | Same N, converged |

**When** — Desktop deletes N (tombstone HLC=15). Android edits N.note to `"updated"` (HLC=14). Both sync O⇄M.

**Then — delete HLC > edit HLC**

| Field | Expected State |
|-------|----------------|
| N | TOMBSTONED on both. Edit value lost. |
| Highlight | `H_N` soft-deleted |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | N tombstoned. Edit NOT visible. HLC evidence proves ordering. |
| **FAIL** | Edit visible (resurrection). OR N still live. OR duplicate. |
| **WARN** | Tombstoned but HLC evidence incomplete. |

**Variant — edit HLC > delete HLC:** N LIVE with the new note. Tombstone ignored. Apply analogous criteria.

#### 2.3 Case 23: Concurrent Creations (Creaciones concurrentes)

**Source:** `casos_sync.md` §12.1–12.5

Extends Phase 3 concurrent creation to books and cross-book quotes. All use O⇄M + R-n.

##### 2.3.1 R-P4.23.a — Both create L with same ID

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Imports book `L(id=A1, hash=XYZ)` |
| Android | Imports same book `L(id=A1, hash=XYZ)` |

**When** — Both import same book WITH same ID before any sync (O⇄M).

**Then**

| Field | Expected State |
|-------|----------------|
| Book count | EXACTLY ONE entry for `hash=XYZ` |
| `id` | `A1` (same ID, no conflict). Full convergence. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | One book `hash=XYZ id=A1` on both devices. No duplicate. |
| **FAIL** | Two books with same hash+id. OR data loss. |
| **WARN** | One book but `_replicas` shows duplicate entries (resolved late). |

##### 2.3.2 R-P4.23.b — Both create L with same hash, different IDs

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Imports `L(id=A1, hash=XYZ)` |
| Android | Imports `L(id=B1, hash=XYZ)` |

**When** — Both import same EPUB with DIFFERENT IDs before sync (O⇄M).

**Then**

| Field | Expected State |
|-------|----------------|
| Book count | EXACTLY ONE visible entry for `hash=XYZ` |
| `id` | Merged by HLC. Both IDs in `_replicas`. |
| Metadata | Merged per field by HLC. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | One book entry on both. No duplicate. `_replicas` holds both IDs with dedup evidence. |
| **FAIL** | Two separate books for same hash. OR one device has duplicate. |
| **WARN** | One book but only one ID visible in initial metadata. |

##### 2.3.3 R-P4.23.c — Both create D same term (extends Case 16)

**Given** — Same as Case 16, O⇄M variant:

| Device | Initial State |
|--------|---------------|
| Desktop | Book L + `D1(term="zozobrar")` + `F_D1` + `H_D1` |
| Android | Book L + `D2(term="zozobrar")` + `F_D2` + `H_D2` |

**When** — Both create same normalized dictionary word before sync (O⇄M).

**Then** — Same as Case 16 outcome:
- ONE global entry for `normalize("zozobrar")`
- Both occurrences (F_D1, F_D2) preserved
- Both highlights (H_D1, H_D2) preserved
- Definition/imagePath merged by HLC

**Verdict Criteria** — Same as Case 16 PASS/FAIL/WARN.

##### 2.3.4 R-P4.23.d — Both create C same range+book (extends Case 17)

**Given** — Same as Case 17, O⇄M variant:

| Device | Initial State |
|--------|---------------|
| Desktop | Book L + `H_C1(range=100-120)` → `C1(text="...")` |
| Android | Book L + `H_C2(range=100-120)` → `C2(text="...")` |

**When** — Both create same quote on same book+range before sync (O⇄M).

**Then** — Same as Case 17 outcome:
- EXACTLY ONE quote. Dedup by `bookHash|cfi|contentHash`.
- One highlight H_C after convergence.

**Verdict Criteria** — Same as Case 17 PASS/FAIL/WARN.

##### 2.3.5 R-P4.23.e — Both create same text quote, different books

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book L1 + `H_C1(range=R1)` → `C1(text="same")` |
| Android | Book L2 + `H_C2(range=R2)` → `C2(text="same")` |

**When** — Both create quotes with same text but on DIFFERENT books, before sync (O⇄M).

**Then**

| Field | Expected State |
|-------|----------------|
| Quote count | TWO quotes (different `bookHash` → different identity) |
| Texts | Same text. Different source books. |
| Highlights | Two highlights: `H_C1→L1`, `H_C2→L2` |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Two quotes on both devices. Different `bookHash`. Both texts match input. |
| **FAIL** | Quotes deduped into one (wrong — different books). OR one quote lost. OR text differs. |
| **WARN** | Two quotes but `bookHash` evidence incomplete. OR transient count mismatch. |

#### 2.4 Case 24: Distinct Annotations Same Range

**Source:** `casos_sync.md` §12.6

**Policy:** Two annotations with different note values on the same CFI range MUST both survive. No silent data loss.

##### 2.4.1 R-P4.24 — N("Idea A") and N("Idea B") on same CFI range

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book L + `H_N1(range=100-120)` → `N1(text="selected", note="Idea A")` |
| Android | Book L + `H_N2(range=100-120)` → `N2(text="selected", note="Idea B")` |

**When** — Both create distinct annotations on the SAME CFI range before sync (O⇄M).

**Then**

| Field | Expected State |
|-------|----------------|
| Annotation count | TWO annotations. Both `N1` and `N2` survive. |
| Identity rule | Same `book_hash\|cfi\|text` → different annotation IDs = two separate entities. |
| Highlights | TWO highlights: `H_N1` and `H_N2`. Both in `config.json` booknotes[]. |
| Coexistence | **No merge, no delete.** Both annotations and both highlights persist. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Two annotations with distinct `note` values on both devices. Two highlights in `config.json`. No data loss. |
| **FAIL** | One annotation overwritten (silent loss). OR one highlight missing. OR notes merged. |
| **WARN** | Two annotations present but `config.json` missing for one highlight. OR transient count mismatch. |

#### 2.5 Case 25: Highlight Group Mutation

**Source:** `casos_sync.md` §15.6

**Policy:** The semantic type of a highlight MUST NOT be mutated. Correct workflow: delete old, create new.

##### 2.5.1 R-P4.25 — H_N mutated to H_C

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book L + `H_N(range=100-120)` → `N(note="original")` |
| Android | Book L + `H_C(range=100-120)` → `C(text="quote")` (mutated type) |

**When** — Sync executes (O⇄M). Android's highlight is typed `H_C` (cite) but the original was `H_N` (annotation).

**Then**

| Field | Expected State |
|-------|----------------|
| Highlight type | **DISCOVER phase.** System behavior is unknown — this case reveals it. |
| Expected correct | Merge layer MUST reject type mutation. `H_N` stays annotation. Either `H_C` coexists as separate highlight (C19 rule) or is rejected. |
| Invalid behavior (FAIL) | `H_N` type drifts to `H_C`. OR one highlight replaces the other (data loss). |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | System preserves type integrity. Either: (a) `H_N` remains annotation, `H_C` is separate; or (b) mutation rejected, `H_N` unchanged. Both devices agree. |
| **FAIL** | Type drift (`H_N`→`H_C`). OR data loss of one highlight. OR devices disagree on type. |
| **WARN** | Type preserved but `config.json` evidence incomplete. |

**Note:** MAY require product code fix if merge layer does not enforce type integrity.

#### 2.6 Case 26: Highlight Wrong Group Pointer

**Source:** `casos_sync.md` §15.7

**Policy:** A highlight MUST point to the correct entity type. `H_D`→dictionary entry, `H_C`→quote, `H_N`→annotation. Cross-type pointers are invalid.

##### 2.6.1 R-P4.26 — H_D pointing to C (quote entity)

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book L + `H_D(range=100-120)` → `D(term="error")` |
| Android | Same book L — `H_D` with `citeId=C` instead of `dictionaryEntryId=D` |

**When** — Sync executes (O⇄M). Android's highlight is typed `H_D` but points to a quote entity.

**Then**

| Field | Expected State |
|-------|----------------|
| Pointer validity | **DISCOVER phase.** System behavior is unknown. |
| Expected correct | Merge/receive layer MUST detect mismatch and either: reject, mark unresolved, or correct. |
| Invalid (FAIL) | Highlight accepted with mismatched pointer (type confusion). OR data corruption. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | System detects cross-type mismatch. Highlight rejected, marked unresolved, or pointer corrected. Both devices agree. No data corruption. |
| **FAIL** | Cross-type pointer accepted silently. OR data corruption. OR devices diverge on validity. |
| **WARN** | Mismatch detected but resolution strategy unverifiable. OR one device has invalid pointer while other rejected it. |

**Note:** MAY require product code fix if merge layer does not validate highlight-to-entity pointer types.

### §3 Edge Case Policy — Phase 4 Additions

#### 3.1 HLC Tiebreak Determinism

| Rule | Description |
|------|-------------|
| Same physical+logical time | When HLC physical time and counter match, `nodeId` produces deterministic total order. |
| Stable winner | The same nodeId pair MUST produce the same winner across repeated R-n runs. |
| Evidence | `_replicas` MUST record the full HLC tuple `(physical, counter, nodeId)` for field-level timestamps. |

#### 3.2 Edit-vs-Delete Entity-Level Resolution

| Rule | Description |
|------|-------------|
| HLC decides at entity level | The entity's `updatedAt` / `deletedAt` HLC determines winner. Newer HLC wins outright. |
| Edit beats older delete | Edit HLC > delete HLC → entity stays LIVE, tombstone ignored. |
| Delete beats older edit | Delete HLC > edit HLC → entity TOMBSTONED, edit lost. |
| No partial tombstone | Entity is either LIVE or TOMBSTONED. No "half-tombstoned with partial edit" state. |
| Immutable entities skip | Quotes have no editable fields. Case 22b NOT APPLICABLE. |

#### 3.3 Annotation Coexistence on Same Range

| Rule | Description |
|------|-------------|
| Same range, different notes | Both annotations survive. No merge, no delete. |
| Identity separation | Different annotation IDs = different entities even when `book_hash`, `cfi`, `text` match. |
| Highlight coexistence | Both annotations get their own highlight in `config.json`. |

#### 3.4 Highlight Type Integrity

| Rule | Description |
|------|-------------|
| Type mutation | Changing a highlight's semantic type is NOT a supported operation. |
| Correct workflow | Delete old highlight, create new with correct type. |
| Merge layer behavior | **DISCOVER** — existing code may or may not validate type/pointers. |
| Cross-type pointer | `H_D` with `citeId` instead of `dictionaryEntryId` is invalid. MUST be rejected or marked unresolved. |

### §4 Verification Evidence Matrix

#### 4.1 Evidence Minimums — Phase 4 Additions

| Claim | Minimum Evidence for PASS | Without → max verdict |
|-------|---------------------------|-----------------------|
| Field-level HLC (C21) | `_replicas` per-field HLC timestamps + post-sync state | WARN |
| Tiebreak nodeId (C21d) | `_replicas` full HLC tuple (physical, counter, nodeId) | WARN |
| Edit-vs-delete ordering (C22) | Tombstone/update HLC timestamps proving winner order | FAIL if wrong; WARN if missing |
| Annotation coexistence (C24) | Two distinct annotation rows + `config.json` two highlights | WARN |
| Highlight type integrity (C25) | `config.json` booknotes showing correct types | FAIL if drift; WARN if config missing |
| Cross-type pointer detection (C26) | Evidence system rejected or detected invalid pointer | FAIL if silent; WARN if unverifiable |

#### 4.2 Verdict Determinism Matrix

Identical to Phase 3 §5.2:

```
                     Evidence Complete          Evidence Partial        Evidence Missing
Converged           ───────── PASS ──────       ──────── WARN ─────       ────── WARN ─────
Diverged            ───────── FAIL ──────       ──────── FAIL ─────       ────── WARN ─────
Ambiguous counts    ───────── WARN ──────       ──────── WARN ─────       ────── WARN ─────
```

### §5 Case Coverage Summary

| Case | R-P4 ID | Sub-cases | Variants | DISCOVER needed? | Product fix expected? |
|------|---------|-----------|----------|------------------|----------------------|
| 21 — Same-field edit | 21.a–21.d | 4 | O⇄M, R-n | No | No |
| 22 — Edit vs delete | 22.a, 22.c | 2 active + 1 BLOCKED | O⇄M, R-n | No | No |
| 23 — Concurrent creations | 23.a–23.e | 5 | O⇄M, R-n | No | No |
| 24 — Annotations same range | 24 | 1 | O⇄M, R-n | No | No |
| 25 — Highlight group mutation | 25 | 1 | O⇄M | **Yes** | Possibly |
| 26 — Wrong group pointer | 26 | 1 | O⇄M | **Yes** | Possibly |
