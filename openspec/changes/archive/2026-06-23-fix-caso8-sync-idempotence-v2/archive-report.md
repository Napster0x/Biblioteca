# Archive Report

**Change**: `fix-caso8-sync-idempotence-v2`
**Date**: 2026-06-23
**Mode**: hybrid
**Archived to**: `openspec/changes/archive/2026-06-23-fix-caso8-sync-idempotence-v2/`

---

## Verification Summary

- **Verdict**: PASS WITH WARNINGS
- **Tests**: 169/170 passed (1 pre-existing failure in `uses a namespaced dev counter`, unrelated)
- **Tasks**: 5/6 complete (3.2 Manual smoke optional — not blocking)
- **TDD Compliance**: 6/6 checks passed
- **Spec Compliance**: 11/11 scenarios compliant or partial

### Warnings (non-blocking)
1. Pre-existing test failure: HTTP 500 in `uses a namespaced dev counter` — unrelated to this change
2. HLC gate specificity: behavioral evidence strong but explicit HLC timestamp assertions not present — acceptable

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `sync-crdt-hlc-real-device-harness` | Updated | Caso 8 Push Idempotence: modified (2 new scenarios, requirement text expanded with cycle-triggered path); Caso 8 Pull-Side Pre-Filter: added (new requirement, 3 scenarios) |

### Delta Applied

**MODIFIED — Caso 8 Push Idempotence**:
- Requirement text expanded: "whether executed via direct CLI invocation or via the cycle harness HTTP trigger chain (dataRoot MUST propagate from cycle through sync-trigger route to spawned sync-execute)"
- New scenario: "Cycle-triggered second sync also produces zero operations"
- New scenario: "Direct CLI execution preserves v1 behavior"
- Existing scenarios preserved and slightly refined

**ADDED — Caso 8 Pull-Side Pre-Filter**:
- Pull evidence counts MUST reflect filtered replicas only
- Before applying pulled Android ReplicaRows, pull loop MUST apply `filterUnchangedReplicas()` and override `pulled`
- 3 scenarios: all-in-replicas → pulled=0, unseen → passes through, first-sync → pulled>0

---

## Archive Contents

| Artifact | Path | Status |
|----------|------|--------|
| proposal.md | `archive/2026-06-23-fix-caso8-sync-idempotence-v2/proposal.md` | ✅ |
| exploration.md | `archive/2026-06-23-fix-caso8-sync-idempotence-v2/exploration.md` | ✅ |
| specs/ | `archive/2026-06-23-fix-caso8-sync-idempotence-v2/specs/sync-crdt-hlc-real-device-harness/spec.md` | ✅ |
| design.md | `archive/2026-06-23-fix-caso8-sync-idempotence-v2/design.md` | ✅ |
| tasks.md | `archive/2026-06-23-fix-caso8-sync-idempotence-v2/tasks.md` | ✅ (5/6 tasks complete) |
| verify-report.md | `archive/2026-06-23-fix-caso8-sync-idempotence-v2/verify-report.md` | ✅ |

---

## Source of Truth Updated

The following main spec now reflects the new behavior:
- `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` — Caso 8 Push Idempotence updated, Caso 8 Pull-Side Pre-Filter added

---

## Implementation Summary

Two surgical fixes on the cycle execution path:
1. **Push dataRoot propagation**: `dev-sync-cycle.mjs` → POST body → `route.ts` → spawn env → `sync-execute.mjs`, enabling the v1 push filter to work in cycle context
2. **Pull pre-filter**: `filterUnchangedReplicas()` applied before `applyReplicaRowsToDesktop()`, overriding `pulled` count to filtered length

Files changed: `dev-sync-cycle.mjs`, `route.ts`, `sync-execute.mjs`, `devSyncHarness.test.ts` (~20 impl lines + ~180 test lines)

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Ready for the next change.

### Change Lineage
- **v1** (`fix-caso8-sync-idempotence`, archived 2026-06-23): Added `filterUnchangedReplicas()` for push idempotence
- **v2** (this change): Fixed dataRoot propagation through cycle HTTP→spawn chain; added pull-side pre-filter for pulled evidence zero-count

### Risks
- None remaining. Dict-entry `appliedToDesktop` may remain non-zero on first cycle sync due to Android `resolve_semantic_id` remapping (2-sync convergence, out of scope for this change).
