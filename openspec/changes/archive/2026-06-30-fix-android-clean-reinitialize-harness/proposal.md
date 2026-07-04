# Proposal: Fix Android Clean Reinitialize Harness

## Intent

Make mandatory CICLO clean lifecycle-safe. After Android `pm clear`, the harness must restore local-sync readiness before any Phase 2 or mirror case runs.

## Scope

### In Scope
- Reinitialize Android after `pm clear`: inject `settings.json`, start app, wait readiness.
- Require `/health`, `/books/manifest`, and replica APIs before reset reports ready.
- Add focused tests for command order and failed readiness.

### Out of Scope
- Production sync behavior changes.
- Build/redeploy automation.
- New case semantics or Phase 2 assertions.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: Android clean must leave the app running and replica APIs ready after `pm clear`.

## Approach

Introduce a small reusable Android reinit helper used by `dev-sync-reset.mjs` after successful `pm clear` and by `dev-sync-cycle.mjs` where possible. Sequence:

`pm clear → mkdir Readest → inject settings/localSync enabled → am start → wait /health → wait /books/manifest → verify /replicas/* → return ready`.

Keep `sync-phase2-preflight.mjs` as a pure blocker; reset/up/cycle do recovery.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-reset.mjs` | Modified | Reinitialize Android after `pm clear`, including API readiness. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Reuse or align existing `spawnAndroidClean()` lifecycle path. |
| `apps/readest-app/scripts/dev-sync-up.mjs` | Modified | Optionally reuse readiness helper to reduce drift. |
| `apps/readest-app/scripts/__tests__/` | Modified | Add focused tests for lifecycle order and readiness failure. |
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modified | Add delta requirement for post-clean Android readiness. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Health passes before manifest/replicas | Medium | Wait each API explicitly. |
| ADB tunnel missing | Medium | Fail with actionable readiness error. |
| Helper refactor grows too large | Low | Keep one bounded helper; no orchestration redesign. |

## Rollback Plan

Revert the helper/tests/spec delta. Existing `pm clear` behavior remains the previous fallback state.

## Dependencies

- Connected Android device, debug `run-as`, ADB forward `tcp:7878 → tcp:7878`.

## Success Criteria

- [ ] `dev:sync:reset -- --target all --confirm DELETE_DEV_SYNC_STATE --no-dry-run` leaves Android app running.
- [ ] `/health`, `/books/manifest`, and replica APIs pass before cases start.
- [ ] `phase2.preflight` passes immediately after clean reinit when environment is otherwise valid.
