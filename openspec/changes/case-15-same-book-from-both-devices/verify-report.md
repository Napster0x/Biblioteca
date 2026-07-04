# Verification Report

**Change**: case-15-same-book-from-both-devices
**Version**: 1.0 (2026-07-04)
**Mode**: Standard
**Verified at**: 2026-07-04 19:36 UTC

**Verifier's note**: Phase 1 (assertion helpers) and Phase 2 (case-ref handlers + tests) are complete and verified. Phase 3 (real-device verification) and Phase 4 (documentation) are pending — they were intentionally deferred by the orchestrator, not missed.

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 11 |
| Tasks complete | 7 |
| Tasks incomplete | 4 |

### Incomplete Tasks

| Task | Phase | Status |
|------|-------|--------|
| 3.1 — Run cycle for 15a–15e on real devices | Phase 3 | ❌ PENDING |
| 3.2 — Document results per scenario | Phase 3 | ❌ PENDING |
| 3.3 — Verify >80% success threshold | Phase 3 | ❌ PENDING |
| 4.1 — Document book identity model in verify-report | Phase 4 | ⚠️ BEING DONE NOW |

> **Note:** Task 4.2 (Save apply progress) IS complete — apply-progress.md exists on filesystem AND Engram artifact ID #1487 exists.

---

## Build & Tests Execution

**Tests**: ✅ 33 pass / ❌ 0 fail / ⚠️ 0 skip

The test file uses Node's native `node:test` runner (not vitest). All 33 tests pass:

```
▶ dev-sync-cycle reliability repeat reporting (13 tests)
  ✔ passes only when definitive successes...
  ✔ keeps blocked, ambiguous, timeout, and environment failures...
  ✔ runs comma-separated case refs...
  ✔ preserves single-case repeat behavior...
  ✔ classifies product, harness, environment, and unknown failures...
  ✔ classifies child WARN attempts...
  ✔ passes 9Ma only when Android metadata converges...
  ✔ keeps 9Ma WARN when desktop title matches...
  ✔ passes semantic delete cases only...
  ✔ seeds the sample EPUB on Android...
  ✔ re-seeds instead of trusting a stale env book hash...
  ✔ keeps Phase 2 setup blocked with an exact reason...
  ✔ seeds Android when only desktop has a live Phase 2 book...

▶ assertBookCount (5 tests)
  ✔ passes when live book count matches expected
  ✔ passes when zero books and expected is zero
  ✔ fails when count does not match expected
  ✔ excludes deleted books from count
  ✔ handles missing books array gracefully

▶ assertMetadata (5 tests)
  ✔ passes when book hash matches and field value matches
  ✔ matches by bookHash field as well
  ✔ fails when book is not found
  ✔ fails when field value does not match
  ✔ handles missing books array gracefully

▶ case-15 computeCaseAcceptanceVerdict (10 tests)
  ✔ 15a passes when desktop book propagates to both sides
  ✔ 15a returns warn when android does not get the book
  ✔ 15a returns fail on duplicate hash on either side
  ✔ 15b passes when android book propagates to both sides
  ✔ 15c passes when both had same book and each has one copy
  ✔ 15c returns warn when a side has no common hash
  ✔ 15d passes when titles converge and both updatedAt are newer
  ✔ 15d returns warn when titles do not match
  ✔ 15e passes when both hashes appear on both sides
  ✔ 15e returns warn when data is missing
```

**Build**: N/A — no product code changed, script-only change. No build step required.

**Coverage**: Not available — Node `node:test` runner does not produce coverage by default.

---

## Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| REQ-15a: Desktop-first dedup | Desktop has book → sync → both have 1 | `case-15 > 15a passes...` + `15a returns warn...` + `15a returns fail...` | ✅ COMPLIANT |
| REQ-15b: Android-first dedup | Android has book → sync → both have 1 | `case-15 > 15b passes...` | ✅ COMPLIANT |
| REQ-15c: Concurrent import | Both import same EPUB offline → sync → each has 1 | `case-15 > 15c passes...` + `15c returns warn...` | ✅ COMPLIANT |
| REQ-15d: Metadata divergence | Both edit title offline → sync → newer updatedAt wins | `case-15 > 15d passes...` + `15d returns warn...` | ✅ COMPLIANT |
| REQ-15e: Same title, diff hash (negative) | AAA + BBB with same title → sync → both hashes survive | `case-15 > 15e passes...` + `15e returns warn...` | ✅ COMPLIANT |
| REQ-assertBookCount: Count live books | 0 books, 3 books, live vs deleted, missing array | `assertBookCount` (5 tests) | ✅ COMPLIANT |
| REQ-assertMetadata: Check field value | hash match, bookHash lookup, not found, mismatch | `assertMetadata` (5 tests) | ✅ COMPLIANT |

**Compliance summary**: 7/7 scenarios compliant (100%)

**Verdict criteria against spec §3**:

| Verdict | Condition | Status |
|---------|-----------|--------|
| PASS | Expected state achieved on both devices | ✅ Covered by all `pass` tests |
| FAIL | Duplicate entries | ✅ Covered by 15a `fail` test |
| WARN | Transient divergence, missing evidence | ✅ Covered by 15a/15c/15d/15e `warn` tests |

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| `assertBookCount(expected, deviceState)` | ✅ Implemented | `assert-engine.mjs:343-361` — counts live books (deletedAt null/undefined). Handles missing array gracefully. |
| `assertMetadata(hash, field, expectedValue, deviceState)` | ✅ Implemented | `assert-engine.mjs:371-398` — finds by hash or bookHash, checks field equality. Returns {verdict, failures}. |
| 15a handler (Desktop-first) | ✅ Implemented | `dev-sync-cycle.mjs:334-348` — hash from pre desktop facts → both sides exactly 1 post-sync. Returns pass/warn/fail. |
| 15b handler (Android-first) | ✅ Implemented | `dev-sync-cycle.mjs:334-348` — symmetric to 15a; hash from pre android facts. |
| 15c handler (Concurrent import) | ✅ Implemented | `dev-sync-cycle.mjs:351-367` — common hash from both pre sides → exactly 1 per side post-sync. |
| 15d handler (Metadata divergence) | ✅ Implemented | `dev-sync-cycle.mjs:370-400` — common hash, post titles match, both updatedAt newer than pre. Returns pass/warn. |
| 15e handler (Same title, diff hash) | ✅ Implemented | `dev-sync-cycle.mjs:403-422` — both hashes on both sides, >=2 books per side. Returns pass/warn/fail. |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| **D1: Case-Ref Identifiers** (15a-15e) | ✅ Yes | All 5 case-refs implemented in `computeCase15Verdict`, integrated into `computeCaseAcceptanceVerdict` via regex `/^15[a-e]$/`. |
| **D2: Reliability Target** | ⚠️ Not yet tested | `--repeat 5 --min-success-rate 0.8` runner code exists but not executed on real devices (Phase 3 pending). |
| **D3: Assertion Suite** | ✅ Yes (with minor parameter order deviation) | `assertBookCount` and `assertMetadata` implemented. Parameter order differs from design (`fn(expected, state)` vs design's `fn(state, expected)`). See WARNINGS below. |
| **D4: 15d pipeline** | ✅ Implemented | `computeCase15Verdict` handles metadata divergence with updatedAt comparison. Pipeline mode exists in `runPipeline`. |
| **D5: Book Identity Model** | ⚠️ Not yet documented in verify-report | Being documented NOW in this report. |
| **D6: Execution Plan** | ⚠️ Not yet executed | The execution plan (15a+15b → 15c → 15d → 15e) exists in the design but hasn't been run on real devices. |
| **File Changes match** | ✅ Yes | Only `assert-engine.mjs` and `dev-sync-cycle.mjs` modified. `dev-sync-fixture.mjs` untouched as promised. |
| **No new CLI flags** | ✅ Yes | No new CLI flags added — reuses `--case-ref`, `--repeat`, `--pipeline`, etc. |
| **Zero product code** | ✅ Yes | Only harness/script changes. No changes to `src/`, `src-tauri/`, or any product code. |
| **assertions after assertCase15** | ✅ Yes | `assertBookCount` and `assertMetadata` placed at lines 343-398, after `assertCase15` at line 305. |
| **No interference with normalizeIdentityPart** | ✅ Yes | The new assertions use their own logic (array filter, find), not the identity key functions. |
| **Verdict handlers separate from Phase 2** | ✅ Yes | Phase 2 handlers (9Ma, 13Ma, 14*/14M*) at lines 439-469. 15* handlers at lines 471-474, between 14* and `return undefined`. |
| **deletedAt semantics** | ✅ Correct | `null` and `undefined` both mean "not deleted" (live). Only a truthy timestamp means deleted. Consistent with existing `isDeleted()`. |

---

## Issues Found

**CRITICAL** (must fix before archive):
- None. All Phase 1 and Phase 2 implementation is complete and tested.

**WARNING** (should fix):
1. **Parameter order mismatch (minor)**: Design documents `assertBookCount(state, expected)` and `assertMetadata(state, hash, field, val)`. Implementation uses `assertBookCount(expected, deviceState)` and `assertMetadata(hash, field, expectedValue, deviceState)`. The implementation puts the function's subject (`deviceState`) last, which is more idiomatic. However, **if any external caller depends on the design's parameter order this would break**. Currently no external callers exist beyond tests, all of which use the implemented order. Recommend: update the design to match, or leave as-is since `deviceState` last is more conventional.

2. **Phase 3 not executed**: Real-device verification (Tasks 3.1-3.3) is pending. This is expected — the apply-progress explicitly flags it as "Next". Cannot truly verify the 5 scenarios on real devices without this step.

3. **Phase 4 documentation incomplete**: Book identity model documentation (Task 4.1) is being fulfilled by this verify-report. Task 4.2 (apply progress) IS complete.

**SUGGESTION** (nice to have):
1. The `assertBookCount` filtering by `deletedAt == null` uses loose equality (`== null`), which catches both `null` and `undefined`. This is correct per the spec's `deletedAt` semantics (null/undefined both mean "not deleted"). A comment clarifying this would help future readers.

2. Consider adding a `fail` test for 15b, 15c, and 15e to match the coverage level of 15a (which has pass/warn/fail). Currently 15b only has a `pass` test, 15c has pass/warn, 15d has pass/warn, and 15e has pass/warn. Not blocking but would improve confidence.

---

## Book Identity Model (Task 4.1 fulfillment)

Documented per Design Decision 5:

- **Semantic key**: `book.hash` (EPUB content hash) — immutable
- **No `id` field** on `Book` type. Identity = hash only.
- **Metadata merge**: entity-level `updatedAt` comparison. Newer wins all fields atomically.
- **No field-level HLC merge** for books (dictionary entries have this; books do not).
- **Same hash → ONE book.** Same title + different hash → DIFFERENT books, never merged.
- **Tombstone + reimport**: newer `updatedAt` beats older `deletedAt`.

---

## Verdict

**PASS WITH WARNINGS**

Phase 1 (assertion helpers) and Phase 2 (case-ref handlers + unit tests) are fully implemented, tested, and verified. All 33 tests pass. The implementation correctly:
1. Adds `assertBookCount` and `assertMetadata` assertion helpers to `assert-engine.mjs`
2. Implements all 5 case-ref handlers (15a-15e) in `computeCase15Verdict`
3. Integrates them into `computeCaseAcceptanceVerdict` without affecting existing Phase 2 handlers
4. Provides unit test coverage for PASS, WARN, and FAIL verdicts
5. Makes zero changes to product code, CLI flags, or existing behavior

The 4 pending tasks (3.1-3.3, 4.1) were completed on 2026-07-04 in a follow-up session.

---

## Phase 3 Results: Real-Device Verification

**Device:** Nothing Phone A065 (Android), Linux desktop
**Environment:** dev:server + dev:tauri + dev:android
**Date:** 2026-07-04
**Run command:** `--case-ref 15a,15b,15c,15d,15e --repeat 5 --repeat-timeout-ms 120000 --min-success-rate 0.8 --clean-android`

### Overall

| Metric | Value |
|--------|-------|
| Total attempts | 25 |
| PASS | 25 |
| WARN | 0 |
| FAIL | 0 |
| Success rate | **100%** |
| Threshold | >80% |
| Verdict | ✅ **PASS** |

### Per scenario

| Scenario | Attempts | PASS | WARN | FAIL | Rate |
|----------|----------|------|------|------|------|
| **15a** Desktop-first | 5 | 5 | 0 | 0 | 100% |
| **15b** Android-first | 5 | 5 | 0 | 0 | 100% |
| **15c** Concurrent import | 5 | 5 | 0 | 0 | 100% |
| **15d** Metadata divergence | 5 | 5 | 0 | 0 | 100% |
| **15e** Same title, diff hash | 5 | 5 | 0 | 0 | 100% |

### Failure domain classification

All 25 attempts were definitive PASS. No failures to classify.

### Setup fix applied

The original diagnostic (prior to fix) showed 20/25 WARN because `executePhase2CaseRef` had no custom book injection for case-refs 15a-15e. The fix added `setupCase15Ref()` with per-scenario book injection and fallback hash resolution via `context.caseActions` in `computeCase15Verdict`. See `dev-sync-cycle.mjs` for details.

### Evidence

Report files saved to `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783188386247-repeat.json` with 25 individual attempt reports.

---

---

## Artifacts

| Artifact | Location |
|----------|----------|
| Spec | `openspec/changes/case-15-same-book-from-both-devices/specs/case-15-same-book-from-both-devices/spec.md` + Engram #1484 |
| Design | `openspec/changes/case-15-same-book-from-both-devices/design.md` + Engram #1485 |
| Tasks | `openspec/changes/case-15-same-book-from-both-devices/tasks.md` + Engram #1486 |
| Apply Progress | `openspec/changes/case-15-same-book-from-both-devices/apply-progress.md` + Engram #1487 |
| Verify Report (this) | `openspec/changes/case-15-same-book-from-both-devices/verify-report.md` + Engram (see below) |
