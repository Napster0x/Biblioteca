# Proposal: Phase 3 Delta Spec for Light Conflicts

## Intent

Create a formal delta spec document defining **PASS/FAIL/WARN criteria** for sync cases 15–20 (light conflicts, concurrent convergence) from `casos_sync.md`. This is **documentation-only** — no product code, no harness changes. It implements roadmap tasks 1.1–1.3.

## Scope

### In Scope
- Delta spec at `openspec/changes/phase-3-light-conflicts-spec/specs/sync-crdt-hlc-real-device-harness/spec.md`
- Formal PASS/FAIL/WARN criteria per case, organized by symmetry/concurrency matrix (desktop-first, Android-first, concurrent A/B, isolated repetition)
- Logical identity rules per kind: book, dictionary, quote, annotation, BookNote
- Normalization rules: dictionary (case/accents), quotes (text+bookHash), range semantics
- Range comparison: equal, contained, overlapping — with coexistence vs collapse rules
- Highlight group coexistence: same-range+different-groups MUST coexist
- Evidence minimums: `_replicas`/HLC + `config.json.booknotes` for range claims

### Out of Scope
- Product code, harness fixture/assertion changes
- Re-testing Cases 16–17 (already real-device verified in `fix-semantic-dedup-sync`)
- Builds, real-device runs, automatic test execution
- UI changes, broad sync redesign, Phase 4+ behavior

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: Add Phase 3 light conflict convergence and identity criteria for cases 15–20.

## Approach

| Step | Deliverable |
|------|-------------|
| 1. Identity rules | Per-kind semantic key + normalization policy |
| 2. Execution matrix | 4 variants × 6 cases = 24 entries |
| 3. PASS/FAIL/WARN | Formal criteria per case with evidence minimums |
| 4. Edge policy | Tombstone/stale, group coexistence, range overlap |

### Key Spec Decisions to Codify

| Topic | Decision |
|-------|----------|
| Same-book identity | `hash` field → unique logical book. Metadata converge by HLC |
| Dictionary identity | `normalize(term) \| normalize(lang)` — lowercase + NFD unicode decompose |
| Quote identity | `bookHash \| cfi \| contentType(contentHash)` — same text + different book = different quotes |
| Range equality | Same CFI range start/end → equal. Contained and overlapping = separate identities |
| Group coexistence | Different `dictionaryEntryId \| citeId \| annotationId` on same range → coexist. Never collapse |
| Field edit policy | `annotation.note`, `dictionary.definition` editable by HLC; `text`, `cfi`, `selectedText` immutable |
| Evidence floor | `_replicas`/HLC + `config.json.booknotes`. Without both → max `WARN` |

### Cases Map

| # | Name | Source § | Pre-existing? | Spec focus |
|---|------|----------|---------------|------------|
| 15 | Same book both devices | §8.4–8.6, §12.1–12.2 | ❌ | Hash identity, metadata HLC merge, tombstone ordering |
| 16 | Same word both devices | §16.4, §12.3, §22.4 | ✅ verified | Normalization policy (case/accents), occurrence coexistence |
| 17 | Same quote/same range | §17.1, §12.4, §22.3 | ✅ verified | `bookHash\|cfi\|text` dedup, contentHash equality |
| 18 | Edit datum, fixed highlight | §13.5–§13.7 | ❌ | Immutable vs editable fields, BookNote config stability |
| 19 | Same range, different groups | §15.3, §19.1–§19.3 | ❌ | Coexistence: dictionary + quote + annotation on same range |
| 20 | Overlapping ranges | §15.4 | ❌ | Partial overlap → both survive; no destructive collapse |

## Affected Areas

| Area | Impact |
|------|--------|
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modified (delta for Phase 3 criteria) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Identity too strict collapses legitimate data | Medium | Explicit per-kind keys with boundary-case documentation |
| WARN vs PASS ambiguity without config.json evidence | High | Mandate config.json for range/group verdicts; without it max `WARN` |
| Accent normalization causes merge surprises | Low | Use standard NFD + lowercase; document exceptions |

## Rollback Plan

Revert the delta from the main harness spec. Zero product impact — this is a documentation-only change.

## Dependencies

- Roadmap `road-phase-3-light-conflicts` (accepted, archived)
- Existing `phase3-light-conflicts/design.md` for identity/merge reference
- `semantic-dedup-sync` spec for Cases 16–17 identity key formulas (already validated)

## Success Criteria

- [ ] Delta spec covers all 6 cases (15–20) with formal PASS/FAIL/WARN criteria
- [ ] Identity rules defined per kind: book, dictionary, quote, annotation, BookNote
- [ ] Execution matrix maps 4 symmetry variants per case (24 total entries)
- [ ] Evidence minimums specified: no PASS without replica+config evidence
- [ ] Criteria are unambiguous — a test operator can run any case and determine the verdict
