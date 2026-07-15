# Apply Progress: Case 15 — Same Book From Both Devices

**Status:** ✅ ALL PHASES COMPLETE — 11/11 tasks done
**Real-device verification:** 25/25 PASS (100%), all 5 scenarios exceed >80% threshold

## Changes Made

### assert-engine.mjs — New assertion helpers (lines 338–410)

- **`assertBookCount(expected, deviceState)`** — Counts live books (where `deletedAt` is null/undefined). Returns `{verdict, failures}`.
- **`assertMetadata(hash, field, expectedValue, deviceState)`** — Finds a book by hash (checks both `hash` and `bookHash` fields). Verifies field value matches. Returns `{verdict, failures}`.

Both functions handle null/undefined/missing state gracefully without crashing.

### dev-sync-cycle.mjs — Case-15 verdict handlers

Added `computeCase15Verdict()` function and `countHashes()` helper, integrated into `computeCaseAcceptanceVerdict`:

| Case | Pre-condition | Post-condition check | Verdict |
|------|--------------|---------------------|---------|
| **15a** | Desktop has book L(hash), Android empty | Both sides have exactly 1 copy of L | pass/warn/fail |
| **15b** | Android has book L(hash), Desktop empty | Both sides have exactly 1 copy of L | pass/warn/fail |
| **15c** | Both have same book L(hash) independently | Both sides have exactly 1 copy of L | pass/warn/fail |
| **15d** | Both have same book, both edited offline | Same title on both, updatedAt newer than pre on both | pass/warn |
| **15e** | Desktop has AAA, Android has BBB, same title | Both hashes on both sides, >=2 books each | pass/warn/fail |

### dev-sync-cycle.test.mjs — 20 new tests (33 total, all passing)

- **assertBookCount** (5 tests): 0 books, matching count, count mismatch, live vs deleted, missing array
- **assertMetadata** (5 tests): matching hash+field, bookHash lookup, book not found, field mismatch, missing array
- **case-15 verdicts** (10 tests): 15a pass/warn/fail, 15b pass, 15c pass/warn, 15d pass/warn, 15e pass/warn

## Test Results

```
dev-sync-cycle.test.mjs: 33 pass, 0 fail
assert-engine.test.mjs:  17 pass, 0 fail (no regressions)
```

## Key Design Decisions

1. **deletedAt semantics**: `null` and `undefined` both mean "not deleted" (live). Only a truthy timestamp value means deleted. Consistent with existing `isDeleted()` in assert-engine.mjs.
2. **No fixture actions for 15a-15e**: These case-refs are passive verdict checks, not active fixture executions. They derive hashes from pre-state and verify post-state convergence.
3. **Phase 2 handlers preserve all existing behavior**: 9Ma, 13Ma, 14a/14b/14c/14Ma/14Mb/14Mc unchanged. The 15a-15e injection point is between 14 handlers and `return undefined`.
4. **assertion helpers operate on `deviceState.books`** array, matching the existing state capture format.
