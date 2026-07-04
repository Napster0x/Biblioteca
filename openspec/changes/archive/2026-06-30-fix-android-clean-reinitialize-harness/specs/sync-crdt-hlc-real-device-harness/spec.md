# Delta for Sync CRDT+HLC Real Device Harness

## MODIFIED Requirements

### Requirement: Phase 2 Preflight Gate

Before any Phase 2 case execution, the harness MUST run a preflight that proves package selection, app process presence, serial-scoped forwarding, Android health, desktop health, local sync reachability, manifest availability, and replica API readiness. Phase 2 MUST NOT run when preflight is not `PASS`. After any clean/reinitialize sequence, this preflight MUST run before each case starts.
(Previously: preflight ran before Phase 2 and checked basic readiness, but did not explicitly follow clean/reinit before each case or require manifest/replica API readiness.)

#### Scenario: Successful preflight unlocks cases

- GIVEN the selected Android app process is active and both endpoints are healthy
- WHEN preflight runs before Phase 2 after clean/reinit
- THEN it reports `PASS` with package, PID, forward, health, manifest, and replica API evidence
- AND Phase 2 case execution may start

#### Scenario: Failed preflight blocks cases

- GIVEN any required preflight check fails or is ambiguous
- WHEN Phase 2 is requested
- THEN the harness stops before case actions
- AND diagnosis names the failed readiness domain

#### Scenario: Preflight is repeated per case after clean

- GIVEN multiple Phase 2 cases each request clean/reinit
- WHEN the harness prepares the next case
- THEN clean/reinit completes first and preflight runs again
- AND the case MUST NOT start without a fresh `PASS`

### Requirement: Android Clean with pm clear

The Android clean mechanism MUST use `adb shell pm clear <package>` as its primary clean operation. This MUST purge `shared_prefs/`, `app_webview/`, `cache/`, and any other app-private directories. After `pm clear`, clean MUST leave Android ready for the next case, not merely erased: it MUST re-inject local sync settings, start the app, restore or verify the forwarded port when needed, wait for `/health`, wait for `/books/manifest`, verify required replica APIs, and only then return success. All readiness waits MUST be bounded; commands MUST NOT wait indefinitely.
(Previously: clean used `pm clear`, verified empty app-private state, and re-injected `settings.json`, but readiness after clear was not required before success.)

#### Scenario: Clean leaves Android in known-empty and ready state

- GIVEN a connected Android device with the app package installed and residual sync data present
- WHEN the clean mechanism runs via `dev:sync:clean` or equivalent
- THEN `adb shell pm clear <package>` executes and returns success
- AND subsequent state capture confirms `shared_prefs/`, `app_webview/`, and `cache/` are empty
- AND settings, app process, forward, health, manifest, and replica API checks are ready before success

#### Scenario: Reinitialize restores local sync after pm clear

- GIVEN `pm clear` removed app-private settings and stopped the app process
- WHEN clean continues reinitialization
- THEN local sync settings are present, the app is running, `/health` passes, `/books/manifest` is reachable, and replica APIs are usable

#### Scenario: Readiness timeout fails before case execution

- GIVEN clean cannot restore health, manifest, forward, app process, or replica API readiness within the bounded timeout
- WHEN the clean command evaluates readiness
- THEN it reports `FAIL` with actionable diagnostics naming the failed stage and evidence
- AND no Phase 2 or mirror case execution starts
