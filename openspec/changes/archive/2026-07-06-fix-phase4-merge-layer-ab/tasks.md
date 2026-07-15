# Tasks: Fix Phase 4 Merge Layer (A1 + A2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~80–95 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Fix A1 (CRDT dedup) + A2 (book metadata LWW) | Single PR | Tests written first (TDD); ~95 lines total |

## Phase 1: Test-First — A1 CRDT Dedup (RED)

- [x] 1.1 Add `hlcGt()` tests in `apps/readest-app/scripts/__tests__/sync-execute.test.mjs`: same-ms-diff-counter, diff-ms, same-ms-same-counter-diff-device
- [x] 1.2 Add `rowToReplica` test: field HLCs at same ms with counter N+1 produce higher `updated_at_ts` than counter N

## Phase 2: Test-First — A2 Book Metadata LWW (RED)

- [x] 2.1 Add `mergeRemoteBookMetadata` test: equal `updatedAt` ms → `book.hash` tiebreaker selects deterministic winner
- [x] 2.2 Add `mergeRemoteBookMetadata` test: higher HLC wins over later-arriving lower HLC

## Phase 3: Implementation — A1 + A2 (GREEN)

- [x] 3.1 Add `hlcGt(a, b)` function to `apps/readest-app/scripts/sync-execute.mjs` — parse HLC segments (ms, counter, deviceId), compare in order, fallback to 0 for NaN
- [x] 3.2 Replace `hlcMillis(t) > hlcMillis(max)` at line 453 with `hlcGt(t, max)` in `rowToReplica()`
- [x] 3.3 Modify `mergeRemoteBookMetadata()` at line 353: when `remoteUpdatedAtMillis === localBookMaxMillis(localBook)`, compare `book.hash` lexicographically as tiebreaker

## Phase 4: Verification

- [x] 4.1 Run `pnpm test` — all unit tests pass (both old and new)
- [ ] 4.2 Run full Phase 4 sync test suite (Cases 21a–21d) — all pass (requires real device harness)
