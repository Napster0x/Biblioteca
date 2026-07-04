# Design: Phase 3 Delta Spec for Light Conflicts

## Technical Approach

The delta spec will extend `sync-crdt-hlc-real-device-harness` with **identity-first convergence criteria** for cases 15–20. The spec is organized as: declare semantic identity rules per entity → lay out the 4-variant execution matrix → specify PASS/FAIL/WARN per case → document edge policy. Since cases 16–17 are already real-device verified, their spec entries are concise references; cases 15, 18, 19, 20 get the full treatment.

## Architecture Decisions

### Decision: Spec Section Organization

| Option | Tradeoff |
|--------|----------|
| Identity rules → execution matrix → case specs → edge policy | Logical dependency: identity rules underpin every case |
| Per-case self-contained spec | Redundant — each case would restate same identity formulas |

**Chosen**: Identity-first. Readers must understand "what is the same book?" before evaluating "does case 15 converge?". The identity rules section becomes the single source of truth reused across all 6 cases.

### Decision: Identity Decision Model (Per Entity)

| Entity | Semantic Key | Source | Immutable Fields | Editable Fields |
|--------|-------------|--------|-----------------|-----------------|
| Book | `hash` (unique logical book) | §8.4–§8.6 | — | metadata by HLC |
| Dictionary entry | `normalize(term) \| normalize(lang)` | existing `semantic-dedup-sync` | `term` | `definition` by HLC |
| Quote | `bookHash \| cfi \| contentHash` | `sync-filter-standalone.mjs` line 56 | `text`, `contentHash` | — (immutable after creation) |
| Annotation | `bookHash \| cfi \| text` | existing `semantic-dedup-sync` | `text`, `cfi`, `selectedText` | `note` by HLC |
| Range | CFI start + end (equal); contained/overlap = separate | §15.4 | position | — (not an entity) |
| Group (BookNote) | `bookHash \| range \| semanticType + refId` | §15.3, §19.1–§19.3 | type, range | — (coexist on same range) |

### Decision: Execution Matrix

| Variant | Label | Cases covered | Isolation |
|---------|-------|---------------|-----------|
| Desktop-first | O→M | 15, 16, 17, 18, 19, 20 | Clean between variants |
| Android-first | M→O | 15, 16, 17, 18, 19, 20 | Clean between variants |
| Concurrent A/B | CONC | 15, 18, 19, 20 | Clean between variants |
| Isolated repetition | REP | all 6 (once each, clean state) | Global isolation per case |

**Total**: 24 spec entries. Cases 16–17 skip CONC variant (already verified by `fix-semantic-dedup-sync`).

### Decision: Evidence Model

| Verdict | Condition | Evidence Required |
|---------|-----------|-------------------|
| **PASS** | Both devices show identical logical state after convergence, no duplicates, no data loss | `_replicas`/HLC + `config.json.booknotes` (for range claims) + SQLite visible table snapshots |
| **FAIL** | Data loss, logical duplicates, destructive collapse where coexistence expected, divergent state | Replicas evidence + device snapshots showing the divergence |
| **WARN** | Missing evidence (no config.json for range), transient divergence that self-heals, timing/UI inconsistency without data corruption | Available evidence paths + diagnosis of missing domain |

Evidence floor: Without both `_replicas`/HLC AND `config.json.booknotes` (needed for range/group coexistence claims), max verdict is `WARN`.

### Decision: File Organization

Per OpenSpec convention and the proposaŀs in-scope path:

```
openspec/changes/phase-3-light-conflicts-spec/
├── proposal.md                          # Accepted
├── design.md                            # ← THIS FILE
├── specs/
│   └── sync-crdt-hlc-real-device-harness/
│       └── spec.md                      # Delta (next: sdd-spec)
├── tasks.md                             # Next: sdd-tasks
├── apply-progress.md                    # Future: sdd-apply
└── verify-report.md                     # Future: sdd-verify
```

### Decision: Normalization Policy

| Entity | Normalization | Exceptions |
|--------|--------------|------------|
| Dictionary term | NFC composition + lowercase + soft-hyphen (U+00AD) strip | `normalizeTerm()` in `sync-filter-standalone.mjs` uses `NFC(str).toLowerCase().replace(/\\u00ad/g, '')`. `"solo"` ≠ `"sólo"` under NFC. Accents matter for identity. Soft-hyphen (`\u00ad`) is transparent. |
| Dictionary language | lowercase + NFD | Standard IETF tags (e.g., "es" vs "es-ES") — MUST NOT normalize region subtag |
| Quote text | `contentHash` = MD5 of raw text (as computed in `dev-sync-fixture.mjs` via `createHash('md5')`) | `contentHash` is an opaque string stored in `fields_jsonb.contentHash.v`. Its algorithm is an implementation detail of the creating client. Identity key is `bookHash | cfi | contentHash`. |
| Book hash | Raw file hash | Not normalized — identity is exact |

## Traceability Matrix

| Case | `casos_sync.md` ref | Identity Question | Pre-verified? | Fields Affected |
|------|---------------------|-------------------|---------------|-----------------|
| 15 | §8.4–8.6, §12.1–12.2 | Book identity: `hash` determines same logical book; `updatedAt` HLC merge; tombstone-aware reimport ordering | No | `library.json` (books), `_replicas` book entries |
| 16 | §16.4, §12.3, §22.4 | Dictionary normalization: NFC composition + lowercase + soft-hyphen strip (matches code `normalizeTerm()`). `"solo"` ≠ `"sólo"` under NFC. Occurrence coexistence by `entry_id\|book_hash\|cfi`. | ✅ Already verified | `dictionary_entries`, `dictionary_occurrences` |
| 17 | §17.1, §12.4, §22.3 | Quote dedup: `bookHash\|cfi\|contentHash`; same-text-different-book = separate quotes | ✅ Already verified | `quotes`, `_replicas` quote entries |
| 18 | §13.5–§13.7 | Highlight immutability: edit D definition, BookNote stays fixed; `note` editable by HLC, `text`/`cfi` immutable | No | `BookNote` config (`config.json.booknotes`), `dictionary_entries.definition` |
| 19 | §15.3, §19.1–§19.3 | Group coexistence: H_D + H_C + H_N on same range are separate identities; never collapse | No | `BookNote` records, links to D/C/N, `config.json.booknotes` |
| 20 | §15.4 | Range overlap: H_C(100-150) + H_N(120-180) coexist; destructive collapse is FAIL | No | `BookNote` records, CFI ranges, links to D/C/N |

## Data Flow (Documentation-Only)

No data flow changes. The delta spec documents existing sync pipeline behavior with formal PASS/FAIL/WARN criteria. The harness continues to operate as designed in the main `sync-crdt-hlc-real-device-harness` spec — Phase 3 adds the semantic convergence assertions on top.

```
[SUT: sync pipeline] ─→[harness assertions]──→[Phase 3 criteria: identity + merge + coexistence]
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/phase-3-light-conflicts-spec/design.md` | Create | This document |
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modify | Append Phase 3 identity rules and case specifications (4 new Requirement blocks: Identity, Matrix, Cases 15–20, Edge Policy) |

## Interfaces / Contracts

**Spec requirements contract** (what the delta spec MUST define):

| Contract | Type | Description |
|----------|------|-------------|
| `computeIdentityKey(entity)` | Reused from `semantic-dedup-sync` spec | Per-kind key formulas (book: `hash`, dict: `normalize(term\|lang)`, quote: `bookHash\|cfi\|contentHash`, annotation: `bookHash\|cfi\|text`) |
| `normalizeTerm(term)` | Reused | lowercase + NFD — first-class helper in spec |
| `rangeCompare(a, b)` | New spec concept | equal, contained, overlapping, disjoint — defines coexistence rules |
| `evidenceRequired(verdict)` | New spec concept | PASS requires `_replicas` + `config.json.booknotes` for range claims |
| `variantMatrix(case, variant)` | New spec concept | Parametric: O→M, M→O, CONC, REP — 24 total invocations |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Spec review | All 24 matrix entries have unambiguous PASS/FAIL/WARN | Peer review of spec delta — no automation |
| Evidence model | Each case's evidence floor prevents false PASS | Traceability matrix cross-check |
| Cases 16–17 | Identity key formulas match existing `semantic-dedup-sync` | Reference the already-verified spec |
| Cases 15, 18–20 | New criteria are precise enough for harness operator to determine verdict | Dry-run with scenario walkthrough |

## Migration / Rollout

This is documentation-only. The delta spec is reviewed and merged. Product code and harness changes happen in later SDD cycles that reference this spec. No rollout or data migration needed.

## Open Questions

- [ ] Accent normalization: §16.2 ("solo" vs "sólo") leaves policy open. The spec MUST document which normalization approach applies. **Recommendation** (requires team input): NFD + lowercase = same term; vary by language policy / dialect.
- [ ] Quote `contentHash` vs `selectedText` for identity: should the hash be computed from the raw book text or the user-editable `quoteText`? The existing `semantic-dedup-sync` uses `contentHash` from the raw text, which matches §17.1 expectations.
- [ ] Range edge case: what happens when ranges partially overlap AND the associated groups differ? §15.4 says "both survive" — but should the overlapping portion belong to both or be split? The spec SHOULD remain at coexistence level per §15.4 wording.
