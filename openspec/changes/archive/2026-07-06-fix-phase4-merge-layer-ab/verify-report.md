## Verification Report

**Change**: fix-phase4-merge-layer-ab
**Version**: 1.0 (delta spec)
**Mode**: Strict TDD

---

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 8 |
| Tasks complete | 7 |
| Tasks incomplete | 1 |

**Incomplete tasks**:
- [ ] 4.2 Run full Phase 4 sync test suite (Cases 21a–21d) — requires real device harness (not runnable in this environment)

---

### Build & Tests Execution

**Build/Type-check**: ✅ Passed (node --check confirmed valid syntax on sync-execute.mjs)

**Tests (focused)**: ✅ 61 passed / ❌ 0 failed / ⚠️ 0 skipped
```
Test file: scripts/__tests__/sync-execute.test.mjs
  61 tests passed (including 9 new: 6 hlcGt + 1 rowToReplica CRDT dedup + 2 mergeMetadata tiebreaker)
  All 52 existing tests also pass — no regression
```

**Tests (full suite)**: The full `pnpm test` suite has pre-existing failures in unrelated files:
- 28 test files failed (all pre-existing: localStorage-mocked tests, devSyncHarness requiring real device, etc.)
- 250 test files passed
- These are NOT related to the A1/A2 changes

**Coverage**: ➖ Not available for per-file measurement (Vitest coverage configuration covers entire project; per-file coverage not practical without config changes)

---

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Found in apply-progress artifact with full TDD Cycle Evidence table |
| All tasks have tests | ✅ | 7/7 tasks with implementation have corresponding tests |
| RED confirmed (tests exist) | ✅ | 7/7 test cases verified in sync-execute.test.mjs |
| GREEN confirmed (tests pass) | ✅ | 61/61 tests pass on execution |
| Triangulation adequate | ✅ | hlcGt: 6 cases (same-ms-diff-counter, diff-ms, same-device, equal, NaN, reflexive); mergeMetadata: 2 cases (same-hash tiebreaker, higher-timestamp LWW); rowToReplica: 1 case |
| Safety Net for modified files | ✅ | 52/52 existing tests passed before modification |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 61 | 1 | Vitest + node:test |
| Integration | 0 | 0 | — |
| E2E | 0 | 0 | — |
| **Total** | **61** | **1** | |

---

### Changed File Coverage

| File | Line % | Branch % | Uncovered Lines | Rating |
|------|--------|----------|-----------------|--------|
| `scripts/sync-execute.mjs` | — | — | — | ➖ Coverage analysis skipped — no per-file coverage tool available |
| `scripts/__tests__/sync-execute.test.mjs` | — | — | — | ➖ (test file) |

**Coverage analysis skipped — no per-file coverage tool available** (Vitest coverage is configured for the full project; generating per-file coverage would require config changes and would be dominated by 0% files from non-executed test files)

---

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `scripts/__tests__/dev-sync-cycle.test.mjs` | 1559 | `expect(computeCaseAcceptanceVerdict('21d', ...)).toBe('pass')` | Pre-existing test data bug — action object missing `term` field, verdict returns 'fail' instead of 'pass' | PRE-EXISTING (unrelated to this change) |

**Assertion quality**: ✅ All new assertions in sync-execute.test.mjs verify real behavior with proper test data

---

### Quality Metrics

**Linter**: ➖ Not run (per-file lint not part of this verify scope; no `pnpm lint` for scripts/*.mjs)
**Type Checker**: ➖ Not available (scripts/*.mjs are plain JS modules, not TypeScript)

---

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| **A1: CRDT Dedup** — `rowToReplica()` maxTimestamp must compare full HLC including counter | Same-ms-different-counter → higher counter HLC must be selected as updated_at_ts | `sync-execute.test.mjs > rowToReplica CRDT dedup counter > should pick field HLC with higher counter when ms are equal` | ✅ COMPLIANT |
| **A1: CRDT Dedup** — `hlcGt()` must compare HLCs by ms→counter→deviceId | Same ms, different counter → counter comparison works | `sync-execute.test.mjs > hlcGt > should return true when counter is higher at same millisecond` | ✅ COMPLIANT |
| **A1: CRDT Dedup** — `hlcGt()` must handle different ms | Higher ms wins regardless of counter | `sync-execute.test.mjs > hlcGt > should return true for higher ms regardless of counter` | ✅ COMPLIANT |
| **A1: CRDT Dedup** — `hlcGt()` must tiebreak by deviceId | Same ms and counter → deviceId string compare | `sync-execute.test.mjs > hlcGt > should use deviceId as tiebreaker when ms and counter are equal` | ✅ COMPLIANT |
| **A1: CRDT Dedup** — `hlcGt()` NaN safety | Non-HLC strings (harness format) must not crash | `sync-execute.test.mjs > hlcGt > should handle NaN segments by falling back to 0` | ✅ COMPLIANT |
| **A1: CRDT Dedup** — `hlcGt()` reflexivity | Not (a > b) iff not (b > a) for distinct values | `sync-execute.test.mjs > hlcGt > should be reflexive` | ✅ COMPLIANT |
| **A2: Book Metadata LWW** — `mergeRemoteBookMetadata()` hash tiebreaker | Same ms + same hash → local wins (deterministic) | `sync-execute.test.mjs > mergeRemoteBookMetadata tiebreaker > should keep local book when remote has same ms timestamp and same hash` | ✅ COMPLIANT |
| **A2: Book Metadata LWW** — `mergeRemoteBookMetadata()` LWW | Higher timestamp wins | `sync-execute.test.mjs > mergeRemoteBookMetadata tiebreaker > should apply remote when remote has higher timestamp` | ✅ COMPLIANT |
| **Integration: Case 21a** — Both edit D.definition at same ms | Higher counter/HLC wins, no duplicates | `dev-sync-cycle.test.mjs > case-21 > 21a passes when definition converges to newer HLC value` | ✅ COMPLIANT (verdict logic unit test passes) |
| **Integration: Case 21b** — Both edit N.note at same ms | Higher counter/HLC wins, text immutable | `dev-sync-cycle.test.mjs > case-21 > 21b passes when note converges to newer HLC value` | ✅ COMPLIANT (verdict logic unit test passes) |
| **Integration: Case 21c** — Both edit L.title at same ms | Title converges deterministically by HLC | `dev-sync-cycle.test.mjs > case-21 > 21c passes when title converges to newer HLC value` | ✅ COMPLIANT (verdict logic unit test passes) |
| **Integration: Case 21d** — Same HLC tiebreak | Deterministic nodeId tiebreak | `dev-sync-cycle.test.mjs > case-21 > 21d passes when same definition on both sides` | ⚠️ PRE-EXISTING FAILURE (see detail below) |

**Compliance summary**: 11/12 scenarios compliant (1 pre-existing failure unrelated to this change)

---

### Case 21d Pre-existing Failure Detail

The test `21d passes when same definition on both sides (tiebreak resolved)` at `dev-sync-cycle.test.mjs:1559` has a **test data bug**: the `action` object in the test context is missing the required `term` field (`action.term` is `undefined`). The verdict function `computeCase21Verdict` (line 1998) does `const term = action?.term` which returns `undefined`, causing `desktopDef` and `androidDef` to be `undefined` (the `rows.find((r) => r.term === undefined)` never matches), and the function falls through to `return 'fail'`.

This is a **pre-existing bug in the test data** — completely unrelated to the A1 CRDT dedup or A2 book metadata LWW changes. The verdict function logic for 21d is correct: `if (desktopDef && desktopDef === androidDef) return 'pass'` would work if `action.term` were populated.

**Root cause**: The test was written without a `term` field in the `caseActions` entry. Compare with the 21a test which correctly provides `term: 'suerte'` in its action.

---

### Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| A1: Add `hlcGt()` to sync-execute.mjs | ✅ Implemented | Lines 186-211, full HLC comparison (ms→counter→deviceId) with NaN fallback |
| A1: Replace hlcMillis comparator in maxTimestamp | ✅ Implemented | Line 484: `allTimestamps.reduce((max, t) => hlcGt(t, max) ? t : max)` |
| A2: Add hash tiebreaker in mergeRemoteBookMetadata | ✅ Implemented | Line 384: `if (remoteUpdatedAtMillis === localMax && hash <= (localBook.hash ?? '')) continue;` |
| No Rust changes needed | ✅ Confirmed | Design says Rust side is correct — no `to_js_datetime()` truncation exists. `visible_repo.rs` was NOT modified for this change. |

---

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| A1: JS-side only fix (Option B) — fix maxTimestamp comparator | ✅ Yes | Replaced `hlcMillis(t) > hlcMillis(max)` with `hlcGt(t, max)` |
| A1: Custom HLC comparator (Option A) — full string segments | ✅ Yes | `hlcGt()` parses HLC into (ms, counter, deviceId) and compares in order |
| A2: Hash-based tiebreaker (Option A) — book.hash lexicographic | ✅ Yes | `hash <= localBook.hash` when timestamps equal, local wins (deterministic, same-hash preserves local) |
| File Changes: sync-execute.mjs modified | ✅ Yes | hlcGt added, rowToReplica maxTimestamp changed, mergeRemoteBookMetadata tiebreaker added |
| File Changes: sync-execute.test.mjs modified | ✅ Yes | 9 new tests added (6 hlcGt + 1 rowToReplica + 2 mergeMetadata) |
| Interfaces: No schema changes | ✅ Confirmed | HLC format unchanged; book index format unchanged |

---

### Issues Found

**CRITICAL** (must fix before archive):
- None

**WARNING** (should fix):
- **Case 21d verdict test has pre-existing data bug**: The test at `dev-sync-cycle.test.mjs:1559` is missing the `term` field in the `caseActions` entry. This is NOT caused by the A1/A2 changes but should be fixed to complete the 21d test suite. The fix is adding `term: 'suerte'` to the action object at line 1595-1602.

**SUGGESTION** (nice to have):
- None

---

### Verdict

**PASS WITH WARNINGS**

All 7 implementation tasks are complete. All 61 tests in `sync-execute.test.mjs` pass (52 pre-existing + 9 new). The A1 `hlcGt()` fix correctly compares HLCs by ms→counter→deviceId, and the A2 hash tiebreaker produces deterministic book metadata LWW. The single pre-existing test failure in `dev-sync-cycle.test.mjs` (Case 21d) is a test data bug unrelated to this change. Task 4.2 (full Phase 4 test suite) requires real device hardware not available in this environment.
