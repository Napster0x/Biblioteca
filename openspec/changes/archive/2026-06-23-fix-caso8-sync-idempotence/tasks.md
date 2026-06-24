# Tasks: Fix Caso 8 — Sync Idempotence

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~220-270 (24 sync-execute + 200-240 test) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

## Phase 1: RED — Failing Tests (Test-First)

- [x] 1.1 Add `describe('sync-execute idempotence')` block in `devSyncHarness.test.ts` with a helper `createFullSyncFixture(dataRoot)` that seeds dictionary.db, citas.db, annotations.db plus `_replicas` empty (bootstrapping state).
- [x] 1.2 RED: first-sync bootstrapping — execute sync-execute with empty `_replicas`, assert all four replica kinds show `attempted > 0` and `applied > 0` per spec scenario "First sync bootstraps with empty _replicas".
- [x] 1.3 RED: second-sync idempotence — execute sync-execute twice against the same mock server, assert second run produces `attempted=0` and `applied=0` for all four kinds per spec scenario "Second sync with no changes produces zero operations".
- [x] 1.4 RED: modified-row re-push — execute sync twice, then modify a visible row's `updated_at` on Desktop between syncs, assert only that modified kind shows `attempted=1` on the later sync per spec scenario "New or changed replicas pass the HLC gate".
- [x] 1.5 RED: verify tests FAIL (Vitest focused run: `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts -t 'idempotence'`).

## Phase 2: GREEN — Implementation (Minimal Fix)

- [x] 2.1 Add `filterUnchangedReplicas(dbPath, replicas)` helper in `sync-execute.mjs` after line 296 (before `main`): `tableExists` guard → return all on empty `_replicas`, else filter via `newerOrEqualReplicaExists()`.
- [x] 2.2 Apply filter before `putReplicas` for dictionary-entry (line ~456): filter `dictionaryRows.entries` before PUT.
- [x] 2.3 Apply filter before `putReplicas` for dictionary-occurrence (line ~457): filter `dictionaryRows.occurrences` before PUT.
- [x] 2.4 Apply filter before `putReplicas` for quote (line ~462): filter `quoteRows` before PUT.
- [x] 2.5 Apply filter before `putReplicas` for annotation (line ~467): filter `annotationRows` before PUT.
- [x] 2.6 Write `_replicas` metadata after each successful PUT per kind: call `ensureDesktopReplicaTables(dbPath, kind)` + `writeReplicaMetadata(dbPath, row)` for every pushed row.

## Phase 3: Verification — Green Tests Pass

- [x] 3.1 Run focused Vitest: `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts -t 'idempotence'` — all 4 idempotence tests pass.
- [x] 3.2 Run full `devSyncHarness.test.ts` suite to confirm no regressions in existing dictionary/quote/annotation/pull tests.
- [ ] 3.3 Run `scripts/dev-sync-smoke.mjs` if available to validate end-to-end.
