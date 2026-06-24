# Proposal: Fix Caso 8 — Sync Idempotence v2

## Intent

v1 added `filterUnchangedReplicas()` for push idempotence. Tests pass (direct spawn with explicit env), but **the cycle harness path fails**: `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` is set in the cycle but never reaches `sync-execute.mjs` through the HTTP trigger → spawn chain. Also, pull evidence is noisy — `pulled` counts ALL Android replicas (no pre-filter), making idempotence evidence untestable in cycle context.

## Scope

### In Scope
- Forward `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` from cycle → `POST /api/sync-trigger` → spawned `sync-execute.mjs`
- Add pull-side `filterUnchangedReplicas()` pre-filter before `applyReplicaRowsToDesktop()`, overriding `pulled` count

### Out of Scope
- Dict-entry `replica_id` remapping (Android `resolve_semantic_id`): 2-sync convergence, not a bug
- Android-side changes
- CLI flag alternative (env var path already works for direct execution)

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None. Spec-level behavior unchanged — Caso 8 idempotence spec already demands `attempted=0, applied=0` on second sync. These are implementation bug fixes for the cycle execution path.

## Approach

Surgical: ~15 lines across 3 files, reusing existing `filterUnchangedReplicas()`.

**Push side**: `dev-sync-cycle.mjs` POSTs `stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` in body (2 fetch sites). `route.ts` `POST()` accepts `Request`, reads body optionally, forwards key to spawn env.

**Pull side**: `sync-execute.mjs` pull loop applies `filterUnchangedReplicas()` before `applyReplicaRowsToDesktop()`, overrides `pulled` count to filtered length.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | `triggerSync()` param + body, legacy `fetch()` body |
| `apps/readest-app/src/app/api/sync-trigger/route.ts` | Modified | `POST` reads body, forwards `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` to spawn env |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Pull loop: filter rows before apply, override `pulled` |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Integration tests for cycle-triggered idempotence and pull-filter evidence |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking other trigger clients | Low | Body read optional (catch parse); only extracts known key |
| Dict-entry `appliedToDesktop` may still be non-zero | Known | Android `resolve_semantic_id` remapping is 2-sync convergence; out of scope |
| Pull filter cross-contamination (dict-entry vs occurrence share `dictionary.db`) | None | Filter scopes by `replica_id` prefix |

## Rollback Plan

Revert 3 files: remove pull filter in pull loop, remove body from triggerSync/legacy fetch, remove body read from route POST. V1 push-only idempotence behavior restored.

## Dependencies

None.

## Success Criteria

- [ ] Cycle-triggered Sync 2 produces `attempted=0, applied=0` for all four replica kinds (dataRoot propagated)
- [ ] Cycle-triggered Sync 2 produces `pulled=0` for all four kinds (pull filter applied)
- [ ] Legacy path also propagates dataRoot
- [ ] Integration tests pass in `devSyncHarness.test.ts`
- [ ] Caso 7 bidirectional flow preserved
