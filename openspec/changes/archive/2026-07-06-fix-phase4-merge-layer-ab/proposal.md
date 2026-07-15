# Proposal: fix-phase4-merge-layer-ab

## Intent

Fix confirmed product bugs in the Phase 4 merge layer that cause data loss/corruption during sync:
**A1**: CRDT dedup broken — HLC counter truncated across Rust↔JS boundary, causing duplicate annotations/quotes/dictionary-entries when both devices edit the same field concurrently.
**A2**: Book metadata LWW broken — `mergeRemoteBookMetadata` compares `updatedAt` in Unix ms without HLC, causing silent metadata loss when concurrent edits arrive.

## Scope

### In Scope
- Fix A1: Preserve HLC counter through JS boundary in `visible_repo.rs`
- Fix A2: Use HLC or monotonic timestamp comparison in `mergeRemoteBookMetadata()` in `sync-execute.mjs`
- Tests for both fixes (Rust unit tests + JS unit tests)
- Update harness Case 21 verdict assertions if needed

### Out of Scope
- Bug B (tombstone propagation) — needs investigation first, suspected correct LWW behavior
- Group C (harness bugs) — already fixed and archived
- Any other CRDT or LWW paths not in A1/A2 scope

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: CRDT dedup behavior for concurrent same-field edits — the HLC gate MUST NOT reject legitimate concurrent edits when the counter differs at the same millisecond. Book metadata merge MUST use proper ordering (not arrival order).

## Approach

### A1 — Preserve HLC counter through JS boundary
1. In `visible_repo.rs` (`push()` / `serve_get_replicas()`), ensure `updated_at_ts` is serialized as a full HLC string (not truncated to Date).
2. Verify that `serde_json` serialization of `ReplicaRow.updated_at_ts: String` preserves the HLC counter in the JSON payload.
3. If any Rust helper truncates HLC → ms before JS delivery, remove or bypass it.
4. Add a Rust test that round-trips a ReplicaRow with known counter and verifies the counter survives serialization → deserialization.

### A2 — Book metadata LWW with HLC
1. In `mergeRemoteBookMetadata()` (`sync-execute.mjs`), replace bare Unix ms comparison with HLC-aware ordering.
2. When both local and remote books have the same `updatedAt` ms, use a secondary field (e.g., `deviceId` or `replica_timestamps`) as tiebreaker.
3. Add JS unit tests for tiebreak scenarios (equal timestamps, different device IDs).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src-tauri/src/visible_repo.rs` | Modified | Fix HLC counter truncation in serialization path |
| `scripts/sync-execute.mjs` | Modified | Fix `mergeRemoteBookMetadata` HLC comparison |
| `scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | Update Case 21 verdict assertions if semantics change |
| `scripts/__tests__/sync-execute.test.mjs` | Modified | Add A2 unit tests |
| `src-tauri/src/visible_repo.rs` (tests) | Modified | Add A1 round-trip test |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| A1 fix affects all 4 CRDT kinds (not just Case 21) | High | Run full Phase 3+4 test suite after fix |
| A1 fix changes HLC serialization format → JS parsing breaks | Low | Verify `hlcMillis` / `toHlc` accept new format |
| A2 fix may conflict with existing `updatedAt` sort order in pushBooks | Low | A2 only modifies merge side, pushBooks unchanged |

## Rollback Plan

1. Revert `visible_repo.rs` changes — CRDT dedup returns to current behavior (data corruption risk for concurrent edits).
2. Revert `mergeRemoteBookMetadata` changes — book metadata falls back to arrival-order LWW.
3. Run full Phase 4 suite to verify no regression.

## Dependencies

None. A1 and A2 are completely independent — can be done in any order.

## Success Criteria

- [ ] Case 21a (both edit D.definition) passes: HLC gate accepts both edits, higher HLC wins
- [ ] Case 21b (both edit N.note) passes: HLC gate preserves counter, concurrent edits merge
- [ ] Case 21c (both edit L.title) passes: book metadata converges by HLC, not arrival order
- [ ] Case 21d (same HLC → tiebreak) passes: row-level tiebreak works deterministically
- [ ] Rust test: ReplicaRow with known counter round-trips through serialization without counter loss
- [ ] JS test: `mergeRemoteBookMetadata` with equal `updatedAt` uses tiebreaker correctly
