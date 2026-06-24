# Tasks: Fix Caso 7 Android-to-Desktop Replica Sync

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 360-460 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 RED tests → PR 2 script implementation |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Add focused RED coverage for Android→Desktop Caso 7 | PR 1 | Base `main`; tests only, expected fail before implementation. |
| 2 | Implement minimal pull/apply path in `sync-execute.mjs` | PR 2 | Base PR 1 branch; includes verification-only updates if needed. |

## Phase 1: RED Tests

- [x] 1.1 In `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts`, add a failing test where mocked Android GETs return all four ReplicaRow kinds and temp desktop DBs receive visible rows plus `_replicas` metadata.
- [x] 1.2 Add a failing dictionary-ordering assertion: `dictionary-entry` is requested/applied before `dictionary-occurrence`, and occurrence convergence requires its entry.
- [x] 1.3 Add a failing idempotence/HLC test: same or older Android ReplicaRows do not duplicate rows or overwrite newer desktop `_replicas` state.
- [x] 1.4 Assert evidence remains additive: existing `attempted`/`applied` fields still exist and new `pulled`/`appliedToDesktop` counts are reported per kind.

## Phase 2: Minimal Script Implementation

- [x] 2.1 In `apps/readest-app/scripts/sync-execute.mjs`, extend `emptyReplicaEvidence()` with additive `pulled` and `appliedToDesktop` fields without renaming existing evidence.
- [x] 2.2 Add `getReplicas()` and `replicaRowsFromPayload()` to GET each Android endpoint and accept `ReplicaRow[]` or `{ rows }`, failing usable-evidence gaps by kind.
- [x] 2.3 Add desktop SQLite helpers in `sync-execute.mjs` for idempotent `_replicas` DDL, table DDL, HLC comparison, and `replica_id` → visible `id` extraction.
- [x] 2.4 Add visible upserts for dictionary entries, dictionary occurrences, quotes, and annotations using existing field maps and `field.v`; avoid inventing missing `contentHash`.
- [x] 2.5 Wire pull/apply after current PUTs in fixed order: `dictionary-entry`, `dictionary-occurrence`, `quote`, `annotation`; route each kind to `dictionary.db`, `citas.db`, or `annotations.db`.

## Phase 3: Verification Without Build

- [x] 3.1 Run only the focused Vitest file from `apps/readest-app`: `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts`.
- [ ] 3.2 Run type/lint verification if needed: `pnpm lint`; do not run `pnpm build` or real device sync.
- [x] 3.3 Confirm no Android install/redeploy/restart, destructive clean, or real sync trigger was executed.
