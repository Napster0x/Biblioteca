# Sync CRDT+HLC Real Device Harness Specification

## Purpose

Define the composable CLI toolbox required to implement exactly `ideal_harness.md`: real desktop↔Android USB sync testing with safe orchestration, realistic user data, semantic CRDT+HLC assertions, and inspectable evidence. The harness MUST NOT become a Markdown scenario parser, an unbounded UI automation runner, or an automatic build/redeploy system.

## Requirements

### Requirement: Harness Audit and Command Contract Stabilization

The system MUST first audit the existing harness and stabilize CLI/package-script contracts before adding new behavior. It MUST verify script paths, entrypoints, guard semantics, fixture/inject dependencies, claimed-vs-actual highlight creation, ADB forward/reverse consistency, trigger propagation, and current tests.

#### Scenario: TDD audit detects broken command contract
- GIVEN a failing test enumerates declared dev sync package scripts and CLI entrypoints
- WHEN the audit runs before feature implementation
- THEN missing or mismatched entrypoints are reported as `FAIL`
- AND implementation MUST NOT proceed to realistic actions until the contract is corrected

#### Scenario: Audit preserves existing safe behavior
- GIVEN current doctor, state, reset, clean, trigger, cycle, assert, and report commands
- WHEN the contract is stabilized
- THEN existing documented safe commands remain available or receive explicit compatible replacements

### Requirement: Human-vs-CLI Responsibility Model

The system MUST distinguish manual responsibilities from safe CLI automation. Humans keep devices USB-connected, authorize Android RSA prompts, and explicitly approve builds, redeploys, destructive cleanup, process restarts, and sensitive environment changes. CLI automation MAY run safe checks, state capture, guarded data preparation, sync triggers, assertions, and reports.

#### Scenario: TDD blocks unauthorized dangerous automation
- GIVEN tests cover build, redeploy, destructive cleanup, process restart, and global kill requests
- WHEN no explicit authorization token or flag is present
- THEN the harness refuses the operation with `BLOCKED` or `WARN`

### Requirement: Real-device Readiness and Discovery Diagnostics

The system MUST use the availability of continuously USB-connected real devices for validation when useful. Doctor diagnostics MUST check ADB device identity, serial-scoped forwarding, desktop health, Android health, manifest/replica visibility, sync trigger reachability, and discovery/toggle consistency where observable.

#### Scenario: TDD diagnoses inconsistent readiness
- GIVEN endpoints are reachable but peer discovery or toggle state is unavailable or contradictory
- WHEN doctor runs
- THEN it reports `WARN` or `AMBIGUOUS` with the inconsistent evidence paths
- AND it MUST NOT claim real sync readiness as `PASS`

### Requirement: Safe Process and Environment Orchestration

The system MAY provide orchestration helpers for `dev:server`, `dev:tauri`, and `dev:android`, but MUST be dry-run or explicitly requested, serial/port-scoped, and non-global. It MUST NOT build, install, redeploy, destructively clean, or restart user-visible processes without explicit authorization.

#### Scenario: TDD verifies dry-run planner
- GIVEN an orchestration request without authorization
- WHEN the planner runs
- THEN it lists intended commands and manual steps without starting destructive or long-running work

### Requirement: Cleanup and Reset Safety

The system MUST make reset/clean dry-run by default, require dev/test markers and explicit destructive confirmation, declare exactly what will be deleted or preserved, reject ambiguous paths, and verify clean state afterward.

#### Scenario: TDD validates cleanup verification
- GIVEN desktop and Android contain dev sync data
- WHEN confirmed cleanup runs with valid markers
- THEN post-clean state capture proves harness-owned sync/book test state is empty
- AND missing verification yields `FAIL` or `AMBIGUOUS`

### Requirement: Real Book Preparation

The system MUST support CLI preparation of real EPUB-backed test books for desktop and, when safe and observable, Android. It MUST verify library metadata, copied assets, hash/metadata/path evidence, and book deletion semantics without inventing production behavior.

#### Scenario: TDD imports and verifies a real book fixture
- GIVEN a real EPUB fixture and a target device
- WHEN prepare runs
- THEN captured state includes the book, metadata, assets, and evidence paths

### Requirement: Realistic User Action Tooling

The system MUST provide composable `action`/`inject` tooling for dictionary highlights, quote highlights, annotation highlights, edits, deletes/tombstones, duplicate/retry cases, and chained sync operations. Actions MUST operate on real prepared books or explicitly represent detached/source-unavailable data.

#### Scenario: TDD creates semantic highlight groups
- GIVEN a prepared book and failing tests for dictionary, quote, and annotation actions
- WHEN each action runs for desktop or Android
- THEN state contains the highlight plus its correct semantic group data
- AND the action evidence records target, book, range/text, generated ids, and HLC/tombstone effects

#### Scenario: TDD creates edit/delete/tombstone cases
- GIVEN existing synced data
- WHEN edits and deletes are applied on one or both devices before sync
- THEN state exposes newer/older HLCs, tombstones, and detached references required for assertions

### Requirement: Sync Triggering and Failure Propagation

The system MUST trigger specific sync operations on demand and propagate nested CLI/API failures reliably. A trigger or cycle MUST NOT return success when sync execution failed, only partially ran, or lacks enough evidence to prove success.

#### Scenario: TDD rejects false success
- GIVEN nested sync execution returns an error inside an otherwise reachable API response
- WHEN trigger or cycle evaluates the result
- THEN the command exits/reports `FAIL` with the nested error and evidence path

### Requirement: State Capture and Evidence Model

The system MUST capture before/after desktop and Android state, operations, sync order, library JSON changes, SQLite facts where available, replica payload summaries, HLC ranges, tombstones, duplicates, divergences, and cleanup status.

#### Scenario: TDD produces inspectable evidence bundle
- GIVEN a cycle with multiple actions and syncs
- WHEN report generation runs
- THEN evidence paths reference all snapshots, operations, sync attempts, assertions, and cleanup verification

### Requirement: Semantic Assertions

The system MUST assert logical convergence beyond counts: no duplicate logical rows, idempotent repeated sync, order-independent convergence, HLC newer-wins behavior where applicable, tombstone respect, no stale update resurrection, semantic highlight grouping, data survival after book deletion, detached/sourceUnavailable references, and inspectable conflicts.

#### Scenario: TDD detects semantic divergence
- GIVEN equal row counts but Android lacks a dictionary occurrence or has a duplicate quote
- WHEN assertions run
- THEN verdict is `FAIL` with the semantic mismatch and probable domain

### Requirement: Reporting Verdicts and Diagnosis

The system MUST report `PASS`, `FAIL`, `WARN`, or `AMBIGUOUS`; include diagnosis, probable failure domain, evidence paths, unavailable evidence, and cleanup outcome. Reports MUST explain divergence, not only summarize counts.

#### Scenario: TDD emits actionable diagnosis
- GIVEN library converges but dictionary occurrences do not
- WHEN report runs
- THEN it states the missing semantic entity, relevant HLC/tombstone facts, probable serialization/transport/merge domain, and final verdict

### Requirement: Degradation Rules for Android Evidence

The system MUST degrade honestly when Android `run-as`, device `sqlite3`, replica endpoints, or filesystem evidence are unavailable. Missing Android evidence MAY produce `WARN` or `AMBIGUOUS`, but MUST NOT produce false `PASS` for claims requiring that evidence.

#### Scenario: TDD prevents false PASS without SQLite
- GIVEN Android health works but SQLite evidence is unavailable
- WHEN an assertion requires Android SQLite facts
- THEN the report marks that assertion `WARN` or `AMBIGUOUS` and lists substitute evidence if any

### Requirement: Delivery and Planning Constraints

The system MUST support interactive planning, then executable safe PR slices using delivery strategy `auto-chain` and chain strategy `stacked-to-main`. Each slice MUST be Strict TDD: failing focused tests first, minimal implementation second, no builds unless authorized.

#### Scenario: TDD gate exists for every slice
- GIVEN a planned slice from audit through reporting
- WHEN implementation begins
- THEN at least one focused failing test defines the required behavior before production code changes

### Requirement: Non-goals and Scope Limits

The system MUST NOT implement a Markdown scenario parser, a monolithic hidden runner, unbounded UI automation, production sync redesign, unrequested configurability, automatic build/redeploy, or dangerous cleanup/process control without authorization.

#### Scenario: TDD rejects parser/runner scope creep
- GIVEN a request to execute arbitrary Markdown scenarios or automate UI flows without bounded commands
- WHEN the harness validates the request
- THEN it refuses or routes the user to explicit composable CLI steps
