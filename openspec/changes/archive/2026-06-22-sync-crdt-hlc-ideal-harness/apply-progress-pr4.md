## SDD APPLY Progress: PR4 — Real Books + Dictionary/Quote/Annotation + Edits/Deletes

**What**: SDD APPLY cumulative progress for sync-crdt-hlc-ideal-harness — PR4 (Action fixtures + Edit/Delete/Tombstone tooling).

**Why**: PR4 is the fourth stacked PR slice. It adds tests and implementation for:
- Task 4.1 (already complete): EPUB preparation engine and CLI tests
- Task 4.2 (this batch): fixture action engine (injectDictionary, injectQuote, injectAnnotation) + CLI integration
- Task 4.3 (this batch): edit/delete/tombstone helpers + duplicate detection + detached/sourceUnavailable graceful degradation

**Where**:
- `apps/readest-app/scripts/dev-sync-fixture.mjs` — fixed injectOpts forwarding, added `export` to functions, wrapped CLI in `isMain` guard
- `apps/readest-app/scripts/sync-dev-sqlite.mjs` — added `updateRow`, `softDeleteRow`, `findDuplicates`, `isStaleUpdate`
- `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` — 16 new tests (4 fixture engine + 6 CLI + 6 edit/delete/tombstone)
- `apps/readest-app/src/__tests__/services/sync/fixtures/epub-helper.ts` — reusable EPUB creation helper
- `apps/readest-app/package.json` — added `dev:sync:fixture` script
- `openspec/changes/archive/2026-06-22-sync-crdt-hlc-ideal-harness/tasks.md` — marked 4.1, 4.2, 4.3 as [x]

**Learned**:
- `dev-sync-fixture.mjs` had module-level CLI code that ran on import (`requireDevHarness` + `process.exit`), preventing vitest from importing the module. Fixed by wrapping CLI code in `isMain` guard (same pattern as `sync-dev-inject.mjs`).
- The inject functions (`injectDictionary`, `injectQuote`, `injectAnnotation`) were not exported — they were defined as unexported `function` declarations. Added `export` keyword.
- The inject functions called `injectRows` without required params (`dbPath`, `execFileSync`, `devHarnessEnabled`). Added `injectOpts` parameter with `resolveDefaults()` fallback to derive from environment.
- Created TABLE_DB_KIND mapping to resolve which SQLite DB file each table belongs to (dictionary_entries/dictionary_occurrences → dictionary.db, quotes → citas.db, annotations → annotations.db).
- Tests that dynamically import `.mjs` ESM modules in vitest must use `pathToFileURL(...).href` to get correct resolution.
- All 132 tests passing (116 baseline + 16 new).

## Mode
Strict TDD

## Completed Tasks (this batch)
- [x] 4.2 RED: tests create book-backed dictionary, quote, annotation records with associated highlight/group evidence.
- [x] 4.3 RED: tests for edits, deletes, tombstones, duplicates, detached/sourceUnavailable rows.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.2 injectDictionary | devSyncHarness.test.ts | Integration | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (single def + multi def) | ✅ Exported + injectOpts |
| 4.2 injectQuote | devSyncHarness.test.ts | Integration | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (unit + CLI) | ✅ Exported + injectOpts |
| 4.2 injectAnnotation | devSyncHarness.test.ts | Integration | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (unit + CLI) | ✅ Exported + injectOpts |
| 4.2 CLI integration | devSyncHarness.test.ts | Integration | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 3 flags (dict/quote/note) | ➖ None needed |
| 4.2 guard + missing flags | devSyncHarness.test.ts | Integration | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (guard + missing book + no action) | ➖ None needed |
| 4.3 updateRow HLC | devSyncHarness.test.ts | Unit | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (edit + bump) | ✅ sqlite3 json_set |
| 4.3 softDeleteRow | devSyncHarness.test.ts | Unit | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (tombstone + data preserved) | ✅ deleted flag |
| 4.3 tombstone stale | devSyncHarness.test.ts | Unit | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (stale + fresh) | ✅ Comparison logic |
| 4.3 duplicate detection | devSyncHarness.test.ts | Unit | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 2 cases (group + count) | ➖ None needed |
| 4.3 detached/unavailable | devSyncHarness.test.ts | Unit | ✅ 116/116 | ✅ Written | ✅ Passed | ✅ 4 operations | ✅ Graceful error handling |

### Test Summary
- **Tests added**: 16
- **Total tests passing**: 132
- **Layers used**: Integration (10), Unit (6)
- **Approval tests**: None — new code
- **Pure functions created**: `resolveDefaults`, `updateRow`, `softDeleteRow`, `findDuplicates`, `isStaleUpdate`

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `scripts/dev-sync-fixture.mjs` | Fixed | Added `export` to functions, injectOpts forwarding, isMain guard |
| `scripts/sync-dev-sqlite.mjs` | Extended | Added `updateRow`, `softDeleteRow`, `findDuplicates`, `isStaleUpdate` |
| `src/__tests__/services/sync/devSyncHarness.test.ts` | Extended | 16 new tests for tasks 4.2 + 4.3 |
| `src/__tests__/services/sync/fixtures/epub-helper.ts` | Created | Reusable EPUB creation helper for tests |
| `apps/readest-app/package.json` | Modified | Added `dev:sync:fixture` script |
| `openspec/changes/archive/.../tasks.md` | Updated | Marked 4.1, 4.2, 4.3 as [x] |

## Deviations from Design
None — implementation matches the design spec.

## Issues Found
- `dev-sync-fixture.mjs` had module-level CLI code preventing vitest imports; fixed with `isMain` guard.
- `dev-sync-fixture.mjs` functions weren't exported; added `export` keyword.
- `dev-sync-fixture.mjs` functions called `injectRows` without required params; added `injectOpts` parameter.

## Remaining Tasks
- [ ] 5.1 RED: route/CLI/cycle tests reject nested sync errors and partial evidence
- [ ] 5.2 RED: assertion fixtures for convergence, idempotence, duplicate logical rows, HLC newer-wins, tombstone respect
- [ ] 5.3 RED: golden report tests for PASS/FAIL/WARN/AMBIGUOUS
- [ ] 6.1 RED: docs test/check
- [ ] 6.2 Real-device smoke tasks

## Workload / PR Boundary
- **Mode**: Stacked PR slice (PR4 of 6)
- **Current work unit**: 4.2 + 4.3 (Action fixtures + Edits/Deletes/Tombstones)
- **Boundary**: From Red tests for fixture actions → Through edit/delete/tombstone helpers → Final passing 132 tests
- **Estimated review budget impact**: ~180 lines added (tests) + ~180 lines (implementation) ≈ 360 lines

## Status
4/6 phases complete (PR1-PR4). Tasks 4.2, 4.3 complete. Ready for verify.
