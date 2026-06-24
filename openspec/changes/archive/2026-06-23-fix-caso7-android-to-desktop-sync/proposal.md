# Proposal: Fix Caso 7 Android-to-Desktop Replica Sync

## Intent

Fix recurring Caso 7 data loss: Android-only dictionary, quote, and annotation ReplicaRows are exposed by Android but never pulled or applied to desktop SQLite. Keep the existing Desktop→Android path intact.

## Scope

### In Scope
- GET Android `/replicas/dictionary-entry`, `/replicas/dictionary-occurrence`, `/replicas/quote`, and `/replicas/annotation` during sync execution.
- Apply pulled ReplicaRows into desktop `Readest/dictionary.db`, `Readest/citas.db`, and `Readest/annotations.db` visible tables plus `_replicas` metadata.
- Apply `dictionary-entry` before `dictionary-occurrence`.
- Enforce HLC/idempotence gates so equal/older rows are skipped and Caso 8 remains PASS.
- Add non-breaking evidence fields such as per-kind `pulled` and `appliedToDesktop`.

### Out of Scope
- Sync protocol redesign, new abstractions, app-store integration, Rust server changes, or real harness runs.
- Changing already passing Desktop→Android behavior except orchestration/reporting that invokes the pull step.
- Unrelated cleanup, configurability, build/redeploy, or destructive device operations.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: require Android→Desktop pull/apply evidence and idempotent desktop convergence for Caso 7.

## Approach

Use a surgical addition in `apps/readest-app/scripts/sync-execute.mjs`: after/alongside current PUTs, GET the four Android replica endpoints, tolerate `ReplicaRow[]` and `{ rows }`, filter ReplicaRow-like values, then upsert into the matching desktop DB/table only when `_replicas.updated_at_ts` is newer. Preserve field mappings from existing desktop→Android conversion. Focus tests in `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` with mocked Android endpoints and temp SQLite DBs.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Add pull/apply helpers and evidence extension. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Add failing unit coverage for Caso 7 and idempotence. |
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modified | Delta spec will add Caso 7 Android→Desktop expectations. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate or stale desktop rows | Med | Gate visible writes through `_replicas` HLC checks. |
| Occurrence before entry | Med | Fixed apply order: entry first, occurrence second. |
| Evidence compatibility regression | Low | Add fields; do not rename existing `attempted`/`applied`. |

## Rollback Plan

Revert the `sync-execute.mjs` pull/apply change and its focused tests/spec delta. Desktop→Android transport remains isolated and should return to prior behavior.

## Dependencies

- Existing Android replica API and desktop SQLite schemas.

## Success Criteria

- [ ] Unit test proves Android ReplicaRows are pulled and visible in desktop DBs.
- [ ] Reapplying identical/older rows does not duplicate or overwrite newer desktop state.
- [ ] Evidence distinguishes pulled/applied-to-desktop counts without breaking existing replica evidence.
