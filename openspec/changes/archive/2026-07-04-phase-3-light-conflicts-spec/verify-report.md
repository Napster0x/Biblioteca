# Verification Report

**Change**: phase-3-light-conflicts-spec
**Version**: 2026-07-04 (initial delta spec)
**Mode**: Standard (documentation-only — no code tests)

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 7 (Phase 1: 4 + Phase 2: 2 + Phase 3: 1 archivable task in tasks.md) |
| Tasks complete | 0 (not yet applied — this verification is the first execution of Phase 1) |
| Tasks incomplete | 7 |

### Phase 1 Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Cross-check `casos_sync.md` references | ✅ Verified | See Check 2 below |
| 1.2 | Validate no contradictions with main harness spec | ✅ Verified | See Check 3 below |
| 1.3 | Verify identity rules vs actual sync code | ❌ ISSUES FOUND | See Check 1 below — normalization mismatch |
| 1.4 | Verify roadmap coverage | ✅ Verified | See Check 4 below |

---

## Check 1: Identity Rules Match Code (CRITICAL)

### 1.1 Book Identity — PASS

**Spec**: `book.hash` (content hash) is the semantic key.

**Code**: `computeSemanticKey()` in `sync-filter-standalone.mjs` does NOT have a `kind` for books. Book identity is handled by `pushBooks()` in `sync-execute.mjs`, not by `computeSemanticKey`. The behavioral rules documented in the spec (hash-based identity, metadata merge by HLC, tombstone defeat) are consistent with the main harness spec §"Book tombstone reimport ordering" and casos_sync.md §8.4–8.6.

**Evidence**: The spec's book identity rules describe expected design behavior. No direct code function to compare against. The rules are additive and consistent with the main harness spec.

### 1.2 Dictionary Entry Identity — FAIL (normalization mismatch)

**Spec** (§1.2):
- Semantic key: `normalize(term) | normalize(language)`
- Normalization: `lowercase(trim(NFD(str)))` — Unicode NFD decomposition (canonical), then lowercase, then strip leading/trailing whitespace.
- Accent policy: NFD decompose → strip combining marks → lowercase. "solo" and "sólo" resolve to `"solo"`.

**Code** (`sync-filter-standalone.mjs` lines 24-27, 38-43):
```javascript
export function normalizeTerm(s) {
  return String(s).normalize('NFC').toLowerCase().replace(/\u00ad/g, '');
}
// Key: `${normalizeTerm(term)}|${normalizeTerm(language ?? '')}`
```

| Aspect | Spec | Code | Match? |
|--------|------|------|--------|
| Unicode form | **NFD** (decomposition) | **NFC** (composition) | ❌ **FAIL** |
| Accent handling | NFD + strip combining marks → "solo" and "sólo" resolve | NFC + lowercase → "sólo" and "solo" stay different | ❌ **FAIL** |
| Soft-hyphen strip | Not mentioned | `replace(/\u00ad/g, '')` | ❌ Missing from spec |
| Whitespace trim | `trim()` in formula | NOT in `normalizeTerm`; guard only checks `term.trim() === ''` | ❌ **FAIL** (spec says trim, code doesn't) |

**Impact**: The spec's accent normalization policy ("solo" ↔ "sólo" are the SAME entry) CANNOT be achieved with the current code, which uses NFC. With NFC, `normalizeTerm("sólo")` → `"sólo"` (accent preserved) ≠ `"solo"`. This means cases 16-17, which were "pre-verified" via `fix-semantic-dedup-sync`, were verified with NFC-based dedup — NOT with the NFD normalization the spec describes.

Additionally, the code strips soft-hyphens (U+00AD) which the spec does not document.

### 1.3 Dictionary Occurrence Identity — PASS

**Spec**: Implicit — occurrence is an immutable event. Design doc says key is `entry_id|book_hash|cfi`.

**Code** (lines 44-49):
```javascript
const entryId = f?.entryId?.v;
const bookHash = f?.bookHash?.v;
const cfi = f?.cfi?.v;
return `${entryId}|${bookHash}|${cfi}`;
```

**Result**: ✅ Matches. The code produces `entryId|bookHash|cfi` which is consistent with the design doc's description.

### 1.4 Quote Identity — WARN (documentation clarity)

**Spec** (§1.3):
- Semantic key: `bookHash | cfi | contentType(contentHash)`

**Code** (lines 51-57):
```javascript
return `${bookHash}|${cfi}|${contentHash}`;
```

| Aspect | Spec | Code | Match? |
|--------|------|------|--------|
| Key components | `bookHash \| cfi \| contentType(contentHash)` | `bookHash\|cfi\|contentHash` | ❓ Ambiguous |
| `contentHash` algorithm | Not defined (what hash? SHA-256? MD5?) | Used as-is from `fields_jsonb.contentHash.v` | ❌ **Missing from spec** |

The spec writes `contentType(contentHash)` which is confusing — it reads like a `contentType()` function wrapping `contentHash`. The design doc correctly says `bookHash|cfi|contentHash`. The spec should say just `contentHash` (no wrapper function).

Also, the spec never defines what algorithm `contentHash` uses. The design doc says "SHA-256 of trimmed whitespace-normalized text" but the spec does not mention this anywhere.

**Result**: ⚠️ WARN — documentation clarity issue. The actual key formula matches code behavior but the spec's notation is misleading and the hash algorithm is undefined.

### 1.5 Annotation Identity — PASS

**Spec** (§1.4):
- Semantic key: `book_hash | cfi | text` (immutable selected text)

**Code** (lines 58-64):
```javascript
return `${bookHash}|${cfi}|${text}`;
```

**Result**: ✅ Matches exactly.

### 1.6 Range/Highlight Identity — PASS

**Spec** (§1.5):
- Highlights are BookNote objects, not SQL entities.
- Identity: `bookHash | cfi/range | type | {dictionaryEntryId | citeId | annotationId}`
- Range equality, containment, overlap rules defined.

**Code**: Not applicable — highlights are BookNote objects inside `config.json → booknotes[]`. The code does not compute semantic keys for highlights via `computeSemanticKey()`. The spec's rules are design-level behavioral requirements.

**Result**: ✅ Spec rules are additive design documentation.

---

## Check 2: Case Citations Match casos_sync.md

### Case 15: Source: §8.4–8.6, §12.1–12.2, §29.1 T041

| Reference | Location in casos_sync.md | Match? |
|-----------|--------------------------|--------|
| §8.4 | "Ambos tienen el mismo libro con el mismo ID" (line 330) | ✅ |
| §8.5 | "Ambos tienen el mismo libro lógico con distinto ID" (line 344) | ✅ |
| §8.6 | "Ambos tienen libros distintos con metadatos parecidos" (line 358) | ✅ |
| §12.1 | "Ambos crean el mismo libro con el mismo ID" (line 637) | ✅ |
| §12.2 | "Ambos crean el mismo libro lógico con IDs distintos" (line 651) | ✅ |
| §29.1 T041 | Spec says §29.1 but T041 is actually in **§29.3** (line 2374) | ❌ **Wrong section** |

**Issue**: T041 ("Ambos importan el mismo libro offline") is at line 2374 in §29.3 (Creaciones concurrentes y deduplicación), NOT in §29.1 (Ciclos de vida de libros). The reference should be `§29.3 T041`.

### Case 16: Source: §16.4, §12.3, §22.4

| Reference | Location in casos_sync.md | Match? |
|-----------|--------------------------|--------|
| §16.4 | "Misma palabra desde libros distintos" (line 1356) | ✅ |
| §12.3 | "Ambos crean la misma palabra de Diccionario" (line 664) | ✅ |
| §22.4 | "Misma palabra con distinto ID" (line 1872) | ✅ |

### Case 17: Source: §17.1, §12.4, §22.3

| Reference | Location in casos_sync.md | Match? |
|-----------|--------------------------|--------|
| §17.1 | "Misma cita, mismo libro, mismo rango" (line 1421) | ✅ |
| §12.4 | "Ambos crean la misma cita desde el mismo rango" (line 689) | ✅ |
| §22.3 | "Misma cita con distinto ID pero mismo origen" (line 1860) | ✅ |

### Case 18: Source: §13.5–13.7, §29.4 T063

| Reference | Location in casos_sync.md | Match? |
|-----------|--------------------------|--------|
| §13.5 | "A edita el dato, el highlight permanece fijo" (line 950) | ✅ |
| §13.6 | "Las citas no se editan" (line 978) | ✅ |
| §13.7 | "A edita la nota de una anotación, B no toca nada" (line 997) | ✅ |
| §29.4 T063 | "Editar dato con highlight fijo" (line 2401) — IS in §29.4 | ✅ |

### Case 19: Source: §15.3, §19.1–§19.3

| Reference | Location in casos_sync.md | Match? |
|-----------|--------------------------|--------|
| §15.3 | "Mismo rango, grupos distintos" (line 1237) | ✅ |
| §19.1 | "A añade Diccionario, B añade Cita al mismo libro" (line 1581) | ✅ |
| §19.2 | "A añade Diccionario, B añade Anotación" (line 1595) | ✅ |
| §19.3 | "A añade Cita, B añade Anotación" (line 1609) | ✅ |

### Case 20: Source: §15.4

| Reference | Location in casos_sync.md | Match? |
|-----------|--------------------------|--------|
| §15.4 | "Ranges solapados" (line 1251) | ✅ |

### Overall: One reference error found

**Case 15 source line should be `§29.3 T041` not `§29.1 T041`.**

---

## Check 3: No Contradictions with Main Harness Spec

| Concern | Main Spec Statement | Delta Spec Statement | Consistency |
|---------|-------------------|---------------------|-------------|
| Identity rules | Not defined at spec level (defined at code level in `computeSemanticKey`) | Adds formal identity rules per entity | ✅ Additive |
| Evidence degradation | "MUST degrade honestly when Android evidence unavailable; MUST NOT produce false PASS" | §5.1: Without `_replicas`/HLC + `config.json` → max WARN | ✅ Consistent |
| Book tombstone reimport | "Newer reimport MUST resurrect; older tombstone MUST NOT hide reimport" | §4.1: "updatedAt > deletedAt MUST resurrect" | ✅ Consistent |
| Book metadata update | "pushBooks compares updatedAt; newer pushes library entry" | §1.1: "Editable by HLC" lists all metadata fields | ✅ Consistent — additive field list |
| Quote transport | "PUT quote rows to Android /replicas/quote" | §1.3: "Quotes are immutable" — no editable fields | ✅ Consistent |
| Annotation transport | "PUT annotation rows to Android /replicas/annotation" | §1.4: `note` editable by HLC | ✅ Consistent |
| Semantic dedup code | "computeSemanticKey MUST produce dedup behavior" (code requirement) | §1.1–1.5: Defines WHAT the keys ARE | ✅ Complementary |
| Range/group coexistence | Not defined | §4.2: Never collapse; coexistence rules | ✅ Additive |
| Preflight gating, Doctor diagnostics | Multiple requirements | Delta spec does not redefine or weaken any | ✅ Preserved |
| Delivery constraints | "auto-chain, stacked-to-main" | tasks.md matches this strategy | ✅ Consistent |

**Result**: ✅ No contradictions found. The delta spec is purely additive to the main harness spec. It defines semantic identity rules (which the main spec relies on but doesn't define) and adds Phase 3 case-level PASS/FAIL/WARN criteria.

---

## Check 4: Roadmap Coverage

### Phase 1: Semantic specification

| Req | Description | Covered in Spec? | Evidence |
|-----|-------------|------------------|----------|
| 1.1 | Create Phase 3 delta spec | ✅ | `spec.md` exists with 485 lines |
| 1.2 | Logical identity for entities | ✅ | §1.1–1.5: Book, Dictionary, Quote, Annotation, Range |
| 1.3 | PASS/FAIL/WARN per case | ✅ | Each case §3.1–3.6 has "Verdict Criteria" table |

### Phase 2: Execution matrix

| Req | Description | Covered in Spec? | Evidence |
|-----|-------------|------------------|----------|
| 2.1 | Symmetry/concurrency variants, not mirror phase | ✅ | §2.1: 4 variants (O→M, M→O, O⇄M, R-n) within one matrix |
| 2.2 | Desktop-first, Android-first, concurrent, isolated | ✅ | §2.1 Symmetry Variants table fully defined |
| 2.3 | Isolation → no state leakage | ✅ | Isolated repetition variant + §2.2 "Clean verification before case" |

### Phase 3: Cases 15-20

| Req | Description | Covered in Spec? | Evidence |
|-----|-------------|------------------|----------|
| 3.1 | Case 15: same book both devices | ✅ | §3.1 |
| 3.2 | Case 16: same word both devices | ✅ | §3.2 |
| 3.3 | Case 17: same quote/range both devices | ✅ | §3.3 |
| 3.4 | Case 18: edit datum with fixed highlight | ✅ | §3.4 |
| 3.5 | Case 19: same range, different groups | ✅ | §3.5 |
| 3.6 | Case 20: overlapping ranges | ✅ | §3.6 |

### Phase 5: Verification criteria

| Req | Description | Covered in Spec? | Evidence |
|-----|-------------|------------------|----------|
| 5.1 | Repeat with bounded attempts | ✅ | §2.2 Isolated repetition variant + clean verification evidence |
| 5.2 | >80% PASS rate | ⚠️ Implied | Not explicitly in spec (threshold is in the proposal, not the spec itself). The spec defines what PASS means per case. The 80% threshold is an execution policy. |
| 5.3 | WARN counts as non-success | ✅ | §5.2 Verdict Determinism Matrix: WARN ≠ PASS |
| 5.4 | Verify independently | ✅ | Isolated repetition + §2.2 "Clean verification before case starts" |

> **Note**: Requirements 4.1–4.4 (implementation order) are in the roadmap tasks.md and proposal.md, not in the delta spec. The spec correctly focuses on behavioral definition, not implementation sequence.

**Result**: ✅ All applicable requirements are covered with one minor note about the 80% threshold (which is an execution policy, not a spec definition).

---

## Check 5: Design Coherence

| Decision in Design | Followed in Spec? | Notes |
|--------------------|-------------------|-------|
| Identity-first organization | ✅ Yes | Spec starts with §1 Identity Rules before cases |
| Per-entity semantic keys | ✅ Yes | §1.1–1.5 match the design's identity model table |
| 4-variant execution matrix | ✅ Yes | §2.1 matches exactly (O→M, M→O, CONC, REP) |
| Evidence floor model | ✅ Yes | §5.1 evidence minimums; §5.2 determinism matrix; max WARN without key evidence |
| Normalization: NFD for terms | ❌ **FAIL** | Spec says NFD but design should have noted this is aspirational — code uses NFC |
| contentHash = SHA-256 | ⚠️ Partially | Design says SHA-256 but spec never defines the algorithm |
| Cases 16-17 skip CONC variant | ✅ Yes | §2.1 spec matrix notes: "Cases 16–17 skip CONC variant (already verified)" |

---

## Issues Found

### FAIL (requires fixing before archive)

#### F1: Normalization mismatch — Spec says NFD, code uses NFC

**What**: The spec's dictionary term normalization function (§1.2) specifies `NFD` (canonical decomposition) with the explicit accent policy that "solo" and "sólo" resolve to the same normalized key. The actual code in `sync-filter-standalone.mjs` uses `NFC` (composition), which does NOT decompose accented characters. With NFC, `normalizeTerm("sólo")` → `"sólo"` ≠ `"solo"`.

**Impact**: The spec's accent normalization policy CANNOT be achieved with current code. Cases 16-17 were pre-verified with NFC-based dedup — the NFD policy is unverified and aspirational.

**Where**: `spec.md` §1.2, lines 49–51. `sync-filter-standalone.mjs` line 26.

**Fix**: Either:
- (a) Change spec to match code: `NFC → lowercase → strip soft-hyphens` (no accent normalization), or
- (b) Keep spec as aspirational NFD and note explicitly that accent normalization requires a code change, OR
- (c) Change code to NFD + strip combining marks to match spec.

#### F2: Spec does not document soft-hyphen stripping

**What**: The code's `normalizeTerm` strips soft-hyphen characters (U+00AD) with `replace(/\u00ad/g, '')`. The spec's normalization formula does not document this.

**Where**: `spec.md` §1.2, line 50. `sync-filter-standalone.mjs` line 26.

**Fix**: Add soft-hyphen stripping to the spec's normalization function: `lowercase(NFC(str).replace(/\u00ad/g, ''))` (if matching code) or incorporate appropriately.

#### F3: Spec says trim() but code doesn't trim in normalizeTerm

**What**: Spec's normalization function says `trim()` (strip leading/trailing whitespace), but the code's `normalizeTerm()` does not trim whitespace. The only trim check is in the guard condition (`term.trim() === ''` to reject empty strings).

**Where**: `spec.md` §1.2, line 50. `sync-filter-standalone.mjs` line 24-27.

**Fix**: Either remove `trim()` from the spec formula or add trimming to the code's `normalizeTerm()`.

#### F4: Wrong section reference in Case 15

**What**: Case 15 source block says `§29.1 T041` but T041 is in `§29.3` (Creaciones concurrentes y deduplicación, line 2374), not `§29.1` (Ciclos de vida de libros).

**Where**: `spec.md` §3.1, line 136.

**Fix**: Change `§29.1 T041` to `§29.3 T041`.

### WARNING (should fix)

#### W1: Quote semantic key notation is misleading

**What**: Spec writes `bookHash | cfi | contentType(contentHash)` which reads as if `contentType()` is a function wrapping `contentHash`. The design doc and code both use `bookHash|cfi|contentHash` without a wrapper.

**Where**: `spec.md` §1.3, line 64.

**Fix**: Change to `bookHash | cfi | contentHash`.

#### W2: contentHash algorithm undefined

**What**: The spec mentions `contentHash` but never defines the hash algorithm. The design doc says "SHA-256 of trimmed whitespace-normalized text" but this is not in the spec.

**Where**: `spec.md` §1.3. Design doc §"Decision: Normalization Policy" mentions SHA-256.

**Fix**: Add a note in §1.3 defining `contentHash` as SHA-256 of whitespace-normalized text.

#### W3: Pre-verified case normalization mismatch

**What**: Cases 16-17 are marked as pre-verified via `fix-semantic-dedup-sync` with the current code (NFC-based dedup). If the spec's NFD normalization is adopted as the canonical policy, these cases would need re-verification since accent normalization behavior changes.

**Where**: `spec.md` §3.2 and §3.3 (pre-verified badges), §5.3 evidence paths.

**Fix**: Either: (a) align spec with code (NFC) and keep pre-verified status, or (b) add a note that pre-verification was with NFC-based dedup and re-verification is needed if NFD is adopted.

#### W4: Cases 16-17 concurrent variant matrix

**What**: The design says cases 16-17 skip the CONC variant "already verified by fix-semantic-dedup-sync". The spec's execution matrix says all 6 cases run all 4 variants. The spec correctly applies this per-case (case 16-17 specs say "Desktop-first / Android-first / Concurrent / Isolated variants apply"), but the design's matrix table shows CONC only for cases 15, 18, 19, 20. The spec per-case descriptions mention "Concurrent" for 16-17 too.

**Resolution**: The spec's per-case text is the authoritative source. Since cases 16-17 are pre-verified with real device, including the concurrent variant is acceptable (it was already tested in `fix-semantic-dedup-sync`). The design matrix table and spec per-case text should agree — there's a minor discrepancy where the design says "skip CONC" but the spec's case descriptions include "Concurrent" in the variant list. This is non-contradictory since pre-verification already covers it.

**Fix** (optional): Add a note in the design matrix that cases 16-17 are pre-verified INCLUDING concurrent behavior.

---

## Check 6: Evidence Paths for Pre-verified Cases

### Cases 16-17 evidence paths

The spec §5.3 provides:
- Case 16: "Engram observation logs from 2026-07-04-fix-semantic-dedup-slice2 session. Desktop dictionary.db shows 1 entry, 2 occurrences. Android replica state confirms dictionary-entry sent=1, applied=1."
- Case 17: "Engram observation logs from same session. Desktop citas.db shows 1 quote. Android replica state confirms quote sent=1, applied=1."

These paths reference specific Engram sessions. The references are clear and actionable for a harness operator. ✅

---

## Verdict

### PASS WITH WARNINGS AND FAILS

The spec is **structurally sound** (identity-first, matrix-driven, additive to main harness spec, all cases covered). However, there are **4 FAIL items** that MUST be resolved before archive:

1. **F1**: Normalization NFD vs NFC mismatch (spec says one thing, code does another)
2. **F2**: Soft-hyphen stripping undocumented
3. **F3**: trim() in spec but not in code's normalizeTerm()
4. **F4**: Wrong section reference (§29.1 → §29.3 for T041)

And **4 WARN items** that SHOULD be fixed:

1. **W1**: Quote key notation misleading (`contentType(contentHash)` → `contentHash`)
2. **W2**: contentHash algorithm undefined
3. **W3**: Pre-verified cases normalization context
4. **W4**: Minor design/spec matrix variant discrepancy for cases 16-17

### Summary

| Check | Status |
|-------|--------|
| 1. Identity rules match code | **FAIL** (3 mismatches in dictionary normalization) |
| 2. Case citations match casos_sync.md | **WARN** (1 wrong section reference) |
| 3. No contradictions with main harness spec | **PASS** |
| 4. Roadmap coverage | **PASS** (with minor note on 80% threshold) |
| 5. Design coherence | **WARN** (NFD mismatch between design and spec) |

**Primary finding**: The normalization function in §1.2 must be reconciled between spec (NFD) and code (NFC). This is the most impactful issue since it affects the spec's core identity policy.
