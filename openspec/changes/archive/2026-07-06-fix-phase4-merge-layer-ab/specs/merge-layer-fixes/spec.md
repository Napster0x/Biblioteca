# Delta for merge-layer-fixes

**Change**: fix-phase4-merge-layer-ab
**Parent spec**: `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` (Phase 4, Cases 21a–21d)
**Purpose**: Fix two product bugs discovered during Phase 4 real-device verification that prevent correct CRDT dedup (A1) and book metadata LWW (A2).

---

## ADDED Requirements

### Requirement: A1 — HLC Counter Preserved Through Rust↔JS Serialization

The `visible_repo.rs` serialization path MUST preserve the full HLC tuple `(physical, counter, nodeId)` of `ReplicaRow.updated_at_ts` through JSON. `to_js_datetime()` or any helper MUST NOT convert HLC to JavaScript Date (truncates counter to zero). The Rust HLC gate MUST compare `(physical, counter)` as a total order.

#### Scenario: ReplicaRow JSON round-trip preserves counter

- GIVEN a `ReplicaRow` with `updated_at_ts = "2026-07-06T12:00:00.000Z#1000"` (counter=1000)
- WHEN the row is serialized to JSON via `serde_json` and deserialized back to `ReplicaRow`
- THEN the deserialized `updated_at_ts` MUST contain `#1000`
- AND the counter MUST NOT be truncated to `#0`

#### Scenario: HLC gate accepts counter-different concurrent edits

- GIVEN `_replicas.updated_at_ts = "2026-07-06T12:00:00.000Z#1"` and incoming row same ms with `#2`
- WHEN the Rust HLC gate compares `incoming > existing`
- THEN the incoming row is ACCEPTED (counter#2 > counter#1)
- AND the row MUST NOT be falsely skipped as equal-or-older

**PASS**: After fix, two devices editing text/note at same millisecond converge to one row. No duplicate annotations, dictionary entries, or quotes.

**WARN**: Counter preserved but evidence of full HLC tuple not captured in test output.

**FAIL**: Duplicate rows on either device after concurrent same-field edit. HLC gate logs show `incoming <= existing` for rows with different counters.

**Files affected**:
- `src-tauri/src/visible_repo.rs` — `push()` / `serve_get_replicas()` serialization path, `to_js_datetime()` helper

**Test requirements**:
1. Rust test: round-trip `ReplicaRow` with known counter → verify counter survives `serde_json` round-trip
2. Rust test: create two `ReplicaRow` with same physical time, counter#1 and counter#2 → verify HLC gate comparison returns `Ordering::Less` / `Ordering::Greater` correctly
3. JS/Rust integration: verify full Phase 4 suite Cases 21a, 21b, 21d pass

### Requirement: A2 — Book Metadata Merge Uses HLC Ordering

`mergeRemoteBookMetadata()` in `sync-execute.mjs` MUST compare `updatedAt` values using HLC-aware total ordering. When `updatedAt` is a Unix millisecond (integer), the system MUST additionally consider replica timestamps or device-level HLC as secondary ordering to prevent arrival-order wins.

#### Scenario: Higher HLC title wins over later arrival

- GIVEN Android sets `L.title = "Android Title"` at HLC=14 and Desktop sets `L.title = "Desktop Title"` at HLC=9
- WHEN `mergeRemoteBookMetadata()` compares the two
- THEN the resolved title is `"Android Title"` (HLC=14 > 9)
- AND the book that arrived later MUST NOT win by arrival order

#### Scenario: Equal timestamps use deterministic tiebreaker

- GIVEN both devices set title at same `updatedAt` millisecond
- WHEN `mergeRemoteBookMetadata()` compares equal timestamps
- THEN the system uses a secondary field (e.g., `deviceId` or replica timestamp nodeId) as tiebreaker
- AND the winner is deterministic across repeated runs

**PASS**: Case 21c converges to the title with higher HLC. If both have same `updatedAt`, tiebreaker produces stable winner.

**WARN**: Title converged but HLC ordering evidence incomplete (only arrival order visible in logs).

**FAIL**: Title with lower HLC wins because it arrived later. Or title flip-flops between syncs (non-deterministic tiebreak).

**Files affected**:
- `scripts/sync-execute.mjs` — `mergeRemoteBookMetadata()` function
- `scripts/__tests__/sync-execute.test.mjs` — unit tests for A2

**Test requirements**:
1. JS unit test: `mergeRemoteBookMetadata` with local HLC=9, remote HLC=14 → remote wins
2. JS unit test: `mergeRemoteBookMetadata` with local HLC=14, remote HLC=9 → local wins
3. JS unit test: equal `updatedAt` timestamps → deterministic tiebreaker (verify same winner across 10 calls)
4. Integration test: Case 21c end-to-end — Android edits title at higher HLC, Desktop edits at lower HLC, sync → title matches higher HLC

## MODIFIED Requirements

### Requirement: Case 21 Same-field Edit

No scenarios are removed or modified. The existing Case 21 verdict criteria are correct. The A1 fix makes implementation match specification. The A2 fix is in the MERGE direction only (remote→local); `pushBooks()` LWW in push direction is unaffected.
