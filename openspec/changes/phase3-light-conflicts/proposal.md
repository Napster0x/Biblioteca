# Proposal: Phase 3 Light Conflicts

## Intent

Phase 3 validates **light conflicts and concurrent convergence**, not simple one-way propagation. Cases 15–20 must prove identity semantics, non-destructive coexistence, idempotent convergence, and real-device evidence for highlights, dictionary, quotes, annotations, mixed groups, and ordering.

## Scope

### In Scope
- Specify cases 15–20 semantic rules: dedupe identity, editable vs immutable fields, tombstone/stale ordering, and coexistence.
- Extend harness support only where needed for concurrent desktop-first, Android-first, concurrent, and repeated-isolated runs.
- Define a verification matrix with PASS/WARN/FAIL evidence, including BookNote `config.json` range/group evidence.
- Use `auto-chain` / `stacked-to-main`; likely slices: identity exactness, editable fields, range/group coexistence, ordering/idempotence.

### Out of Scope
- UI redesign, broad sync rewrite, Phase 4+ behavior, automatic builds/tests/real-device runs in this phase.
- Heavy conflict UI unless a later accepted spec explicitly requires it.
- Markdown scenario parser, monolithic runner, or broad product merge redesign without failing specified evidence.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: add Phase 3 conflict semantics and bounded harness/evidence requirements for cases 15–20.

## Approach

| Step | Decision |
|------|----------|
| 1. Semantic rules first | Define logical identity for book hash, dictionary term/language, occurrence source tuple, quote source tuple, annotation source tuple, and BookNote range/group tuple. |
| 2. Harness support second | Add only fixture/state/assertion affordances needed to create and inspect the matrix. |
| 3. Verification matrix third | No separate mirror phase; each case uses desktop-first, Android-first, concurrent, and repeat paths. |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modified | Delta specs for Phase 3 rules and evidence. |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modified | Bounded concurrent/range/group fixtures. |
| `apps/readest-app/scripts/assert-engine.mjs` | Modified | Semantic conflict assertions. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modified | BookNote/range/group evidence capture. |
| `apps/readest-app/scripts/sync-filter-standalone.mjs`, `src/services/sync/replicaFilter.ts` | Possible | Dedupe policy only if specs require it. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dedupe keys collapse distinct data or miss duplicates | High | Specify identity per kind before code. |
| BookNote/config evidence is incomplete | Medium | Require config evidence for range/group claims. |
| Stale/tombstone policy is ambiguous | High | Define add-wins/remove-wins/manual-conflict boundaries. |
| Quote/dictionary merge policy overreaches | Medium | Separate immutable, editable, and source fields. |

## Rollback Plan

Revert Phase 3 deltas and any harness slices independently. Product sync behavior remains unchanged unless a later slice proves and isolates a required fix.

## Dependencies

- Existing Phase 2 harness capabilities and current `sync-crdt-hlc-real-device-harness` spec.
- Exploration artifacts in Engram and `openspec/changes/phase3-light-conflicts/exploration.md`.

## Success Criteria

- [ ] Proposal frames Phase 3 as conflict/convergence validation, not one-way propagation.
- [ ] Scope covers cases 15–20, identity, coexistence, idempotence, and real-device evidence path.
- [ ] Bidirectionality uses matrix coverage; no separate mirror phase.
- [ ] Review plan supports stacked PR slices under the auto-chain strategy.
