## Change Archived

**Change**: `fix-caso3-dictionary-sync-android-receive`
**Date**: 2026-06-23
**Archived to**: `openspec/changes/archive/2026-06-23-fix-caso3-dictionary-sync-android-receive/`
**Persisted to**: Engram + OpenSpec (hybrid)

---

### Artifact Observation IDs (Engram Traceability)

| Artifact | Engram ID |
|----------|-----------|
| proposal | #1085 |
| spec (delta) | #1087 |
| design | #1089 |
| tasks | #1091 |
| apply-progress | #1093 |
| verify-report | #1096 |
| archive-report | this observation |

---

### Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `sync-crdt-hlc-real-device-harness` | Updated | 3 requirements added: Desktop Dictionary Replica Transport, Distinct Book and Dictionary Evidence, Caso 3 End-to-End Dictionary Receive Pass (6 scenarios total) |

---

### Archive Contents

- ✅ proposal.md
- ✅ exploration.md
- ✅ design.md
- ✅ specs/sync-crdt-hlc-real-device-harness/spec.md (delta)
- ✅ tasks.md (10/10 tasks complete)
- ✅ apply-progress.md
- ✅ verify-report.md (PASS verdict)

---

### Source of Truth Updated

`openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` now contains 17 requirements total (14 original + 3 added).

---

### Completed Tasks Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| 1: RED Tests | 1.1, 1.2, 1.3 | ✅ |
| 2: GREEN Implementation | 2.1, 2.2, 2.3, 2.4 | ✅ |
| 3: REFACTOR + Continuations | 3.1, 3.2, 3.3, 3.4, 3.5 | ✅ |
| 4: Harness Verification | 4.1 | ✅ (real-device Caso 3 PASS) |

---

### Files Changed

| File | Action |
|------|--------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified — dictionary replica collection, mapping, transport |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modified — raw array response normalization |
| `apps/readest-app/scripts/dev-sync-reset.mjs` | Modified — Android runtime reset endpoint call |
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modified — guarded `/__dev/reset` route |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Modified — `clear_dev_state()` hook |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified — 7 new/adjusted tests |
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Updated — 3 requirements added |

---

### SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. All 6 spec scenarios compliant. Real-device Caso 3 PASS. Ready for the next change.
