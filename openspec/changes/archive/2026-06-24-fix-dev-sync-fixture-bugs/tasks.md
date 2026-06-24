# Tasks: Fix Dev Sync Fixture Bugs

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~63 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Work Units

| Unit | Goal | PR | Notes |
|------|------|----|-------|
| 1 | Fix all 3 bugs + align tests | PR #1 | Single PR; ~63 lines across 3 files |

## Phase 1: Foundation — ensureTable DDL helper

- [x] 1.1 RED: Write test proving injectDictionary/injectQuote/injectAnnotation fail on empty DB with no tables (expected fail)
- [x] 1.2 GREEN: Add `ensureTable(dbPath, table, execFileSync)` to `scripts/sync-dev-inject.mjs` — `CREATE TABLE IF NOT EXISTS` per Tauri `visible_repo.rs` DDL (annotations lines 715-719, quotes lines 781-785, dictionary_occurrences 847-852, dictionary_entries 985-989), extended with `replica_timestamps TEXT` per design recommendation
- [x] 1.3 GREEN: Call `ensureTable` at top of `injectRows` before column/row processing — idempotent via IF NOT EXISTS

## Phase 2: Core — error propagation + column cleanup

- [x] 2.1 RED: Write test proving injectDictionary/injectQuote/injectAnnotation ignore `injectRows` failure (mock returns `{ok: false, error}`; currently returns success)
- [x] 2.2 GREEN: Add `const r = injectRows(...); if (!r.ok) return r;` guard in `injectDictionary` (lines 75, 94), `injectQuote` (line 129), `injectAnnotation` (line 165) in `scripts/dev-sync-fixture.mjs`
- [x] 2.3 GREEN: Remove `comment` field from `injectQuote` row payload (line 136)
- [x] 2.4 GREEN: Remove `selected_text` field from `injectAnnotation` row payload (line 174)
- [x] 2.5 GREEN: Fix CLI `console.log` (line 235) to use `result.ok` instead of hardcoded `true`

## Phase 3: Test alignment with removed columns

- [x] 3.1 RED: Remove `comment TEXT,` from 4 DDL helpers in `devSyncHarness.test.ts` — `createEmptyQuotesDb` (line 2545), CLI `--quote` test (line 2714), softDelete quotes (line 2853)
- [x] 3.2 RED: Remove `selected_text TEXT,` from 3 DDL helpers — `createEmptyAnnotationsDb` (line 2560), CLI `--note` test (line 2736), stale annotations (line 2880)
- [x] 3.3 RED: Remove `expect(rows[0].comment)` assertion from injectQuote test (line 2647)
- [x] 3.4 RED: Remove `expect(rows[0].selected_text)` assertion from injectAnnotation test (line 2676)
- [x] 3.5 GREEN: Run test suite — all remaining 10+ fixture tests pass including `selected_text` in dictionary_occurrences assertions (lines 2599, 2623, 2705) which remain valid

## Phase 4: Verify

- [x] 4.1 Run `pnpm test -- devSyncHarness.test.ts` — all fixture tests pass
- [x] 4.2 Run `pnpm test` — no regressions outside target test file
- [x] 4.3 Verify ensureTable is idempotent: repeated injectRows on same DB doesn't error
