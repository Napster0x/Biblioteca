# Archive Report — Phase 4: Conflictos Reales (Real Conflicts)

**Change**: `road-phase-4-real-conflicts`
**Archived to**: `openspec/changes/archive/2026-07-05-road-phase-4-real-conflicts/`
**Archive date**: 2026-07-05
**SDD Cycle**: Complete ✅

---

## Change Summary

Phase 4 (🏅 Capa 4 — Conflictos Reales) tests the sync system under true concurrent conflict: both devices edit the same field, delete vs edit the same datum, or create structurally invalid highlight-group relationships. Implementation covers 6 case families (21–26) with 14 sub-cases total, delivered across 2 stacked PRs.

## What Was Implemented

### Cases (14 sub-cases across 6 families)

| Case | Description | Sub-cases | Status |
|------|-------------|-----------|--------|
| 21 — Same-field edit | LWW by HLC for same editable field on same entity | 21a (D.definition), 21b (N.note), 21c (L.title), 21d (nodeId tiebreak) | ✅ All implemented |
| 22 — Edit vs delete | HLC-based resolution (delete beats edit / edit beats delete) | 22a (D delete vs edit), 22b (BLOCKED — quotes immutable), 22c (N delete vs edit) | ✅ 2 active + 1 BLOCKED |
| 23 — Concurrent creations | Extends Phase 3 patterns with O⇄M concurrency | 23a-23e (same ID, different IDs, same word, same range, different books) | ✅ All implemented |
| 24 — Distinct annotations same range | Two annotations on same CFI range both survive | 24 (single sub-case) | ✅ Implemented |
| 25 — Highlight group mutation | DISCOVER: type integrity — mutation of semantic type | 25 (single sub-case, DISCOVER) | ✅ Observational |
| 26 — Wrong group pointer | DISCOVER: cross-type pointer detection | 26 (single sub-case, DISCOVER) | ✅ Observational |

### Infrastructure

| Component | What was added |
|-----------|---------------|
| `sync-dev-sqlite.mjs` | `captureTable()` extended to return full `rows` array (backward-compatible) |
| `sync-dev-state.mjs` | `queryReplicaKind()` extended to return replica row samples |
| `assert-engine.mjs` | 4 new helpers: `assertFieldValue`, `assertEntityState`, `assertBookNoteIntegrity`, `assertBookNoteType` |
| `dev-sync-fixture.mjs` | 2 new fixture ops: `--booknote-mutate`, `--booknote-invalid-ref` |
| `dev-sync-cycle.mjs` | 6 setup functions (21–26), 6 verdict functions, routing updates |
| Unit tests | 133 cycle tests + 43 fixture tests = 176 total |

## Delivery

### PR Structure

| PR | Contents | Lines |
|----|----------|-------|
| **PR 1** | Infrastructure + Cases 23, 24, 21 | ~440 prod lines |
| **PR 2** | Case 22 + Cases 25-26 DISCOVER + fixture ops + assert helpers | ~210 prod lines |
| **PR 3** (conditional) | Product code fixes if DISCOVER reveals merge-layer type/pointer integrity bugs | TBD |

### Verification Status

| Metric | Result |
|--------|--------|
| Spec compliance | **54/54 scenarios** |
| Cycle tests | **133 passing** |
| Fixture tests | **43 passing** |
| Total tests | **176 passing** |
| CRITICAL | **0** |
| WARNING | **0** |
| SUGGESTION | **3** (minor, documented in verify report) |

**Overall status**: **PASS ✅**

## Engram Artifacts

| Artifact | Topic Key | Observation ID |
|----------|-----------|----------------|
| Proposal | `sdd/road-phase-4-real-conflicts/proposal` | #1499 |
| Spec | `sdd/road-phase-4-real-conflicts/spec` | #1500 |
| Design | `sdd/road-phase-4-real-conflicts/design` | #1501 |
| Tasks | `sdd/road-phase-4-real-conflicts/tasks` | #1502 |
| Apply progress (PR 1 + PR 2) | `sdd/road-phase-4-real-conflicts/apply-progress` | #1503 |
| Verify report | `sdd/road-phase-4-real-conflicts/verify-report` | #1504 |
| Archive report | `sdd/road-phase-4-real-conflicts/archive-report` | (current) |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `sync-crdt-hlc-real-device-harness` | Updated | Phase 4 section appended: 6 cases, 14 sub-cases, edge case policies, verification evidence matrix |

## Source of Truth

The main spec at `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` now reflects Phase 4 behavior alongside existing Phase 1–3 content.

## Remaining Work

- **Real-device verification** for Phase 4 (manual execution on Nothing Phone A065)
- **PR 3** (conditional): Product code fixes if DISCOVER reveals merge-layer type/pointer integrity bugs during real-device execution

## Archive Contents

- `proposal.md` ✅
- `specs/real-conflicts/spec.md` ✅ (delta preserved for audit trail)
- `design.md` ✅
- `tasks.md` ✅ (34/34 tasks complete)
- `archive-report.md` ✅ (this file)
