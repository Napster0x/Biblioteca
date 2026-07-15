# Tasks: Case 15 — Same Book From Both Devices

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150–250 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

## Phase 1: Assertion Helpers (assert-engine.mjs)

- [x] 1.1 Add `assertBookCount(expectedCount, deviceState)` — counts live books (`deletedAt` null/undefined) on a device; returns `{verdict, failures}`
- [x] 1.2 Add `assertMetadata(hash, field, expectedValue, deviceState)` — finds book by hash in device state and checks field equality; returns `{verdict, failures}`
- [x] 1.3 Add unit tests for `assertBookCount` and `assertMetadata` in `dev-sync-cycle.test.mjs` — tests: 0 books, 5 books, live vs deleted, matching field, mismatched field, missing book, missing books array

## Phase 2: Case-Ref Definitions (dev-sync-cycle.mjs)

- [x] 2.1 Add `computeCaseAcceptanceVerdict` handler for **15a** (Desktop-first): hash from pre desktop facts → both sides have exactly one copy post-sync; no duplicates
- [x] 2.2 Add handler for **15b** (Android-first): symmetric to 15a; hash from pre android facts
- [x] 2.3 Add handler for **15c** (Concurrent import): common hash from both pre sides → exactly one per side post-sync
- [x] 2.4 Add handler for **15d** (Metadata divergence): common hash, post-sync both sides share same title with newer updatedAt on both sides
- [x] 2.5 Add handler for **15e** (Same title, different hash — negative): two hashes from pre (AAA desktop, BBB android) → both hashes present on both sides post-sync, >=2 books per side
- [x] 2.6 Add unit tests for all 5 case-ref handlers (PASS, WARN, and FAIL scenarios)

## Phase 3: Real-Device Verification

- [x] 3.1 Run cycle for 15a–15e: `BIBLIOTECA_DEV_SYNC_HARNESS=1 pnpm dev:sync:cycle --case-ref 15a,15b,15c,15d,15e --repeat 5 --repeat-timeout-ms 120000 --min-success-rate 0.8 --clean-android`
- [x] 3.2 Document results in verify-report.md — capture PASS/FAIL per scenario, any WARNs, failure domains, evidence paths
- [x] 3.3 Verify all 5 scenarios exceed 80% success threshold; classify failures by domain (product/environment/harness/unknown)

## Phase 4: Documentation

- [x] 4.1 Document book identity model in verify-report.md: hash-based sole identity, no `id` field on Book, entity-level `updatedAt` merge, field-level HLC does not exist for books
- [x] 4.2 Save apply progress — mark completed tasks in this file, persist to Engram via `mem_save` with topic_key `sdd/case-15-same-book-from-both-devices/tasks`
