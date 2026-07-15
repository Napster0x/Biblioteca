# Proposal: Fix Android Local Sync Lifecycle

## Intent

Unblock Phase 2 reruns by making Android local sync failures diagnosable and the embedded HTTP server startup idempotent. Current evidence shows `/health` can work, then later `adb forward` reaches no listener because the Android app process/server is absent.

## Scope

### In Scope
- Classify harness failures: package selected, process absent, forward state, refused vs timeout, and toggle/settings ambiguity.
- Make Android local sync startup observable and idempotent inside the app process.
- Document Android dev package behavior and local sync recovery steps.

### Out of Scope
- Foreground service implementation unless verification proves foreground app lifecycle is insufficient.
- Sync route/business logic redesign, CRDT/HLC semantics, or replica payload changes.
- Automatic build, redeploy, global process restart, or destructive cleanup.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: strengthen readiness diagnostics and reporting so Phase 2 reruns do not misclassify Android lifecycle failures as sync logic failures.

## Approach

1. Harden `dev:sync:doctor`/env preflight before endpoint checks: resolve installed package candidates, selected package, PID state, serial-scoped forward, and clear HTTP failure class.
2. Add native Android local-sync lifecycle observability: structured startup/skip/error logs, one idempotent ensure path, and post-start health verification.
3. Keep the server bound to `127.0.0.1`; keep foreground service as a separate escalation if tests require stability after app background/kill.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-doctor.mjs` | Modified | Failure classification before Phase 2 checks. |
| `apps/readest-app/scripts/sync-dev-env.mjs` | Modified | Package/port selection evidence. |
| `apps/readest-app/src-tauri/src/lib.rs` | Modified | Android auto-start ensure/logging path. |
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modified | Idempotent listener lifecycle checks. |
| `apps/readest-app/docs/sync-dev-harness.md` | Modified | Recovery and package-id documentation. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| App is killed by OS/user, so process-bound server still disappears | Medium | Detect explicitly; escalate to foreground service only with proof. |
| Doctor false negatives on slow devices | Medium | Separate refused from timeout and include evidence. |
| Native changes require rebuild/redeploy | High | Document validation boundary; do not assume HMR. |

## Rollback Plan

Revert this change folder and implementation commits. Existing sync APIs and routes remain unchanged, so rollback restores prior harness diagnostics/startup behavior only.

## Dependencies

- Real Android device with `adb`, USB authorization, and explicit manual rebuild/redeploy when native changes are tested.

## Success Criteria

- [ ] Doctor reports Android package, PID, forward state, and failure class before Phase 2 assertions.
- [ ] Android local sync startup is idempotent and emits actionable logs for start, skip, and failure paths.
- [ ] Phase 2 reruns distinguish lifecycle instability from sync/CRDT failures.
