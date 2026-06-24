# Tasks: Fix Caso 4 Quote Sync Android Receive

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 150-200 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR: focused script + tests |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add failing quote tests and minimal script fix | PR 1 | Base main; tests beside `sync-execute.mjs` behavior |

## Phase 1: RED Tests

- [ ] 1.1 In `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts`, add a focused failing test that seeds temp `Readest/citas.db` `quotes` table rows and proves `sync-execute.mjs` PUTs `ReplicaRow[]` to `/replicas/quote` with expected `fields_jsonb` keys (`bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `text`, `contextBefore`, `contextAfter`, `contentHash`), `replica_id` prefix `quote:`, and envelope shape.
- [ ] 1.2 In the same test file, assert absent `citas.db` → `quote.attempted: 0`, `quote.applied: 0` without breaking book or dictionary sync evidence.
- [ ] 1.3 Add a failing evidence/error test asserting `/replicas/quote` PUT 400 response → non-zero exit, error message mentions `quote`, failures array shows 400 + response body.

## Phase 2: GREEN Implementation

- [ ] 2.1 In `apps/readest-app/scripts/sync-execute.mjs`, define `QUOTE_ENDPOINT = '/replicas/quote'` and `QUOTE_FIELDS` mapping (snake_case column → camelCase replica field). Add `readQuotesRows()` reading `quotes` table from `join(env.desktop.dataRoot, 'Readest', 'citas.db')`; missing DB/missing table → empty array.
- [ ] 2.2 Map `quotes` rows to `ReplicaRow[]` via existing `rowToReplica()` with `kind: 'quote'`, `replica_id: 'quote:{id}'`, `fields_jsonb` per `QUOTE_FIELDS`, HLC via `updated_at ?? created_at` fallback, `manifest_jsonb: null`, `schema_version: 1`.
- [ ] 2.3 Add `'quote': { attempted: 0, applied: 0, endpoint: QUOTE_ENDPOINT, failures: [] }` to `emptyReplicaEvidence()` and call `putReplicas(baseUrl, 'quote', QUOTE_ENDPOINT, quoteRows, replicas)` in `main()` after dictionary replication, before book sync.
- [ ] 2.4 Preserve existing `/books/*` sync, dictionary replica transport, and top-level `{ ok, sent, received, replicas, evidence }` JSON stdout unchanged.

## Phase 3: REFACTOR and Verification

- [ ] 3.1 Ensure no duplicated mapping/helper code in `sync-execute.mjs`; reuse existing `rowToReplica`, `putReplicas`, `toHlc`, `replicaTimestamps`, `readSqliteJson`, `tableExists`.
- [ ] 3.2 Run focused Vitest: `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts` — all quote tests pass green; no build.

## Phase 4: Harness Verification

- [ ] 4.1 After sdd-apply and sdd-verify checks, rerun harness Caso 4 clean/prepare/fixture/sync and verify Android `/replicas/quote` shows `rowCount >= 1`.
