# Design: Fix Caso 8 — Sync Idempotence v2

## Technical Approach

Two surgical fixes on the cycle execution path: (1) propagate `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` from `dev-sync-cycle.mjs` through the HTTP trigger to the spawned `sync-execute.mjs`, enabling the v1 push filter to work in cycle context; (2) apply `filterUnchangedReplicas()` on the pull side before `applyReplicaRowsToDesktop()`, so pulled evidence reflects only new replicas. Total: ~20 lines across 3 implementation files + 2 test cases.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| DataRoot transport | POST body JSON `{BIBLIOTECA_DEV_DESKTOP_DATA_ROOT}` | CLI flag, temp file | Minimal diff (~4+6 lines); route already reads Request; env-var approach consistent with rest of harness |
| Pull filter reuse | `filterUnchangedReplicas()` (existing) | New filter function | Same logic as push side: check `_replicas` by `replica_id` + HLC gate; zero new abstractions |
| `pulled` count override | Set `replicas[kind].pulled = filtered.length` after filter | New evidence field | Preserves existing contract shape; consumers already read `pulled` |
| Body parse resilience | Try/catch JSON parse, extract only known key | Strict schema validation | Won't break other clients; missing body is no-op |

## Data Flow

### Push side (dataRoot propagation)

```
dev-sync-cycle.mjs                POST /api/sync-trigger           sync-execute.mjs
─────────────────                 ─────────────────────            ─────────────────
stateEnv.BIBLIOTECA_DEV_         read body.json                    env.desktop.dataRoot
  DESKTOP_DATA_ROOT ──────────→  extract dataRoot ──────────────→  = dataRoot
                                  env: {...process.env,            filterUnchangedReplicas()
                                  BIBLIOTECA_DEV_DESKTOP_          uses correct DB path ✓
                                  DATA_ROOT: dataRoot}
```

### Pull side (pre-filter)

```
Android GET /replicas/:kind
        │
        ▼
  rows (all replicas) ──→ filterUnchangedReplicas(dbPath, rows) ──→ filtered rows ──→ applyReplicaRowsToDesktop
        │                         │
  replicas[kind].pulled =  replicas[kind].pulled =
    rows.length (removed)    filtered.length (new)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modify | `triggerSync()` accepts `dataRoot`, sends in POST body; legacy inline fetch also sends body |
| `apps/readest-app/src/app/api/sync-trigger/route.ts` | Modify | `POST()` signature: `async function POST(request: Request)`. Parse body optionally, forward `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` to spawn env |
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Pull loop (line ~500): compute dbPath, call `filterUnchangedReplicas()`, override `pulled`, pass filtered rows to `applyReplicaRowsToDesktop` |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | 2 new tests: cycle-idempotence (spawn cycle with fake trigger server, verify dataRoot propagated) and pull-filter evidence (second pull returns `pulled=0`) |

### Exact changes per file

**`dev-sync-cycle.mjs`**: 
- `triggerSync(triggerUrl, attempts)` → `triggerSync(triggerUrl, attempts, dataRoot)` (line 54)
- Add `body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot })` to fetch (line 59)
- Add `headers: { 'Content-Type': 'application/json' }` to fetch (line 58)
- Callers at lines 208, 273: pass `stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`
- Legacy path line 387: add same body+headers to inline fetch

**`route.ts`**:
- `POST()` → `POST(request: Request)` (line 49)
- Add: `const body = await request.json().catch(() => ({})); const dataRoot = body?.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT;`
- Spawn env: `{ ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1', ...(dataRoot ? { BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: dataRoot } : {}) }` (line 60)

**`sync-execute.mjs`** (pull loop, line 500-503):
- Before `applyReplicaRowsToDesktop`: compute `dbPath = desktopReplicaDbPath(env.desktop.dataRoot, kind)`, call `filterUnchangedReplicas(dbPath, rows)`, set `replicas[kind].pulled = filtered.length`
- Pass `filtered` (not raw `rows`) to `applyReplicaRowsToDesktop`

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration | Cycle → trigger → execute dataRoot propagation | Spawn `cycleScript` with `--steps` pointing to a local fake trigger server. Server reads POST body, asserts `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` present. Cycle report shows `attempted=0, applied=0` on Sync 2. |
| Integration | Pull filter: `pulled=0` on second pull | Direct `spawnNode(syncExecuteScript)` with same desktopRoot twice. Server returns same replicas on both pulls. First run: `pulled>0, appliedToDesktop>0`. Second run: `pulled=0, appliedToDesktop=0`. |

## Migration / Rollout

No migration required. Rollback: revert 3 files.

## Open Questions

- None — both issues are well-understood from exploration. Dict-entry `appliedToDesktop` may remain non-zero on first cycle sync due to Android `resolve_semantic_id` remapping (2-sync convergence, out of scope).
