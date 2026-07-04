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

### Requirement: Desktop Dictionary Replica Transport

Sync execution MUST collect `dictionary_entries` and `dictionary_occurrences` from the desktop local `Readest/dictionary.db` when rows exist. It MUST PUT dictionary-entry rows to Android `/replicas/dictionary-entry` and dictionary-occurrence rows to Android `/replicas/dictionary-occurrence`. Existing book/library sync behavior MUST remain compatible and continue to run for prepared books.

#### Scenario: Caso 3 sends desktop dictionary rows to Android

- GIVEN desktop has a prepared book plus local `dictionary_entries` and `dictionary_occurrences`
- WHEN the sync trigger executes against Android
- THEN Android receives at least one `dictionary-entry` replica row
- AND Android receives at least one `dictionary-occurrence` replica row
- AND the existing book/library sync result remains present

#### Scenario: No dictionary rows preserves book sync

- GIVEN desktop has prepared book data but no dictionary rows
- WHEN the sync trigger executes against Android
- THEN dictionary-entry and dictionary-occurrence replica sent counts are `0`
- AND book/library sync continues without being skipped or reclassified as dictionary sync

### Requirement: Desktop Quote Replica Transport

Sync execution MUST collect `quotes` rows from desktop `Readest/citas.db` (table: `quotes`) when rows exist. It MUST PUT quote rows to Android `/replicas/quote`. Existing book and dictionary sync behavior MUST remain compatible and continue to run.

#### Scenario: Caso 4 sends desktop quote rows to Android

- GIVEN desktop has a prepared book plus local `quotes` rows in `citas.db`
- WHEN the sync trigger executes against Android
- THEN Android receives at least one `quote` replica row
- AND existing book and dictionary sync results remain present

#### Scenario: No quote rows preserves book and dictionary sync

- GIVEN desktop has prepared book and dictionary data but no quote rows
- WHEN the sync trigger executes against Android
- THEN quote replica sent count is `0`
- AND book/library and dictionary sync continue without being skipped

### Requirement: Distinct Book, Dictionary, Quote, and Annotation Evidence

Evidence and reports MUST distinguish the book/library sent count from dictionary, quote, and annotation replica transport counts. Dictionary-entry, dictionary-occurrence, quote, and annotation counts MUST be separately visible so a book `sent` value cannot be interpreted as dictionary, quote, or annotation replica delivery.

#### Scenario: Evidence separates book and replica counts

- GIVEN sync sends one book and dictionary replica rows
- WHEN trigger evidence or the final report is generated
- THEN book sent count is reported as book/library evidence
- AND dictionary-entry and dictionary-occurrence replica counts are reported separately

#### Scenario: Missing dictionary evidence fails Caso 3

- GIVEN Caso 3 expects dictionary convergence after sync
- WHEN evidence only proves book/library sync
- THEN the harness MUST NOT report `PASS`
- AND diagnosis identifies missing dictionary replica transport evidence

#### Scenario: Evidence separates book, dictionary, and quote counts

- GIVEN sync sends one book, dictionary replica rows, and quote replica rows
- WHEN trigger evidence or the final report is generated
- THEN book sent count is reported as book/library evidence
- AND dictionary-entry, dictionary-occurrence, and quote replica counts are reported separately

#### Scenario: Missing quote evidence fails Caso 4

- GIVEN Caso 4 expects quote convergence after sync
- WHEN evidence only proves book/library or dictionary sync
- THEN the harness MUST NOT report `PASS`
- AND diagnosis identifies missing quote replica transport evidence

#### Scenario: Evidence separates book, dictionary, quote, and annotation counts

- GIVEN sync sends one book, dictionary, quote, and annotation replica rows
- WHEN trigger evidence or the final report is generated
- THEN book sent count is reported as book/library evidence
- AND dictionary-entry, dictionary-occurrence, quote, and annotation replica counts are reported separately

#### Scenario: Missing annotation evidence fails Caso 5

- GIVEN Caso 5 expects annotation convergence after sync
- WHEN evidence only proves book/library, dictionary, or quote sync
- THEN the harness MUST NOT report `PASS`
- AND diagnosis identifies missing annotation replica transport evidence

### Requirement: Caso 3 End-to-End Dictionary Receive Pass

The Caso 3 harness MUST pass only when the clean + prepare + fixture + sync flow leaves Android with at least one dictionary-entry replica and at least one dictionary-occurrence replica. The assertion MUST use Android-visible replica state, not only desktop source rows or book sync counts.

#### Scenario: Clean prepare fixture sync converges dictionary replicas

- GIVEN Android and desktop are cleaned, a real book is prepared, and fixture dictionary data is created on desktop
- WHEN the harness runs sync
- THEN Android replica state shows `dictionary-entry >= 1`
- AND Android replica state shows `dictionary-occurrence >= 1`
- AND the report can cite evidence for both counts

#### Scenario: Android lacks either dictionary kind after sync

- GIVEN Caso 3 ran clean + prepare + fixture + sync
- WHEN Android has zero dictionary-entry or zero dictionary-occurrence replicas
- THEN the harness reports `FAIL`
- AND diagnosis points to dictionary replica serialization, transport, or Android receive evidence

### Requirement: Caso 4 End-to-End Quote Receive Pass

The Caso 4 harness MUST pass only when the clean + prepare + fixture + sync flow leaves Android with at least one `quote` replica. The assertion MUST use Android-visible replica state, not only desktop source rows.

#### Scenario: Clean prepare fixture sync converges quote replicas

- GIVEN Android and desktop are cleaned, a real book is prepared, and fixture quote data is created on desktop
- WHEN the harness runs sync
- THEN Android replica state shows `quote >= 1`
- AND the report can cite evidence for the count

#### Scenario: Android lacks quote replicas after sync

- GIVEN Caso 4 ran clean + prepare + fixture + sync
- WHEN Android has zero quote replicas
- THEN the harness reports `FAIL`
- AND diagnosis points to quote replica serialization, transport, or Android receive evidence

### Requirement: Desktop Annotation Replica Transport

Sync execution MUST collect `annotations` rows from desktop `Readest/annotations.db` (table: `annotations`) when rows exist. It MUST PUT annotation rows to Android `/replicas/annotation`. Existing book, dictionary, and quote sync behavior MUST remain compatible and continue to run.

#### Scenario: Caso 5 sends desktop annotation rows to Android

- GIVEN desktop has a prepared book plus local `annotations` rows in `annotations.db`
- WHEN the sync trigger executes against Android
- THEN Android receives at least one `annotation` replica row
- AND existing book, dictionary, and quote sync results remain present

#### Scenario: No annotation rows preserves book, dictionary, and quote sync

- GIVEN desktop has prepared book, dictionary, and quote data but no annotation rows
- WHEN the sync trigger executes against Android
- THEN annotation replica sent count is `0`
- AND book/library, dictionary, and quote sync continue without being skipped

### Requirement: Caso 5 End-to-End Annotation Receive Pass

The Caso 5 harness MUST pass only when the clean + prepare + fixture + sync flow leaves Android with at least one `annotation` replica. The assertion MUST use Android-visible replica state, not only desktop source rows.

#### Scenario: Clean prepare fixture sync converges annotation replicas

- GIVEN Android and desktop are cleaned, a real book is prepared, and fixture annotation data is created on desktop
- WHEN the harness runs sync
- THEN Android replica state shows `annotation >= 1`
- AND the report can cite evidence for the count

#### Scenario: Android lacks annotation replicas after sync

- GIVEN Caso 5 ran clean + prepare + fixture + sync
- WHEN Android has zero annotation replicas
- THEN the harness reports `FAIL`
- AND diagnosis points to annotation replica serialization, transport, or Android receive evidence

### Requirement: Caso 7 Android Replica Pull

Sync execution MUST pull Android-visible ReplicaRows for `dictionary-entry`, `dictionary-occurrence`, `quote`, and `annotation` during Caso 7. Missing, malformed, or unavailable pull evidence MUST prevent a Caso 7 `PASS`.

#### Scenario: Pulls all Android replica kinds

- GIVEN Android exposes ReplicaRows for dictionary-entry, dictionary-occurrence, quote, and annotation
- WHEN Caso 7 sync execution runs
- THEN the executor requests all four Android replica kinds
- AND evidence records pulled counts per kind

#### Scenario: Missing Android pull evidence blocks PASS

- GIVEN Caso 7 requires Android-to-desktop convergence
- WHEN any required Android replica kind lacks usable pull evidence
- THEN the harness MUST NOT report `PASS`
- AND diagnosis names the missing replica kind

### Requirement: Caso 7 Desktop Apply and Ordering

Pulled Android ReplicaRows MUST be applied to the matching desktop visible tables and replica metadata: dictionary rows in `Readest/dictionary.db`, quote rows in `Readest/citas.db`, and annotation rows in `Readest/annotations.db`. `dictionary-entry` MUST be applied before `dictionary-occurrence`.

#### Scenario: Applies pulled rows to desktop stores

- GIVEN Android provides valid ReplicaRows for all four kinds
- WHEN Caso 7 sync execution completes
- THEN desktop visible tables contain the dictionary entry, dictionary occurrence, quote, and annotation
- AND desktop replica metadata contains matching replica state for each applied row

#### Scenario: Dictionary entry precedes occurrence

- GIVEN Android provides a dictionary occurrence that references a pulled dictionary entry
- WHEN Caso 7 applies pulled dictionary ReplicaRows
- THEN the dictionary entry is applied before the occurrence
- AND the occurrence is not reported as converged without its entry

### Requirement: Caso 7 Idempotent HLC Convergence

Desktop application MUST be idempotent. Equal or older pulled ReplicaRows MUST NOT duplicate rows or overwrite newer desktop state, so the second Caso 7 sync preserves Caso 8 idempotence expectations.

#### Scenario: Second sync is idempotent

- GIVEN Caso 7 has already applied Android ReplicaRows to desktop
- WHEN the same Android ReplicaRows are pulled again
- THEN desktop row counts and visible values remain unchanged
- AND the report can cite skipped or unchanged rows without failing

#### Scenario: Older Android row does not overwrite desktop

- GIVEN desktop has newer replica metadata for a logical row
- WHEN Android returns an older ReplicaRow for that row
- THEN desktop visible data remains the newer value
- AND Caso 8 idempotence MUST still be reportable as passing

### Requirement: Additive Android-to-Desktop Evidence

Evidence and reports MUST add Android-to-desktop fields such as per-kind `pulled` and `appliedToDesktop` without renaming, removing, or reinterpreting existing Desktop-to-Android `attempted`, `applied`, or sent-count evidence.

#### Scenario: Reports additive pull and apply counts

- GIVEN Caso 7 pulls and applies Android ReplicaRows
- WHEN trigger evidence or the final report is generated
- THEN each replica kind shows `pulled` and `appliedToDesktop` counts
- AND existing Desktop-to-Android evidence fields remain present

#### Scenario: Desktop-to-Android behavior does not regress

- GIVEN existing Caso 3, Caso 4, or Caso 5 Desktop-to-Android sync expectations
- WHEN the new Android-to-desktop pull step is present
- THEN desktop-sourced dictionary, quote, and annotation rows are still sent to Android as before
- AND reports MUST NOT reinterpret book/library counts as replica pull evidence

### Requirement: Caso 8 Push Idempotence

The Desktop-to-Android push phase MUST filter out replicas already recorded in Desktop `_replicas` with equal-or-higher `updated_at_ts` using the HLC gate. Repeated sync with no data changes MUST produce `attempted=0` for all four replica kinds: dictionary-entry, dictionary-occurrence, quote, and annotation — whether executed via direct CLI invocation or via the cycle harness HTTP trigger chain (dataRoot MUST propagate from cycle through sync-trigger route to spawned sync-execute). An empty `_replicas` on first sync (bootstrapping) MUST NOT block the push.

#### Scenario: First sync bootstraps with empty _replicas

- GIVEN Desktop has fixture data and empty `_replicas`
- WHEN sync executes
- THEN `attempted > 0` for all four replica kinds

#### Scenario: Second sync with no changes produces zero operations

- GIVEN first sync completed and no desktop data changed
- WHEN sync executes again
- THEN dictionary-entry `attempted=0` AND `applied=0`
- AND dictionary-occurrence `attempted=0` AND `applied=0`
- AND quote `attempted=0` AND `applied=0`
- AND annotation `attempted=0` AND `applied=0`

#### Scenario: Cycle-triggered second sync also produces zero operations

- GIVEN first sync completed via cycle harness and no desktop data changed
- WHEN cycle triggers a second sync via HTTP POST to sync-trigger route
- THEN `attempted=0` AND `applied=0` for all four replica kinds

#### Scenario: HLC gate blocks already-synced replicas

- GIVEN `_replicas` holds entry with `updated_at_ts = 100`
- WHEN push reads same row with `updated_at_ts <= 100`
- THEN the row is excluded from PUT batch

#### Scenario: New or changed replicas pass the HLC gate

- GIVEN `_replicas` holds entry with `updated_at_ts = 100`
- WHEN push reads same row with `updated_at_ts > 100`
- THEN the row is included in PUT batch

#### Scenario: Caso 7 bidirectional sync preserved

- GIVEN Caso 7 pull populated Desktop `_replicas` with Android-sourced rows
- WHEN Caso 8 push executes afterward
- THEN Android-sourced replicas are NOT re-pushed to Android
- AND Caso 7 evidence fields (`pulled`, `appliedToDesktop`) remain unchanged

#### Scenario: Per-kind zero-attempted evidence on empty push

- GIVEN second sync produced `attempted=0` for all kinds
- WHEN report is generated
- THEN each replica kind explicitly reports `attempted=0`
- AND zero-attempted is NOT interpreted as evidence failure

#### Scenario: Direct CLI execution preserves v1 behavior

- GIVEN sync-execute.mjs invoked via direct CLI with explicit dataRoot env var
- WHEN pull filter is present in pull loop
- THEN push idempotence behavior identical to v1

### Requirement: Caso 8 Pull-Side Pre-Filter

Pull evidence counts MUST reflect filtered replicas only. Before applying pulled Android ReplicaRows to Desktop, the pull loop MUST apply `filterUnchangedReplicas()` and override `pulled` to the filtered length. When all pulled replicas already exist in Desktop `_replicas` with equal-or-higher HLC, evidence MUST show `pulled=0` AND `appliedToDesktop=0`. New replicas MUST pass through to Desktop apply.

#### Scenario: All replicas already in _replicas produces pulled=0

- GIVEN all Android replicas for a kind already recorded in Desktop `_replicas`
- WHEN sync pull executes
- THEN `pulled=0` AND `appliedToDesktop=0` for that kind

#### Scenario: Unseen replicas pass the pull filter

- GIVEN Android returns a replica NOT in Desktop `_replicas`
- WHEN sync pull executes
- THEN replica included in `pulled` count and passed to apply

#### Scenario: Pull filter does not block Caso 7 first sync

- GIVEN Desktop `_replicas` empty (clean state)
- WHEN first sync pulls Android replicas
- THEN `pulled > 0` for all kinds with Android data

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

### Requirement: Book Metadata Update Detection in pushBooks

When pushBooks() processes a book whose hash already exists in the remote manifest, the system MUST compare `updatedAt` timestamps. If local `book.updatedAt > remoteBook.updatedAt`, the system MUST push the library entry metadata via `transport.pushBookLibrary([book])`. The system MUST track these pushes in the `updated` counter separate from `sent`.

#### Scenario: Title edit pushes metadata to Android

- GIVEN desktop has a book synced to Android with `remoteBook.updatedAt = 100` and the user edits the book title, bumping `book.updatedAt` to `101`
- WHEN pushBooks() runs against the remote manifest
- THEN the book's library entry is pushed to Android via `/books/index`
- AND the return value increments the `updated` counter

#### Scenario: Author edit also triggers update

- GIVEN a synced book where local `updatedAt > remote.updatedAt` due to an author field change
- WHEN pushBooks() runs
- THEN the book library entry is pushed with the updated author metadata

#### Scenario: No-op sync skips unchanged books

- GIVEN local and remote `updatedAt` are equal and the book hash exists on remote
- WHEN pushBooks() runs
- THEN the book is skipped (neither `sent` nor `updated`)
- AND existing hash-based skip behavior for truly identical books is preserved

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

### Requirement: Book tombstone reimport ordering

The harness MUST treat book tombstones and same-hash reimports as timestamp-ordered book-library facts. A newer legitimate reimport MUST resurrect the book; an older tombstone MUST NOT hide or re-delete that reimport.

#### Scenario: 13a O→M newer same-hash desktop reimport resurrects book

- GIVEN desktop has a tombstoned book entry and the same EPUB hash is reimported with `updatedAt` newer than `deletedAt`
- WHEN desktop prepares and syncs to Android
- THEN the desktop book entry is live with `deletedAt` cleared
- AND Android receives the resurrected or updated live book entry

#### Scenario: Older tombstone loses to newer reimport

- GIVEN a live desktop reimport has an `updatedAt` newer than a known book tombstone
- WHEN tombstone reconciliation runs during sync
- THEN the book remains live on desktop and Android
- AND the older tombstone MUST NOT be propagated as the winning state

### Requirement: Remote book tombstones are merged before local book push

Before pushing desktop book-library state, sync MUST evaluate Android `/books/index` book tombstones. A newer Android-originated book tombstone MUST be applied to desktop first so stale local book state cannot accidentally resurrect the book.

#### Scenario: Remote tombstone blocks accidental resurrection

- GIVEN Android `/books/index` contains a tombstone newer than desktop's local live book entry
- WHEN desktop-to-Android sync starts
- THEN desktop records the book as tombstoned before any book push decision
- AND sync MUST NOT push the stale live book as a resurrection

#### Scenario: Newer local reimport may still beat older remote tombstone

- GIVEN desktop has a live reimport with `updatedAt` newer than Android's book tombstone
- WHEN sync reconciles remote tombstones before push
- THEN the desktop reimport remains the winning book state
- AND Android receives the live reimported book entry

### Requirement: Android book delete propagates without D/C/N loss

For Phase 2 cases `10Ma`, `10Mb`, and `10Mc`, an Android-originated book delete MUST converge to a desktop book tombstone. Dictionary, citation/quote, and note/annotation data (D/C/N) MUST survive as independent semantic data.

#### Scenario: 10Ma M→O Android book delete creates desktop tombstone

- GIVEN Android deletes a synced book and exposes a newer book tombstone
- WHEN desktop syncs from Android
- THEN desktop `library.json` records the book tombstone
- AND the book is not restored by stale desktop state

#### Scenario: 10Mb M→O preserves dictionary and citation data

- GIVEN dictionary and citation/quote rows exist for the deleted book
- WHEN the Android book tombstone propagates to desktop
- THEN dictionary rows remain present and assertable
- AND citation/quote rows remain present and assertable

#### Scenario: 10Mc M→O preserves note and annotation data

- GIVEN note/annotation rows exist for the deleted book
- WHEN the Android book tombstone propagates to desktop
- THEN note/annotation rows remain present and assertable
- AND reports MUST NOT classify D/C/N survival as book resurrection

### Requirement: Android Book Metadata Edit Case 9Ma

The harness MUST support Phase 2 case `9Ma` through an Android-originated book metadata edit using the safe HTTP/fixture path. It MUST prove the edited metadata has a newer timestamp/HLC than the previous book fact, converges to desktop, and is not masked by stale local state.

#### Scenario: 9Ma Android metadata edit converges
- GIVEN a synced EPUB-backed book exists on desktop and Android
- WHEN Android edits book metadata for `9Ma` through the harness action
- THEN desktop and Android show the edited metadata with newer timestamp/HLC ordering
- AND the report cites before/after book evidence for both devices

#### Scenario: 9Ma blocked diagnostics
- GIVEN Android book index update, fixture data, or timestamp evidence is unavailable
- WHEN `9Ma` runs
- THEN the harness reports `BLOCKED`, `FAIL`, or `AMBIGUOUS` with the failed capability and evidence path
- AND it MUST NOT report `PASS`

### Requirement: Android Import and Same-hash Reimport Case 13Ma

The harness MUST support Phase 2 case `13Ma` for Android EPUB/book import and reimport. Same-hash reimport after a tombstone MUST be safe: a newer live reimport SHALL resurrect the book, while older tombstones SHALL NOT win.

#### Scenario: 13Ma same-hash reimport after tombstone passes
- GIVEN Android has a tombstoned book entry for a known EPUB hash
- WHEN Android reimports the same EPUB hash with a newer live timestamp
- THEN desktop and Android converge on the live book entry
- AND evidence shows the tombstone lost by timestamp/HLC ordering

#### Scenario: 13Ma no false PASS on unsafe import evidence
- GIVEN asset copy, book index, hash, or tombstone ordering evidence is missing
- WHEN `13Ma` is evaluated
- THEN the harness reports non-success with the missing evidence class
- AND it MUST NOT infer resurrection from counts alone

### Requirement: Semantic Highlight Delete Cases 14

The harness MUST support semantic BookNote/highlight delete tooling for `14a`, `14b`, `14c`, `14Ma`, `14Mb`, and `14Mc`. Deleting a highlight association MUST delete only its associated dictionary, quote, or annotation semantic data, using safe target resolution that prevents unrelated row deletion.

#### Scenario: Associated semantic data is deleted
- GIVEN a dictionary, quote, or annotation highlight association has a resolved semantic target
- WHEN the user deletes that highlight association through a `14*` or `14M*` action
- THEN the associated semantic data is deleted or tombstoned on the source device
- AND convergence proves the deletion on the peer device

#### Scenario: Ambiguous target prevents deletion
- GIVEN target resolution matches zero or multiple semantic rows
- WHEN a `14*` delete action is requested
- THEN the harness reports `BLOCKED` or `FAIL` with target-resolution diagnostics
- AND it MUST NOT delete unrelated dictionary, quote, or annotation rows

#### Scenario: No false PASS for association-only removal
- GIVEN the highlight association is gone but associated semantic data remains live
- WHEN the case report is generated
- THEN the verdict is `FAIL`
- AND diagnosis names the surviving semantic data kind and target id

### Requirement: Bounded Real-device Reliability Classification

The capability suite MUST demonstrate greater than `80%` real-device reliability over bounded repeated runs. Each attempt MUST be time-bounded and classified as harness, environment, product, or unknown failure; non-success attempts SHALL reduce the measured reliability.

#### Scenario: Reliability threshold passes with evidence
- GIVEN a bounded repeated run set for the Phase 2 capability suite
- WHEN definitive successful attempts exceed `80%`
- THEN the report states `PASS` with numerator, denominator, case list, and evidence paths

#### Scenario: Reliability below threshold diagnoses failures
- GIVEN repeated runs complete but success rate is `<=80%`
- WHEN the reliability report is produced
- THEN the report is `FAIL` with per-attempt failure classification
- AND it MUST NOT hide blocked, ambiguous, timeout, or environment failures from the denominator
