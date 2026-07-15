# Tasks: Phase 3 Delta Spec for Light Conflicts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 50–100 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single documentation change |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Verify + archive delta spec | PR 1 | Single documentation-only PR. No product code. |

## Phase 1: Verify Delta Spec Against Source Documents

- [ ] 1.1 **Cross-check `casos_sync.md` references**: Verify every `§X.Y` source citation in the delta spec (Cases 15–20, Edge Policy) maps to the correct section in `casos_sync.md`. Check all 6 case source blocks + edge policy references (§29.1, §29.4).
- [ ] 1.2 **Validate no contradictions with main harness spec**: Audit the delta spec against `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` — ensure identity rules, evidence model, and verdict criteria are additive (never contradictory). Check pre-existing Requirement blocks (doctor, preflight, triggers, assertions, reporting) are not redefined or weakened.
- [ ] 1.3 **Verify identity rules vs actual sync code**: Cross-check each identity key formula (book `hash`, dictionary `normalize(term|lang)`, quote `bookHash|cfi|contentHash`, annotation `book_hash|cfi|text`) against `sync-filter-standalone.mjs` and `sync-execute.mjs` behavior. Produce a traceability note for each.
- [ ] 1.4 **Verify roadmap coverage**: Confirm the delta spec covers all Phase 3 roadmap requirements from `road-phase-3-light-conflicts/tasks.md` — tasks 1.1–1.3 (semantic spec, identity rules, PASS/FAIL/WARN), 2.1–2.3 (execution matrix variants), 3.1–3.6 (cases 15–20), 4.1–4.4 (implementation order guidance), 5.1–5.4 (verification criteria).

## Phase 2: Resolve Gaps (if any)

- [ ] 2.1 **Fix reference or contradiction issues**: Address any mismatches found in Phase 1 — wrong section references, contradictory evidence rules, missing identity coverage. Amend the delta spec at `openspec/changes/phase-3-light-conflicts-spec/specs/light-conflicts-concurrent-convergence/spec.md`.
- [ ] 2.2 **Update evidence paths for pre-verified cases**: Ensure Cases 16–17 reference the correct Engram observation IDs and real-device evidence paths from `fix-semantic-dedup-sync`. Verify the `WARN` → `PASS` criteria transition is properly gated.

## Phase 3: Archive Change

- [ ] 3.1 **Merge delta into main harness spec**: Append Phase 3 content (Identity Rules §1, Execution Matrix §2, Cases 15–20 §3, Edge Policy §4, Evidence Requirements §5) to `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` as new Requirement blocks. Preserve the base spec's existing section numbering and structure.
- [ ] 3.2 **Update change log and close the change**: Add archive entry to the spec's Change Log. Mark all checklist items in `proposal.md` success criteria as complete. Verify the delta spec file is preserved at its change path for traceability.
