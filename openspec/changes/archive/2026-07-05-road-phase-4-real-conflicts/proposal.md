# Proposal: road-phase-4-real-conflicts

## Intent

Phase 4 (🏅 Capa 4 — Conflictos Reales) tests the sync system under true concurrent conflict: both devices edit the same field, delete vs edit the same datum, or create structurally invalid highlight-group relationships. This is the first phase where product code changes may be required — the merge layer must prove it handles LWW for same-field edits, tombstone-vs-update resolution, and highlight integrity validation. Phase 3 proved concurrent creation convergence; Phase 4 proves conflict resolution under LWW/HLC rules.

## Scope

### In Scope
- **Case 21**: Same-field edit (4 sub-cases 21a-21d) — LWW by HLC, field-level merge for dictionary definition, dictionary image, annotation note, book metadata
- **Case 22**: Edit vs delete (2 of 3 sub-cases: 22a/22c; 22b BLOCKED) — HLC decides delete vs update for dictionary entry (22a) and annotation note (22c)
- **Case 23**: Concurrent creations (5 sub-cases 23a-23e) — same book same ID, same book different ID, same word, same quote same range, same quote different book
- **Case 24**: Distinct annotations same range (1 sub-case) — N("A") and N("B") on same text, both survive
- **Case 25**: Highlight group mutation (§15.6) — DISCOVER if merge code validates BookNote type integrity; fix if broken
- **Case 26**: Wrong group pointer (§15.7) — H_D→C invalid state; DISCOVER if merge layer rejects it; fix if broken

### Out of Scope
- O→M / M→O symmetry variants (redundant with Phase 2/3 — O⇄M + R-n is sufficient)
- Case 22b (quote edit vs delete — quotes are immutable per §13.6, no editable fields)
- Cases 27+ (Capa 5 — HLC, tombstones, ordering, reinstallations)
- Product-level CRDT merge redesign beyond what cases 25-26 may uncover

## Capabilities

### New Capabilities
- None — Phase 4 extends existing capability; all cases map to `sync-crdt-hlc-real-device-harness`

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: Add Phase 4 section with PASS/FAIL/WARN criteria for concurrent same-field edit, edit-vs-delete resolution, concurrent creation dedup, highlight type integrity, and highlight group pointer validation

## Approach

1. **Variant strategy**: O⇄M (both act before sync) + R-n (repeat isolated) per case. Skip O→M and M→O — Phase 2/3 already prove directional convergence.
2. **Execution order**: 23 (easiest, extends Phase 3 patterns) → 21 → 22 → 24 → 25 → 26
3. **Cases 21-24**: Harness-only — extend `dev-sync-cycle.mjs` with setup functions and verdict functions per sub-case. No product code changes.
4. **Cases 25-26**: DISCOVER first — run a real-device probe to determine if merge code validates BookNote type integrity and highlight group immutability. If probes fail, add product code fixes within same change (or split to chained PR if >400 lines).
5. **Harness pattern**: Same `clean → prepare → fixture_A → fixture_B → sync → verify → report` from Phase 3. Setup functions create the conflict state, verdict functions assert LWW/HLC outcome.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Add cases 21-24 setup/verdict functions |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modified (minor) | Extend fixtures for concurrent edit/delete setup if needed |
| `apps/readest-app/scripts/assert-engine.mjs` | Modified (minor) | Add verdict helpers for same-field LWW, edit-vs-delete |
| `apps/readest-app/scripts/sync-execute.mjs` | Possibly modified | If cases 25-26 reveal missing type/group validation |
| Product merge/store code | Possibly modified | If cases 25-26 require product fix for highlight integrity |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cases 25-26 require product code changes >400 lines | Med | Split into chained PR (discovery PR + fix PR). Already planned as DISCOVER-first. |
| Case 22b officially BLOCKED — no test to write | High | Document as NOT APPLICABLE in spec. Deduct from success count. |
| HLC tie-breaking (same physical time) not deterministric on real device | Low | HLC includes counter+nodeId for stable total order. Verify in assertion. |
| O⇄M variant alone may miss direction-specific bugs | Low | Phase 2/3 already proved both directions work. O⇄M tests the novel path. |

## Rollback Plan

If a product code fix for cases 25-26 breaks existing Phase 1-3 sync: revert the fix commit, re-run Phase 3 regression (cases 15-20), confirm reversion is clean. Harness-only additions (cases 21-24) can be reverted per-file with no product impact.

## Dependencies

- Phase 3 spec (`openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` §Phase 3) — identity rules and execution matrix are base for Phase 4
- Real device (Nothing Phone A065) with Phase 3 battle-tested harness

## Success Criteria

- [ ] All sub-cases (21a-21d, 22a/22c, 23a-23e, 24, 25, 26) have defined PASS/FAIL/WARN criteria in spec
- [ ] Cases 21-24: O⇄M + R-n variants pass on real device with harness-only changes
- [ ] Cases 25-26: DISCOVER result determines whether product fix is needed; if yes, fix passes verified on real device
- [ ] Overall Phase 4 real-device PASS rate >80% across all executed variants
- [ ] Case 22b documented as NOT APPLICABLE with rationale (quotes immutable)
