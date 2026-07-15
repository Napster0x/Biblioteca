# Design: fix-phase4-merge-layer-ab

## Technical Approach

Two independent fixes for product bugs in the Phase 4 sync merge layer:

**A1 (CRDT Dedup)**: The HLC counter is lost during JS-side replica reconstruction in `rowToReplica()`, not in Rust serde. The `maxTimestamp` selection uses `hlcMillis()` which only compares physical time — two HLCs at the same ms with different counters appear equal, and the accumulator (first in iteration order) wins regardless of counter. On push-back to Android, `updated_at_ts` may have counter=1 (reconstructed via `toHlc(numericInt)`) when the original HLC had counter=N > 1. The Rust HLC gate correctly compares full HLC including counter, so it sees `incoming <= existing` and skips the upsert, producing duplicates.

**A2 (Book Metadata LWW)**: `mergeRemoteBookMetadata()` compares `localBookMaxMillis < remoteUpdatedAtMillis` — bare Unix ms with no tiebreaker. Equal timestamps resolve by arrival order (non-deterministic). No HLC or secondary field is consulted.

Reference: Spec cases 21a/21b/21d (A1) and 21c (A2).

## Architecture Decisions

### Decision: A1 fix scope — JS side only, no Rust changes

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Option A**: Change `toHlc()` to preserve counter info | Changes HLC format, breaks existing consumers | ❌ Rejected |
| **Option B**: Fix `maxTimestamp` comparator + `toHlc()` fallback path | Self-contained, no schema change | ✅ **Chosen** |
| **Option C**: Full Rust→JS HLC serialization fix | Unnecessary — Rust side already correct (no `to_js_datetime` exists) | ❌ Rejected |

**Rationale**: The Rust side serializes `updated_at_ts: String` as a plain JSON string via serde — no datetime conversion, no counter loss. The proposal's speculated `to_js_datetime()` does not exist. The actual bug is in JS `rowToReplica()` at two points: (1) `maxTimestamp` reduction uses `hlcMillis()` which ignores the counter, and (2) `fallbackTimestamp` from `toHlc(integer)` always resets counter to `00000001`. Fixing these two JS functions is the minimal, correct change.

### Decision: A1 maxTimestamp comparator — use custom HLC comparison

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Option A**: Compare full HLC string lexicographically | Works because same format has fixed-width segments | ✅ **Chosen** — simplest, no new code |
| **Option B**: Parse counter and compare segmentally | More explicit but duplicates Rust `hlc_gt()` logic | ❌ Rejected — overkill |
| **Option C**: Use `replica_timestamps` field counts as tiebreak | Indirect, fragile | ❌ Rejected |

**Rationale**: HLC strings in this system use fixed-width hex segments (13-8-n). Lexicographic comparison is equivalent to numeric comparison for same-format strings. The fix: replace `hlcMillis(t) > hlcMillis(max)` with a proper HLC comparator function on the JS side or simply use lexicographic string `>`.

### Decision: A2 tiebreaker — deterministic lexicographic hash

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Hash-based**: Compare `book.hash` lexicographically when timestamps equal | Stable, no new data needed | ✅ **Chosen** |
| **Device-based**: Add device ID to book metadata | Schema change, needs backend work | ❌ Rejected |
| **Accept arrival-order LWW for equal ms | Non-deterministic, violates spec | ❌ Rejected |

**Rationale**: Book metadata from `/books/index` has no HLC. Adding HLC would require a Rust-side change to `/books/index` and a server version bump. Using `book.hash` as tiebreaker is zero-cost (already present), deterministic, and converges to the same winner on both sides.

## Data Flow

### A1 — Current (broken)

```text
Desktop rowToReplica():
  fieldTimestamps = [T-00000002-android, T-00000001-android]
  fallbackTimestamp = toHlc(UnixMs) = T-00000001-visible
  allTimestamps = [T-00000001-visible, T-00000002-android, T-00000001-android]

  max = allTimestamps.reduce((m,t) => hlcMillis(t) > hlcMillis(m) ? t : m)
  // hlcMillis(T-00000001-visible) = T
  // hlcMillis(T-00000002-android) = T  (SAME — accumulator stays)
  // result: max = T-00000001-visible  ← COUNTER LOST!

Android HLC gate:
  hlc_gt(T-00000001-visible, existing=T-00000002-android) → false → SKIP → DUPLICATE
```

### A1 — Fixed

```text
Desktop rowToReplica():
  // maxTimestamp comparison uses full HLC string
  max = allTimestamps.reduce((m,t) => hlcGt(t, m) ? t : m)
  // hlcGt(T-00000002-android, T-00000001-visible) → true (counter 2 > 1)
  // result: max = T-00000002-android  ← COUNTER PRESERVED

Android HLC gate:
  hlc_gt(T-00000002-android, existing=T-00000002-android) → false (same HLC) → SKIP ← CORRECT
  // OR if field was locally edited:
  hlc_gt(T-00000003-desktop, existing=T-00000002-android) → true → UPSERT ← CORRECT
```

### A2 — Fixed

```text
mergeRemoteBookMetadata():
  if (remoteUpdatedAtMillis > localBookMaxMillis(localBook)) → remote wins
  if (remoteUpdatedAtMillis === localBookMaxMillis(localBook)) → tiebreak
    tiebreak = remoteBook.hash > localBook.hash
    if tiebreak → remote wins (deterministic)
    else → local stays
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Fix `rowToReplica()` maxTimestamp comparator; add `hlcGt()` |
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Fix `mergeRemoteBookMetadata()` tiebreaker |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modify | Add tests for A1 and A2 fixes |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | No change | Rust side is correct — no `to_js_datetime()` exists |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Verify | Case 21 should pass after fix |

## Interfaces / Contracts

No schema changes. The JSON format for `ReplicaRow.updated_at_ts` remains a plain HLC string. Book index entries remain Unix ms integers.

### New JS function: `hlcGt(a, b)`

```javascript
function hlcGt(a, b) {
  // Full HLC comparison: physical time, then counter, then deviceId
  const parse = (s) => {
    const parts = String(s ?? '').split('-');
    return { ms: Number.parseInt(parts[0], 16) || 0, cnt: Number.parseInt(parts[1], 16) || 0, dev: parts.slice(2).join('-') || '' };
  };
  const pa = parse(a), pb = parse(b);
  if (pa.ms !== pb.ms) return pa.ms > pb.ms;
  if (pa.cnt !== pb.cnt) return pa.cnt > pb.cnt;
  return pa.dev > pb.dev;
}
```

### Modified: `rowToReplica()` maxTimestamp

Replace:
```javascript
const maxTimestamp = allTimestamps.reduce((max, t) => hlcMillis(t) > hlcMillis(max) ? t : max);
```
With:
```javascript
const maxTimestamp = allTimestamps.reduce((max, t) => hlcGt(t, max) ? t : max);
```

### Modified: `mergeRemoteBookMetadata()` tiebreaker

After the `<=` comparison, add:
```javascript
if (remoteUpdatedAtMillis === localBookMaxMillis(localBook)) {
  // Same ms — use hash as deterministic tiebreaker
  if (remoteBook.hash <= localBook.hash) continue;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (JS) | `hlcGt()` function | Same-ms-different-counter, different-ms, same-ms-same-counter-different-device |
| Unit (JS) | `rowToReplica()` maxTimestamp | Field HLCs with same ms but higher counter produce correct `updated_at_ts` |
| Unit (JS) | `mergeRemoteBookMetadata()` tiebreaker | Same `updatedAt` ms + same hash (equal) → no change; same ms + higher hash → remote wins |
| Integration | Case 21a/21b/21d | Both devices edit same field at same ms → no duplicates, higher HLC wins |
| Integration | Case 21c | Both devices edit L.title at same ms → title converges deterministically |
| Rust | Verify no change needed | Run existing Rust test suite to confirm no regression |

## Migration / Rollout

No data migration required. The fix is in computation logic only:
- `rowToReplica()` now selects the correct max HLC — previously pushed rows with lost counters will be self-corrected on next push (they'll have the correct counter from `replica_timestamps`)
- `mergeRemoteBookMetadata()` now has a deterministic tiebreaker — previously merged books with equal timestamps are unchanged, future merges converge

Rollback: revert both changes in `sync-execute.mjs`.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `hlcGt()` changes behavior for non-HLC strings (e.g., harness "T100") | Low | False filter match | `hlcGt` falls back to 0 for unparseable segments; test harness strings use "T" prefix which produces `NaN` → 0 → comparison falls back to deviceId string compare |
| `maxTimestamp` now picks field HLCs over fallback more aggressively | Medium | Different `updated_at_ts` values on push | This is the DESIRED behavior — field HLCs have the correct counter |
| Tiebreaker changes which book wins on merge | Low | Different winner than before for equal ms | Previously non-deterministic (arrival order); now deterministic — this is a strict improvement |
| Counter-preserved replicas may be larger than before | None | No payload size change | `updated_at_ts` is the same format (always was a string); no encoding change |

## Open Questions

- [ ] Are there other places in the JS codebase that compare HLCs using `hlcMillis()`? (Checked: `sync-execute.mjs` line 453 is the only place in push path; `sync-filter-standalone.mjs` uses string `>=` which is correct)
- [ ] Does the desktop's `pushBooks()` for book metadata have the same counter-loss issue? (No — books use integer timestamps from `/books/index`, not HLC. A2 is the correct fix scope.)
