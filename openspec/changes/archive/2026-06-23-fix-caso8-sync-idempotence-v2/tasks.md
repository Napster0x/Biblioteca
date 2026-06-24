# Tasks: Fix Caso 8 — Sync Idempotence v2

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 (20 impl + ~180 tests) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

## Phase 1: RED — Write Failing Tests

- [x] 1.1 `devSyncHarness.test.ts`: Add "cycle push idempotence via dataRoot" test — spawn `cycleScript` with `--steps` pointing at a fake trigger server that reads `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` from POST body and forwards it to `sync-execute.mjs` spawn env. Create fixture with all four replica kinds. Step 1 syncs → writes `_replicas`. Step 2 asserts `attempted=0, applied=0` for dictionary-entry, dictionary-occurrence, quote, and annotation.
- [x] 1.2 `devSyncHarness.test.ts`: Add "pull filter produces pulled=0 on second pull" test — `spawnNode(syncExecuteScript)` twice with same `desktopRoot` and a fake server returning same Android replicas on both pulls. First run: `pulled>0`, `appliedToDesktop>0` for all kinds. Second run: `pulled=0`, `appliedToDesktop=0`.

## Phase 2: GREEN — Implement Fixes

- [x] 2.1 `scripts/dev-sync-cycle.mjs`: Extend `triggerSync()` signature to accept `dataRoot`, send it as POST body `{BIBLIOTECA_DEV_DESKTOP_DATA_ROOT}` with `Content-Type: application/json`. Update callers at lines 208, 273 to pass `stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`. Update legacy inline fetch (line 387).
- [x] 2.2 `src/app/api/sync-trigger/route.ts`: Change `POST()` to `POST(request: Request)`. Parse body with `request.json().catch(()=>({}))`, extract `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`. Forward to `execFileAsync` spawn env alongside existing env vars.
- [x] 2.3 `scripts/sync-execute.mjs`: In pull loop (line ~500), before `applyReplicaRowsToDesktop`: compute `dbPath`, call `filterUnchangedReplicas(dbPath, rows)`, set `replicas[kind].pulled = filtered.length`, pass `filtered` to apply.

## Phase 3: Verify

- [x] 3.1 Run `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts`. Confirm Phase 1 tests pass and no regressions in existing 30+ harness tests.
- [ ] 3.2 Manual smoke (optional): `node scripts/dev-sync-cycle.mjs` with case-ref. Verify cycle report shows `attempted=0` on Sync 2 for all kinds.
