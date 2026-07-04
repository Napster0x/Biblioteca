# Tasks: fix-case9a-book-meta-sync

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 65-95 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Tests + P0 impl + P1 impl | Single PR | ~95 lines total, fits one review |

## Phase 1: Tests First (P0)

- [x] 1.1 Add test: metadata-updated book triggers `pushBookLibrary` but NOT `pushBookAssets`
- [x] 1.2 Add test: unchanged book (equal `updatedAt`) is skipped
- [x] 1.3 Add test: `updated` counter returned alongside `sent` and `tombstonesPushed`

## Phase 2: P0 — pushBooks Metadata Detection

- [x] 2.1 In `pushBooks()`: after hash-match guard, compare `updatedAt`; push library entry via `transport.pushBookLibrary()` when local is newer
- [x] 2.2 Return `updated` counter in result alongside `sent` and `tombstonesPushed`

## Phase 3: P1 — Android Clean with pm clear

- [x] 3.1 In `cleanAndroid()`: try `adb shell pm clear <package>` as primary clean; keep file-by-file `run-as rm -rf` as fallback
