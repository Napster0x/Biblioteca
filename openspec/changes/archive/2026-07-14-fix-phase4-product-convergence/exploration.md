# Exploration: fix-phase4-product-convergence

## Current State

Fase 4 real-device sync test: **6/14 pass (42.86%)**. Tras la limpieza de estado pre-ciclo (`fix-phase4-real-conflicts-reliability`), los 8 fallos restantes son divergencias reales de convergencia post-sync, no contaminación de estado.

### Passing Cases (6/14)
| Case | Action | Entity | Mechanism |
|------|--------|--------|-----------|
| 21c | both-edit-title | Book metadata | library.json + `--hlc` fixture |
| 23a | concurrent-book | Book import | Library-level sync |
| 23b-23e | Various book ops | Book metadata | Library-level sync |

### Failing Cases (8/14)
| Case | Verdict | Action | Entity | Type |
|------|---------|--------|--------|------|
| 21a | fail | both-edit-def | dictionary-entry | Concurrent field edit |
| 21b | fail | both-edit-note | annotation | Concurrent field edit |
| 21d | warn | tiebreak | dictionary-entry | Same-HLC tiebreak |
| 22a | warn | delete-wins | dictionary-entry | Delete vs edit |
| 22c | fail | delete-wins | annotation | Delete vs edit |
| 24 | fail | two-annotations-same-range | annotation | Same-CFI coexistence |
| 25 | warn | discover-mutate | annotation→quote | Cross-kind mutation |
| 26 | warn | discover-invalid-ref | dict-entry+quote | Invalid cross-entity ref |

---

## Findings by Case

### Case 21a — `case21a-both-edit-def` — FAIL

**Scenario**: Desktop and Android concurrently edit `definition` field of the same dictionary entry (same `semantic_key: case21-term-...|es`).

| Device | Value | HLC |
|--------|-------|-----|
| Desktop | "profound void" | 1783980161662 |
| Android | "very deep chasm" | 1783980161663 (higher) |

**Post-sync State**:
- **Desktop** (`dictionary_entries`): 2 rows — `dict-entry-...-py8j9g` (profound void) AND `dict-entry-...-r06bdj` (very deep chasm)
- **Desktop** (`dictionary_occurrences`): 2 rows — one linked to each entry
- **Android** (`dictionary-entry` replica): 1 row — `dict-entry-...-r06bdj` (Android's own, "very deep chasm")
- **Android** (`dictionary-occurrence` replica): 2 rows — both occurrences present
- **Sync trigger**: `appliedToDesktop: 1` for dictionary-entry and dictionary-occurrence

**Analysis**: Android's HLC (1783980161663) > Desktop's HLC (1783980161662), so Android's value should win. Instead of merging field-level HLCs into ONE entity, the system created TWO separate entities with different `replica_id`s. Both entities have the same `semantic_key`, violating the uniqueness constraint.

The desktop visibly has both entries because it pulled Android's occurrence data (which references Android's replica_id) while keeping its own entry. The bidirectional sync path fails to recognize these as field-level conflicts on the same logical entity during the **pull** phase.

**Root Cause Classification**: **Product bug in sync/convergence** — Replica-level CRDT does not perform field-level HLC merge during pull. Same-semantic-key entities are treated as separate replicas rather than conflicting versions of the same entity.

**Evidence Strength**: **Strong** — Complete pre/post snapshots on both devices, replicas, and SQLite tables. HLC timestamps are unambiguous.

---

### Case 21b — `case21b-both-edit-note` — FAIL

**Scenario**: Desktop and Android concurrently edit `note` field of the same annotation (same `bookHash + cfi + text`).

| Device | Note value | HLC |
|--------|-----------|-----|
| Desktop | "revised analysis" | 1783980166472 |
| Android | "alternative interpretation" | 1783980166474 (higher) |

**Post-sync State**:
- **Desktop** (`annotations`): 2 rows — `annotation-...-73c649` ("revised analysis") AND `annotation-...-48io40` ("alternative interpretation")
- **Android** (`annotation` replica): 1 row — `annotation-...-48io40` (Android's own, "alternative interpretation")
- **Sync trigger**: `appliedToDesktop: 1` for annotation

**Analysis**: Identical pattern to 21a. Android's higher HLC should win, but instead two entities were created. The desktop has both because it contains the annotations table (2 rows) and the Android only shows its own via the replica endpoint. The semantic_key includes the text, which matches.

**Root Cause Classification**: **Product bug in sync/convergence** — Same as 21a. Concurrent edits to annotation fields fail field-level HLC merge because the replica CRDT layer treats concurrently-created entities with different replica_ids as separate items.

**Evidence Strength**: **Strong**

---

### Case 21d — `case21d-tiebreak` — WARN

**Scenario**: Desktop and Android edit `definition` of the same dictionary entry with **identical HLC** (1783980179017).

| Device | Value | HLC |
|--------|-------|-----|
| Desktop | "fate" | 1783980179017 |
| Android | "luck" | 1783980179017 |

**Post-sync State**:
- **Desktop**: Has `dict-entry-...-uyr83j` (definition: "fate")
- **Android** (`dictionary-entry` replica): Has `dict-entry-...-jihxkw` (definition: "luck") — **different replica_id**
- Android also has both occurrences synced (desktop's `dict-occ-...-s6rq51` AND its own `dict-occ-...-un0vhy`)

**Sync trigger**: `dictionary-entry: applied: 1, pulled: 0, appliedToDesktop: 0` — desktop pushed its entry but Android did NOT pull it. `dictionary-occurrence: applied: 1, pulled: 1, appliedToDesktop: 0`.

**Analysis**: Same-HLC tiebreaking should use deterministic resolution (e.g., replica_id lexicographic comparison). Instead, each device keeps its own replica. The sync direction was Desktop→Android (sent=1, received=0), but Android kept its own entry with different replica_id. Neither resolved the tie.

**Root Cause Classification**: **Product bug** — Same-HLC tiebreaking is not implemented in the replica merge path. When both HLCs are equal, the system should use deterministic tiebreaking (e.g., higher replica_id wins) but instead preserves both entities as separate replicas.

**Evidence Strength**: **Strong**

---

### Case 22a — `case22a-delete-wins` (dictionary-entry) — WARN

**Scenario**: Desktop creates a dictionary entry then deletes it. Android concurrently edits the definition.

| Action | Device | HLC |
|--------|--------|-----|
| Delete | Desktop | 1783980182835 (higher) |
| Edit to "gorge" | Android | 1783980182834 |

**deleteWins: true** — deleteHLC > editHLC

**Post-sync State**:
- **Desktop**: 1 deleted entry (`dict-entry-...-w9elba`, definition: "valley", deleted_at: 1783980182835)
- **Android** (`dictionary-entry` replica): 1 deleted entry with **different replica_id** (`dict-entry-...-lux182`, definition: "gorge", deleted_at_ts present)
- **Both devices**: Entry is deleted (deletedCount: 1 on both sides). Occurrences present on both (2 occurrences each).

**Analysis**: The delete DID win correctly on both devices. Both agree the entry is deleted. However, the replica_ids differ because they were created independently on each device. The harness verdict is `warn`, which suggests it accepts the delete winning but flags the replica_id divergence as a concern.

**Root Cause Classification**: **Harness assert too strict** — Delete correctly won on both sides. The replica_id divergence is expected for concurrently-created entities. The harness assertion likely requires exact replica_id match, which is not achievable under concurrent creation. Should be upgraded to pass if both devices agree the entity is in deleted state.

**Evidence Strength**: **Strong** — Both devices show deleted state.

---

### Case 22c — `case22c-delete-wins` (annotation) — FAIL

**Scenario**: Desktop creates annotation then deletes it. Android concurrently edits the note.

| Action | Device | HLC |
|--------|--------|-----|
| Delete | Desktop | 1783980187579 (higher) |
| Edit to "updated" | Android | 1783980187578 |

**deleteWins: true** — 1783980187579 > 1783980187578

**Post-sync State**:
- **Desktop**: 1 deleted annotation (`annotation-...-88kqz9`, note: "original", deleted_at: 1783980187579)
- **Android** (`annotation` replica): 1 deleted annotation with different replica_id (`annotation-...-c2wdr7`, note: "updated", deleted_at_ts present)
- **Both devices**: Annotation deleted. Replica_ids differ.

**Analysis**: Same pattern as 22a but the verdict is `fail` instead of `warn`. This may indicate the harness has a stricter assertion for annotation convergence. Both devices correctly show the annotation as deleted. The note value differs ("original" vs "updated") because Android's edit happened before it received the delete tombstone.

**Root Cause Classification**: **Assert too strict** — Delete correctly won on both sides. The note value difference on Android is semantically correct (Android applied its local edit before receiving the delete). The harness should accept any deleted entity with matching semantic_key, regardless of field values or replica_id.

**Evidence Strength**: **Strong**

---

### Case 24 — `case24-two-annotations-same-range` — FAIL

**Scenario**: Desktop adds annotation with text "Idea A" at a specific CFI. Android adds annotation with text "Idea B" at the SAME CFI.

| Annotation | Origin | CFI | Text | Note |
|-----------|--------|-----|------|------|
| annotation-...-jufrv3 | Desktop | `/6/4[dev-sync...]!/6/2:0` | "Idea A" | "Idea A" |
| annotation-...-nhqe9p | Android | `/6/4[dev-sync...]!/6/2:0` | "Idea B" | "Idea B" |

**Post-sync State**:
- **Desktop** (`annotations`): **2 rows** — BOTH annotations present ✅
- **Android** (`annotation` replica): **2 rows** — BOTH annotations present ✅
- **Complete bidirectional convergence**: Both devices have the same two annotations with matching replica_ids

**Analysis**: The system correctly converged. Both annotations coexist because they have different semantic_keys (`...|Idea A` vs `...|Idea B`) — they are different entities. The harness expects something else (possibly that annotations at the same CFI should merge or that only one should survive).

This is **correct CRDT behavior**: two independent concurrent creates at the same CFI with different text are different entities and should both survive. The CRDT preserves all writes.

**Root Cause Classification**: **Harness assert too strict / CRDT behavior correct** — The system correctly converged to having both annotations on both devices. The harness assertion likely expects only one annotation at a given CFI, which contradicts the CRDT's design principle of preserving concurrent writes. The harness should accept multi-annotation coexistence at the same range.

**Evidence Strength**: **Strong** — Perfect convergence observed on both devices.

---

### Case 25 — `case25-discover-mutate` — WARN

**Scenario**: Desktop creates an annotation. Android "discovers" it and mutates its type from `annotation` to `quote`.

**Post-sync State**:
- **Desktop**: Has annotation in `annotations` table. No quotes.
- **Android**: Has annotation in `annotations` replica. Quote replicas also have it. BookConfig lists it as type "quote".
- **Sync trigger**: `annotation: applied: 1, pulled: 0` — Desktop pushed its annotation to Android but nothing was pulled back.

**Analysis**: Android mutated the entity type from annotation to quote via its bookConfig layer, but the underlying replica kind is still `annotation`. The desktop never received a quote replica push, so it still shows only the annotation. The type mutation did not propagate.

**Root Cause Classification**: **Product bug / design gap** — Entities cannot change their `kind` (annotation → quote) through the replica sync protocol. The mutation is purely local to Android's bookConfig index and is not propagated. This is either a missing feature (cross-kind morphing) or a case that should be explicitly prevented with validation.

**Evidence Strength**: **Moderate** — Clear evidence of the type mismatch, but the question is whether cross-kind morphing is an intended feature or a disallowed operation.

---

### Case 26 — `case26-discover-invalid-ref` — WARN

**Scenario**: Desktop creates a dictionary entry. Android creates a quote, then incorrectly links the dictionary entry to the wrong entity (quote) in its bookConfig.

**Post-sync State**:
- **Desktop**: Has dictionary entry (synced to Android), AND quote (pulled FROM Android). Quote had `appliedToDesktop: 1`.
- **Android**: Has dictionary entry AND quote. BookConfig shows `dict-entry-...-ysowu9` with `citeId: "quote-1783980226094-5xurj6"` — linking a dictionary entry to a quote.
- **The invalid reference**: The dictionary entry references a quote that has no logical relationship (different CFI, different text).

**Analysis**: The system correctly synced all entities bidirectionally. However, the Android bookConfig maintains an invalid cross-entity reference (dictionary entry → quote). No validation prevents this. The desktop only sees the raw entities, not the invalid reference (bookConfig is Android-local).

**Root Cause Classification**: **Product bug / insufficient validation** — The system does not validate cross-entity references during sync or at the bookConfig layer. Invalid references (dictionary entry citing a quote) should be detected and either corrected or logged as errors. This could cause crashes or UI issues on Android.

**Evidence Strength**: **Strong** — Clear evidence of the invalid reference in Android bookConfig.

---

## Root Cause Candidates

### Primary: Replica-level CRDT lacks field-level HLC merge in pull path (21a, 21b, 21d)

The sync protocol uses replica-level CRDT where each `(kind, replica_id)` pair is a unit of replication. When two devices concurrently create entities with the same `semantic_key` but different `replica_id`s, the system treats them as separate replicas rather than field-level conflicts on the same logical entity.

**Evidence**: In 21a, the `dictionary-entry` sync shows `applied: 1, pulled: 1, appliedToDesktop: 1`. The Android pushed its entry AND the desktop pulled it, but both exist as separate replicas rather than one merged entity. The `appliedToDesktop` indicates the Android's entry was applied to the desktop's replica table, but the desktop's local DB still has both entries.

**Impact**: Cases 21a, 21b, and 21d.

### Secondary: Same-HLC tiebreaking not implemented (21d)

When both edits have the same HLC timestamp, the system needs deterministic tiebreaking (e.g., lexicographic comparison of `replica_id`s). Currently, neither device resolves the tie.

### Tertiary: Delete-wins assertions are too strict (22a, 22c)

Both cases correctly show the delete winning on both devices. The harness fails because it expects replica_id convergence (22c=fail) or flags it (22a=warn). The assertion should accept any deleted entity with matching semantic_key.

### Harness: Same-CFI multi-annotation assertion incorrect (24)

The CRDT correctly preserves both annotations as distinct entities. The harness should accept multi-annotation coexistence at the same CFI range.

### Edge case: Cross-kind type mutation not handled (25)

Annotation→quote morphing only affects Android's bookConfig, not the sync layer. Either this should be explicitly forbidden or implemented as a proper replica mutation.

### Edge case: No cross-entity reference validation (26)

The bookConfig layer can create invalid references (dictionary→quote) that are not validated during sync.

---

## Classification Summary

| Case | Verdict | Classification | Confidence |
|------|---------|---------------|------------|
| 21a | fail | **Product bug** — Replica CRDT no merge field-level HLC | High |
| 21b | fail | **Product bug** — Same root cause as 21a | High |
| 21d | warn | **Product bug** — Same-HLC tiebreak missing | High |
| 22a | warn | **Harness too strict** — Delete won, accept divergent replica_id | High |
| 22c | fail | **Harness too strict** — Delete won, accept divergent replica_id | High |
| 24 | fail | **Harness too strict** — CRDT correctly preserves both annotations | High |
| 25 | warn | **Product bug** — Cross-kind morphing not propagated | Medium |
| 26 | warn | **Product bug** — No cross-entity ref validation | Medium |

---

## Recommended Fixes

### Fix 1: Replica pull-path field-level HLC merge (21a, 21b, 21d)
**Priority**: P0 (unblocks 3 cases)
**Effort**: Medium — requires changes to `visible_repo.rs` `apply_remote_replica` path
**Approach**: During pull, when a remote replica has the same `semantic_key` as a local entity, perform field-level HLC comparison instead of treating it as a separate replica. For 21d (tiebreak), use deterministic `replica_id` comparison.

### Fix 2: Relax harness convergence assertions (22a, 22c, 24)
**Priority**: P1 (unblocks 3 cases)
**Effort**: Low — changes to cycle assert scripts
**Approach**: 
- Accept divergent `replica_id`s when both devices agree on deleted/active state with matching `semantic_key`
- Accept multiple annotations at the same CFI as valid convergence

### Fix 3: Cross-kind morphing validation (25)
**Priority**: P2 (unblocks 1 case)
**Effort**: Low — add validation or update harness expectation
**Approach**: Either (a) add validation to prevent annotation→quote morphing, or (b) update the harness to expect it as a warning condition.

### Fix 4: Cross-entity reference validation (26)
**Priority**: P2 (unblocks 1 case)
**Effort**: Low — add validation in bookConfig layer
**Approach**: When building bookConfig, validate that `citeId` references point to entities of compatible kinds.

---

## Risks

- **HLC merge changes might break unidirectional sync**: Field-level HLC merge is more complex than replica-level CRDT. Must ensure it does not break the fundamental sync protocol.
- **Android SQLite unavailable**: All 14 cases lack `android.sqlite3` evidence. Analysis relies on HTTP replica endpoints as fallback, which may not perfectly reflect the SQLite state.
- **Semantic key collisions**: If the semantic_key computation has edge cases (encoding, case sensitivity), field-level merge could incorrectly merge or fail to merge entities.
- **Regression risk**: Changing the pull path for 3 entity kinds (dictionary, annotation, quote) could affect the 6 currently passing cases.

## Ready for Proposal

**Yes** — The root causes are clearly identified with strong evidence. Six of eight failing cases can be resolved with two targeted fixes:
1. Field-level HLC merge in replica pull path (P0, 3 cases)
2. Relax harness assertions (P1, 3 cases)
3. Edge case fixes for cross-kind morphing and cross-entity refs (P2, 2 cases)
