# Tasks: Fix Caso 3 Dictionary Sync Android Receive

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180-280 |
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
| 1 | Add focused failing tests and minimal script fix | PR 1 | Base main; keep tests beside `sync-execute.mjs` behavior |

## Phase 1: RED Tests

- [x] 1.1 In `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts`, add a failing focused test that seeds temp `Readest/dictionary.db` rows and proves `sync-execute.mjs` PUTs `dictionary_entries` to `/replicas/dictionary-entry`.
- [x] 1.2 In the same test file, assert `dictionary_occurrences` rows PUT to `/replicas/dictionary-occurrence` with expected `fields_jsonb` keys and replica metadata.
- [x] 1.3 Add a failing evidence/error test asserting stdout includes separate `replicas.dictionary-entry` and `replicas.dictionary-occurrence` counts, or non-zero failure JSON names missing/failed replica transport.

## Phase 2: GREEN Implementation

- [x] 2.1 In `apps/readest-app/scripts/sync-execute.mjs`, collect visible `dictionary_entries` and `dictionary_occurrences` from `join(env.desktop.dataRoot, 'Readest', 'dictionary.db')`; missing DB/tables yield zero rows.
- [x] 2.2 Map rows to `ReplicaRow[]` with `kind`, `replica_id`, `fields_jsonb`, `manifest_jsonb: null`, tombstone timestamps, HLC IDs, and `schema_version: 1`.
- [x] 2.3 PUT mapped arrays to Android `/replicas/dictionary-entry` and `/replicas/dictionary-occurrence`; fail non-zero on non-2xx, invalid JSON, or fetch errors with clear replica evidence.
- [x] 2.4 Preserve existing `/books/*` sync behavior and top-level `{ ok, sent, received }`; only add nested `replicas` and evidence fields.

## Phase 3: REFACTOR and Focused Verification

- [x] 3.1 Simplify any duplicated mapping/helper code in `apps/readest-app/scripts/sync-execute.mjs` without introducing broad sync abstractions.
- [x] 3.2 Run focused Vitest coverage for `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts`; no build.
- [x] 3.3 Continuation: fix Android `dictionary-entry` 400 by matching the receiver `ReplicaRow[]` contract and preserving response-body diagnostics for rejected replica PUTs.
- [x] 3.4 Continuation: fix `dev-sync-state.mjs` Android replica observability so raw `/replicas/*` array responses count as `rowCount = array.length` while object `{ rows }`/`rowCount` shapes remain supported.
- [x] 3.5 Continuation: fix Android reset runtime cleanup by making confirmed `android-db` reset call a guarded local sync runtime reset endpoint and report restart/redeploy when the running Android app lacks that endpoint.

## Phase 4: Harness Verification

- [ ] 4.1 After sdd-apply and sdd-verify archive/apply checks, rerun harness Caso 3 clean/prepare/fixture/sync and record Android dictionary-entry/occurrence replica counts.
