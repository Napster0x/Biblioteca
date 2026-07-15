# Design: Fix Android Local Sync Lifecycle

## Technical Approach

Make the existing process-bound Android local sync server easier to reason about instead of changing sync semantics. The change adds one native “ensure server” path for manual command and Android auto-start, records lifecycle state/logs, and upgrades `dev:sync:doctor` so Phase 2 can say “wrong package/no process/no listener/bad forward/timeout” before testing CRDT behavior.

## Architecture Decisions

| Topic | Option | Tradeoff | Decision |
|---|---|---|---|
| Server ownership | Keep `SyncServer` in `LocalSyncState` | Dies with app process, but matches current Tauri lifecycle and avoids Android service complexity | Keep process-bound server; detect absent process explicitly |
| Startup path | Duplicate command and auto-start logic | Current code diverges and can miss logs/health | Introduce one `ensure_local_sync_server(...)` helper used by `start_local_sync_server` and Android setup |
| Idempotency | “Some server exists” only | May report running even if caller asks for a different port | Return structured `started/skipped/failed` state with effective port and health result |
| Foreground service | Implement now | More stable in background, but adds notification/channel/permission lifecycle and review surface | Escalation only after evidence shows foreground app lifecycle is insufficient |
| Package handling | Single default package | Fast, but ambiguous across prod/dev installs | Resolve candidate packages, selected package, and PID using env override first, then installed known candidates |

## Data Flow

```text
Android setup/command
  └─ ensure_local_sync_server(app, state, port, source)
       ├─ if state.server exists: verify_health → skipped/running or failed/stale
       ├─ start SyncServer on 127.0.0.1:port
       └─ verify_health → record status + log [local-sync:lifecycle]

dev:sync:doctor
  └─ createSyncDevEnvironment
       ├─ resolve package candidates + selected package
       ├─ adb pidof/run-as/forward --list
       └─ classify fetch(/health): pass | refused | timeout | http-error | unknown
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/src-tauri/src/lib.rs` | Modify | Extract `ensure_local_sync_server`; use `log::*` not `println!`; include Android source labels (`command`, `auto-start`). |
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modify | Expose minimal lifecycle facts: port, `verify_health`, and safe idempotency diagnostics without changing routes. |
| `apps/readest-app/scripts/sync-dev-env.mjs` | Modify | Add pure helpers for Android package candidates, selected package, PID parsing, and HTTP error classification. |
| `apps/readest-app/scripts/dev-sync-doctor.mjs` | Modify | Run diagnostics before endpoint checks and include structured evidence/actions in JSON output. |
| `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` | Create | Node test coverage for classifier and package/forward diagnostics. |
| `apps/readest-app/docs/sync-dev-harness.md` | Modify | Document package override, PID/listener recovery, native rebuild boundary, and foreground-service escalation criteria. |

## Interfaces / Contracts

Doctor JSON keeps `ok/status/environment/checks/actions` and adds check evidence fields only:

```js
{ name: 'android.process', status: 'pass|fail|warn', packageName, pid, candidates }
{ name: 'android.health', status: 'pass|fail', failureClass: 'refused|timeout|http-error|unknown' }
```

Native lifecycle logs use stable prefixes: `[local-sync:lifecycle] start|skip|failed|health` with `source`, `port`, and error text.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| JS unit | Package selection, `adb forward --list`, PID output, refused vs timeout classification | `node:test` under `scripts/__tests__/` using pure helpers/mocked `run`/`fetch` |
| Rust unit/integration | Loopback bind still enforced; duplicate ensure skips; stale/unhealthy server reports failure | Existing `local_sync_server.rs` test style with free ports; add lib-level helper tests where practical |
| Manual device | Real package/PID/forward and `/health` evidence after rebuild/redeploy | `pnpm dev:sync:doctor --json`, `adb shell pidof`, `adb forward --list`, `curl /health`; no automatic build/redeploy |

## Migration / Rollout

No data migration required. Roll out as diagnostics/lifecycle-only changes. Foreground service remains a later change if logs prove the OS kills the process while the app should remain serving sync.

## Open Questions

- [ ] None blocking.
