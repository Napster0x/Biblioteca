# Delta for sync-crdt-hlc-real-device-harness

## ADDED Requirements

### Requirement: Android Local Sync Server Lifecycle

While the Android app process is active, the system MUST ensure local sync server startup is stable, idempotent, and observable. Repeated startup attempts MUST reuse or confirm the active listener instead of creating conflicting listeners. Startup, skip, health-check, and failure outcomes MUST emit actionable evidence for diagnostics.

#### Scenario: Active app starts local sync once

- GIVEN the Android app process is active and local sync is enabled
- WHEN the lifecycle ensure path runs more than once
- THEN exactly one usable local sync listener is available
- AND evidence identifies whether the server was started or already active

#### Scenario: Startup failure is diagnosable

- GIVEN the Android app process is active but the local sync listener cannot become healthy
- WHEN startup verification runs
- THEN the result is `FAIL` or `AMBIGUOUS`
- AND evidence includes the startup stage and health-check outcome

### Requirement: Android Package Targeting Documentation

The harness MUST document and report the selected Android package id before device checks. Package selection MUST be explicit enough to avoid targeting the wrong installed app variant.

#### Scenario: Selected package is visible

- GIVEN package candidates are installed on a connected Android device
- WHEN doctor or preflight runs
- THEN output names the selected package id and device serial
- AND documentation explains how to override or correct the selection

#### Scenario: No package candidate blocks readiness

- GIVEN no supported Android package id is installed
- WHEN doctor or preflight runs
- THEN the result is `FAIL`
- AND Phase 2 case execution MUST NOT begin

### Requirement: Phase 2 Preflight Gate

Before any Phase 2 case execution, the harness MUST run a preflight that proves package selection, app process presence, serial-scoped forwarding, Android health, desktop health, and local sync reachability. Phase 2 MUST NOT run when preflight is not `PASS`.

#### Scenario: Successful preflight unlocks cases

- GIVEN the selected Android app process is active and both endpoints are healthy
- WHEN preflight runs before Phase 2
- THEN it reports `PASS` with package, PID, forward, and health evidence
- AND Phase 2 case execution may start

#### Scenario: Failed preflight blocks cases

- GIVEN any required preflight check fails or is ambiguous
- WHEN Phase 2 is requested
- THEN the harness stops before case actions
- AND diagnosis names the failed readiness domain

## MODIFIED Requirements

### Requirement: Real-device Readiness and Discovery Diagnostics

The system MUST use continuously USB-connected real devices for validation when useful. Doctor diagnostics MUST check ADB device identity, selected package id, app process/PID presence, serial-scoped forwarding, desktop health, Android health, HTTP failure class, manifest/replica visibility, sync trigger reachability, and discovery/toggle consistency where observable. HTTP diagnostics MUST distinguish app process absent, port refused, and timeout.
(Previously: doctor checked general ADB, forwarding, health, sync, discovery, and toggle readiness without explicit package/process or refused-vs-timeout classification.)

#### Scenario: TDD diagnoses inconsistent readiness

- GIVEN endpoints are reachable but peer discovery or toggle state is unavailable or contradictory
- WHEN doctor runs
- THEN it reports `WARN` or `AMBIGUOUS` with the inconsistent evidence paths
- AND it MUST NOT claim real sync readiness as `PASS`

#### Scenario: Doctor reports absent app process

- GIVEN the selected package has no running Android PID
- WHEN doctor probes Android local sync through forwarded port
- THEN it reports `FAIL` with failure class `app-process-absent`
- AND it MUST NOT misclassify the failure as sync logic divergence

#### Scenario: Doctor separates refused from timeout

- GIVEN the selected Android process and serial-scoped forward are known
- WHEN the forwarded endpoint refuses the connection or times out
- THEN doctor reports `port-refused` or `timeout` respectively
- AND evidence includes selected package, PID state, serial, and local port
