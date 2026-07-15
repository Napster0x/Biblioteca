# Design: Fix Android Clean Reinitialize Harness

## Technical Approach

Create one script-level Android lifecycle helper for the dev harness and route all clean/restart paths through it. The helper owns the post-`pm clear` sequence: restore `Readest/settings.json` through `run-as`, launch the app, then wait with bounded retries for `/health`, `/books/manifest`, and all `/replicas/:kind` endpoints before reporting readiness. `sync-phase2-preflight.mjs` remains a pure blocker; reset/up/cycle become the recovery paths.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Reuse point | Add `apps/readest-app/scripts/android-clean-reinit.mjs` exporting small orchestration helpers | Keep copies in `dev-sync-reset.mjs`, `dev-sync-cycle.mjs`, and `dev-sync-up.mjs` | Existing logic is already duplicated and diverges: cycle injects settings and waits only `/health`; reset returns immediately after `pm clear`; up has its own toggle/start/wait logic. One helper prevents lifecycle drift. |
| Recovery owner | `dev-sync-reset.mjs` calls reinit immediately after successful Android `pm clear` | Make preflight auto-heal | Preflight currently expresses readiness failures. Keeping it read-only preserves clear operator diagnostics while reset guarantees CICLO clean returns only when Android is actually ready. |
| Readiness contract | Require process + ADB forward + `/health` + `/books/manifest` + all `REPLICA_KINDS` | Health-only readiness | Health can pass before domain APIs are usable; Phase 2 needs manifest and replica APIs. |
| Diagnostics | Return structured failure stage/class in JSON results | Free-form thrown errors only | CICLO harness needs actionable failures: process absent, health empty reply, manifest unreachable, replica API unavailable, adb/forward issue. |

## Data Flow

```text
dev-sync-reset --target android-db
  └─ pm clear <package>
     └─ reinitializeAndroidAfterClean(env)
        ├─ adb forward tcp:7878 tcp:7878
        ├─ adb push settings temp
        ├─ run-as mkdir -p /data/data/<pkg>/Readest
        ├─ run-as cp settings.json
        ├─ am start -n <pkg>/.MainActivity
        └─ waitAndroidReady()
           ├─ pidof <pkg>
           ├─ GET /health
           ├─ GET /books/manifest
           └─ GET /replicas/{annotation,quote,dictionary-entry,dictionary-occurrence}
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/android-clean-reinit.mjs` | Create | Shared helper with injectable `runAdb`, `fetch`, `sleep`, and timeout options for unit tests. |
| `apps/readest-app/scripts/dev-sync-reset.mjs` | Modify | After successful `pm clear`, call helper and include `reinitialize` result/errors in JSON. Fallback file cleanup can keep current runtime reset behavior. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modify | Replace duplicated `spawnAndroidClean()` lifecycle steps with the reset path/helper so `--clean-android` inherits full readiness. |
| `apps/readest-app/scripts/dev-sync-up.mjs` | Modify | Reuse settings/start/wait primitives where practical; keep desktop startup behavior unchanged. |
| `apps/readest-app/scripts/__tests__/android-clean-reinit.test.mjs` | Create | Focused helper tests for command order, bounded waits, and diagnostics. |

## Interfaces / Contracts

`reinitializeAndroidAfterClean({ env, runAdb, fetch, sleep, timeoutMs })` returns:

```js
{ ok, stages: [], diagnostics: [], ready: { process, health, manifest, replicas } }
```

Diagnostic classes: `adb-forward-unavailable`, `settings-injection-failed`, `process-absent`, `health-empty-reply`, `health-unreachable`, `manifest-unreachable`, `replica-api-unavailable`, `start-failed`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Helper command order: forward → push → mkdir → cp → start → waits | Vitest with fake `runAdb`, fake `fetch`, no real device. |
| Unit | Failure classification and bounded retry exit | Simulate absent process, empty health body, manifest failure, partial replica failure, ADB forward failure. |
| Script integration | Reset/cycle call sites consume helper result correctly | Mock helper or child process output; assert non-zero on not-ready. |
| Manual device | Real `pm clear` recovery | After implementation, run `dev:sync:reset -- --target all --confirm DELETE_DEV_SYNC_STATE --no-dry-run`, then `phase2.preflight`/doctor and one CICLO case. |

## Migration / Rollout

No migration required. This is dev-harness-only behavior behind existing harness commands.

## Open Questions

None.
