# Proposal: Fix Caso 8 — Sync Idempotence

## Intent

Sync 2 re-pushes the entire Desktop dataset every time because the push phase reads ALL visible rows with no change tracking. Desktop `_replicas` table is never consulted. Fix: filter already-synced replicas before PUT. Sync 2 must produce attempted=0, applied=0 for all four replica kinds.

## Scope

### In Scope
- Add `filterUnchangedReplicas()` helper using existing `newerOrEqualReplicaExists()`
- Apply filter before each `putReplicas()` call (dictionary-entry, dictionary-occurrence, quote, annotation)
- Write `_replicas` metadata on Desktop after successful push (supplementary: populates `_replicas` immediately, not waiting for pull)

### Out of Scope
- No Android-side changes
- No cursor-based change tracking or `since` parameter
- No DDL reconciliation between `sync-execute.mjs` and `sync-dev-inject.mjs`

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- **`sync-crdt-hlc-real-device-harness`**: Push-side now filters unchanged replicas against Desktop `_replicas`. Delta spec required: Caso 8 idempotence (repeated sync produces 0 operations across all kinds).

## Approach

Surgical ~12-line change in `sync-execute.mjs` `main()`. Add `filterUnchangedReplicas(dbPath, replicas)` that returns only rows NOT already in Desktop `_replicas` with equal-or-higher `updated_at_ts`. Reuses existing `newerOrEqualReplicaExists()` (line 215) and `desktopReplicaDbPath()` (line 298). Apply filter before each `putReplicas()` call. Call `writeReplicaMetadata()` after each successful PUT to populate `_replicas` immediately.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | `filterUnchangedReplicas()` helper + filter application in `main()` + post-push metadata write |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Empty `_replicas` on first sync | Expected | First sync pushes everything (bootstrapping); filter benign |
| Caso 7 bidirectional regression | Low | Filter only removes already-synced rows; new/changed rows still pushed |
| `resolve_semantic_id` remapping mismatch | Low | Desktop filter uses original `replica_id`; Android remaps on acceptance, Desktop push id unchanged |

## Rollback Plan

Revert `sync-execute.mjs`: remove `filterUnchangedReplicas()` calls and helper. No other files touched.

## Dependencies

None.

## Success Criteria

- [ ] Sync 2 produces `attempted=0, applied=0` for dictionary-entry, dictionary-occurrence, quote, and annotation
- [ ] Caso 7 bidirectional flow preserved: first sync pushes all rows, pull applies all
- [ ] Desktop `_replicas` populated immediately after push (evidenced by post-push metadata write)
