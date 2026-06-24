# Tasks: Fix Caso 5 Annotation Sync Android Receive

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120-160 |
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
| 1 | Add failing annotation tests and minimal script fix | PR 1 | Base main; tests beside `sync-execute.mjs` behavior |

## Phase 1: RED Tests

- [x] 1.1 In `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts`, add `createAnnotationReplicaDb()` helper seeding temp `Readest/annotations.db` with `annotations` table (columns: `id`, `book_hash`, `book_title`, `book_author`, `cfi`, `section_href`, `page`, `text`, `note`, `style`, `color`, `created_at`, `updated_at`) and a single fixture row. Add focused failing test proving `sync-execute.mjs` PUTs `ReplicaRow[]` to `/replicas/annotation` with expected `fields_jsonb` keys, `replica_id` prefix `annotation:`, and envelope shape.
- [x] 1.2 In same describe block, assert absent `annotations.db` → `annotation.attempted: 0`, `annotation.applied: 0` without breaking book, dictionary, or quote sync evidence.
- [x] 1.3 Add failing evidence/error test asserting `/replicas/annotation` PUT 400 response → non-zero exit, error message mentions `annotation`, failures array shows 400 + response body.

## Phase 2: GREEN Implementation

- [x] 2.1 In `apps/readest-app/scripts/sync-execute.mjs`, define `ANNOTATION_ENDPOINT = '/replicas/annotation'` and `ANNOTATION_FIELDS` mapping (snake_case column → camelCase field: `book_hash → bookHash`, `book_title → bookTitle`, `book_author → bookAuthor`, `cfi → cfi`, `section_href → sectionHref`, `page → page`, `text → text`, `note → note`, `style → style`, `color → color`). Add `readAnnotationRows()` reading `annotations` table from `join(env.desktop.dataRoot, 'Readest', 'annotations.db')`; missing DB/missing table → empty array.
- [x] 2.2 Map `annotations` rows to `ReplicaRow[]` via existing `rowToReplica()` with `kind: 'annotation'`, `replica_id: 'annotation:{id}'`, `fields_jsonb` per `ANNOTATION_FIELDS`, HLC via `updated_at ?? created_at` fallback, `manifest_jsonb: null`, `schema_version: 1`.
- [x] 2.3 Add `annotation: { attempted: 0, applied: 0, endpoint: ANNOTATION_ENDPOINT, failures: [] }` to `emptyReplicaEvidence()` and call `putReplicas(baseUrl, 'annotation', ANNOTATION_ENDPOINT, annotationRows, replicas)` in `main()` after quote replica transport, before book sync.
- [x] 2.4 Preserve existing `/books/*` sync, dictionary replica transport, and quote replica transport; top-level `{ ok, sent, received, replicas, evidence }` JSON stdout unchanged.

## Phase 3: REFACTOR and Verification

- [x] 3.1 Ensure no duplicated mapping/helper code in `sync-execute.mjs`; reuse existing `rowToReplica`, `putReplicas`, `toHlc`, `readSqliteJson`, `tableExists`.
- [x] 3.2 Run focused Vitest: `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts` — all annotation tests pass green; no build.

## Phase 4: Harness Verification

- [ ] 4.1 After sdd-apply and sdd-verify checks, rerun harness Caso 5 clean/prepare/fixture/sync and verify Android `/replicas/annotation` shows `rowCount >= 1`.
