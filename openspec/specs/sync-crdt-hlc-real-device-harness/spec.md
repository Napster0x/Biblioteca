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

### Requirement: Implement Semantic Dedup Code Path

Cases 16 and 17 require actual sync pipeline dedup, not only harness detection. The code path through `sync-execute.mjs` -> `filterUnchangedReplicas` -> `computeSemanticKey` MUST produce the same dedup behavior the harness tests.

#### Scenario: Push-side kind pass-through

- GIVEN push code calls `filterUnchangedReplicas` for dictionary-occurrence, quote, and annotation (lines 676, 687, 698)
- WHEN the push pipeline executes
- THEN kind MUST be passed as third argument
- AND semantic dedup eliminates duplicates with different replica_ids

#### Scenario: Pull-side semantic dedup for all 4 kinds

- GIVEN the pull loop at line 708 iterates `REPLICA_PULL_ORDER`
- WHEN replicas arrive from remote
- THEN `filterUnchangedReplicas` MUST receive the kind parameter
- AND semantic dedup MUST eliminate duplicates that share the computed key

### Requirement: Quotes Table Schema Completeness

The `quotes` table MUST carry `replica_timestamps TEXT` so field-level HLC timestamps are preserved, matching dictionary tables.

#### Scenario: replica_timestamps column present in quotes DDL

- GIVEN `APP_TABLE_DDL['quote']` in `sync-filter-standalone.mjs`
- WHEN `ensureReplicaTables` creates or migrates the quotes table
- THEN the DDL includes `replica_timestamps TEXT`
- AND `upsertVisibleRow` for quotes uses the column instead of setting timestamps to null

### Requirement: Failing Tests Before Implementation

Tests MUST fail before production code changes, proving each gap exists.

#### Scenario: Pull-side dedup test fails before fix

- GIVEN replicas with same semantic identity but different replica_ids for a non-dict-entry kind
- WHEN `filterUnchangedReplicas(dbPath, rows)` is called without kind (pull code path)
- THEN the test assertion for dedup count FAILS — duplicates survive

#### Scenario: Push-side kind pass-through test fails before fix

- GIVEN filterUnchangedReplicas called from push side for occurrence/quote/annotation
- WHEN the test passes kind = undefined (current broken state)
- THEN the test verifies no semantic dedup applied — FAILS

#### Scenario: Quotes schema test fails before migration

- GIVEN a fresh citas.db created by ensureReplicaTables
- WHEN the quotes column list is inspected
- THEN `replica_timestamps` is absent — test FAILS

---

## Phase 3: Light Conflicts — Concurrent Convergence

> **Phase:** 3 — Capa 3 (Ocasional) — Conflictos ligeros y convergencia concurrente
> **Cases:** 15–20

### Purpose

Define the **PASS/FAIL/WARN criteria** for sync cases 15–20 (light conflicts, concurrent convergence) from `casos_sync.md` §🥉. These are cases where both devices create, edit, or range-touch the same logical entity before synchronizing. This section establishes:

- **Identity rules** per entity kind — what makes two records "the same."
- **Normalization policies** for comparison keys.
- **Execution matrix** — each case runs with 4 symmetry/concurrency variants.
- **Case-level criteria** with formal Given/When/Then and verdict thresholds.
- **Edge case policies** for tombstones, group coexistence, and field-level merge.
- **Evidence minimums** — what proof converts a verdict to PASS vs WARN vs FAIL.

### §1 Identity Rules

#### 1.1 Book Identity

| Aspect | Rule |
|--------|------|
| **Semantic key** | `book.hash` (content hash of the EPUB/PDF file) |
| Same `hash` + same `id` | Same logical book. No duplicate. MUST converge to one entry. |
| Same `hash` + different `id` | Same logical book with different instance IDs. Policy: **merge metadata by HLC**; deduplicate into one visible library entry. Both `id` values are accepted metadata; the winning record is the one with the newer HLC timestamps per field. |
| Same `title` + different `hash` | DIFFERENT books. MUST NOT merge. Both survive as separate library entries. |
| Same `hash` + tombstone + reimport | A newer `updatedAt` (reimport) MUST resurrect the book. An older tombstone MUST NOT block the reimport. Ref: base spec §Book tombstone reimport ordering, casos_sync.md §8.5–8.6, §29.1 T005–T020. |
| **Immutable fields** | `hash`, `sourceTitle`, `format` |
| **Editable by HLC** | `title`, `author`, `coverImageUrl`, `group`/`groupId`, `readingStatus`, `progress`, all `metadata.*` fields (`subtitle`, `series`, `seriesIndex`, `seriesTotal`, `isbn`, `publisher`, `published`, `language`, `description`) |
| **Evidence required** | Desktop `library.json` per-device + Android `/books/index` manifest + `_replicas` HLC timestamps |

#### 1.2 Dictionary Entry Identity & Normalization

| Aspect | Rule |
|--------|------|
| **Semantic key** | `normalize(term) | normalize(language)` |
| Normalization function | `NFC(str).toLowerCase().replace(/\u00ad/g, '')` — Unicode NFC composition (canonical), then lowercase, then strip soft-hyphen U+00AD. Matches `normalizeTerm()` in `sync-filter-standalone.mjs` line 24-27. The guard clause in `computeSemanticKey` trims the input before calling `normalizeTerm`, but `normalizeTerm` itself does NOT trim. |
| **Accent policy** | **NFC composition.** `"solo"` (NFC = s o l o) and `"sólo"` (NFC = s ó l o) are DIFFERENT normalized keys. They are separate logical entries. Accents matter for identity. |
| **Soft-hyphen policy** | U+00AD (soft hyphen) is stripped by `normalizeTerm` via `.replace(/\u00ad/g, '')`. `"ab\u00adismo"` and `"abismo"` resolve to the same key. |
| **Case policy** | Case-insensitive. `"Zozobrar"` and `"zozobrar"` resolve to `"zozobrar"`. |
| Same normalized key | Same logical entry. One global dictionary entry. |
| Mergeable fields (HLC wins) | `definition`, `imagePath` — field-level merge by HLC timestamp |
| **Immutable fields** | `term` (identity), `displayTerm` (set = term at creation), `language`, `enrichmentStatus` |
| **Dictionary occurrences** (`F_D`) | Multiple occurrences per entry are PRESERVED. Each occurrence is an immutable event (`selectedText`, `cfi`, `contextBefore`, `contextAfter`). Occurrences from different books or different CFI ranges are separate records. |
| **Image coexistence** | If both devices set different `imagePath` for the same entry, the image with the newer HLC wins. The losing image is NOT deleted from filesystem but is no longer the active entry image. |
| **Evidence required** | Desktop `Readest/dictionary.db` → `dictionary_entries` + `dictionary_occurrences` rows + `_replicas` HLC + Android replica state |

#### 1.3 Quote Identity & Dedup

| Aspect | Rule |
|--------|------|
| **Semantic key** | `bookHash | cfi | contentHash` |
| Same `bookHash` + same `cfi/range` | Same logical quote. After sync: ONE quote. No duplicates. |
| Same `text` + different `bookHash` | **DIFFERENT quotes** (different source book). Both survive. |
| Same `bookHash` + different `cfi/range` + same `text` | Different quotes (different location). Both survive. |
| `contentHash` role | PART OF THE IDENTITY KEY. `computeSemanticKey()` for quotes uses `bookHash | cfi | contentHash` (line 56 of `sync-filter-standalone.mjs`). If `contentHash` differs, the semantic keys differ and the quotes are treated as different for dedup purposes. `contentHash` is generated by the creating client (MD5 of text in `dev-sync-fixture.mjs`); the algorithm is a client implementation detail — the sync layer treats it as an opaque string. |
| **Quotes are immutable** | No editable fields. `quote.text`, `contextBefore`, `contextAfter`, `contentHash` are all read-only once created. |
| **Evidence required** | Desktop `Readest/citas.db` → `quotes` table + `_replicas` HLC + Android replica state |

#### 1.4 Annotation Identity

| Aspect | Rule |
|--------|------|
| **Semantic key** | `book_hash | cfi | text` (immutable selected text) |
| Same `text` + same `book_hash` + same `cfi` | Same logical annotation. Policy: **deduplicate to one annotation row**. The surviving `note` is determined by HLC (newer wins). |
| Same `text` + different `book_hash` | Different annotations (different books). Both survive. |
| Same `book_hash` + different `cfi` + same `text` | Different annotations. Both survive. |
| **Immutable fields** | `text` (selected text), `color`, `style` |
| **Editable by HLC** | `note` (the user's note/comment) — field-level HLC merge |
| **Evidence required** | Desktop `Readest/annotations.db` → `annotations` table + `_replicas` HLC + Android replica state |

#### 1.5 Range / Highlight Identity

| Aspect | Rule |
|--------|------|
| **Highlight storage** | NOT a SQL entity. Highlights are `BookNote` objects inside `Books/<hash>/config.json → booknotes[]`. |
| **Highlight identity** | `bookHash | cfi/range | type | {dictionaryEntryId | citeId | annotationId}` |
| **Range equality** | Same CFI range start + end → equal ranges. |
| **Range containment** | Range A wholly contained in range B → different identities. Both coexist. |
| **Range overlap** | Ranges that partially overlap → different identities. Both coexist. **No destructive collapse.** |
| **Group coexistence** | Same range + different semantic types (`dictionaryEntryId` vs `citeId` vs `annotationId`) → MUST coexist. |
| **Same range + same type + different entity IDs** | Two distinct highlights. Both coexist if they point to different semantic entities. |
| **Highlight immutability** | **BookNotes are never edited** — only created and soft-deleted. Color, range, type, and semantic link are set at creation and immutable thereafter. |
| **Colors (verified)** | Dictionary: caller-defined. Quote: `#fca5a5` (red). Annotation: `yellow`. |
| **Evidence required** | `Books/<hash>/config.json → booknotes[]` entries with `deletedAt`, HLC timestamps, and linked entity IDs. Without `config.json` evidence for range/group claims → max verdict `WARN`. |

### §2 Execution Matrix

#### 2.1 Symmetry Variants

Every case (15–20) MUST be executed with exactly 4 variants:

| Variant | Label | Description | Purpose |
|---------|-------|-------------|---------|
| Desktop-first | `O→M` | Desktop creates/edits first. Android syncs and converges. | Control baseline from desktop. Establishes "desktop-origin" behavior. |
| Android-first | `M→O` | Android creates/edits first. Desktop syncs and converges. | Proves symmetry. No mirror phase needed. Same semantics work in both directions. |
| Concurrent A/B | `O⇄M` | Both devices create/edit BEFORE syncing. Then bidirectional sync. | Real concurrent conflict. Tests dedup, HLC ordering, field-level merge. |
| Isolated repetition | `R-n` | Each run in isolation — clean state, no state leakage from other cases. | Prevents false PASS from residual state. Each repetition starts from zero. |

#### 2.2 Evidence Requirements per Run

Each run MUST produce a bundle containing:

| Evidence item | Required for | Without → max verdict |
|---------------|-------------|----------------------|
| Pre-sync snapshots (desktop + Android) | All cases | WARN |
| Post-sync snapshots (desktop + Android) | All cases | FAIL (missing = unverifiable) |
| `_replicas` / HLC evidence | All cases | WARN |
| `config.json` → `booknotes[]` | Cases 18, 19, 20 (range/group claims) | WARN |
| Sync trigger evidence (attempted/applied counts per kind) | All cases | WARN |
| Clean verification before case starts | All cases | WARN (residual state risk) |
| Operation log (what was created/edited/deleted and when) | All cases | WARN |

**Rule:** A case cannot achieve `PASS` without both `_replicas`/HLC evidence AND the `config.json` booknotes evidence when range/group claims are needed. Without these, max verdict is `WARN`.

### §3 Case Specifications

#### 3.1 Case 15: Same Book from Both Devices

**Source:** `casos_sync.md` §8.4–8.6, §12.1–12.2, §29.3 T041

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book file imported with `hash=XYZ`, `id` may be A1 or same as Android |
| Android | Same EPUB/PDF file imported with `hash=XYZ`, `id` may be B1 or same as desktop |

**When**

- **Desktop-first variant:** Desktop imports → sync O→M → Android converges
- **Android-first variant:** Android imports → sync M→O → Desktop converges
- **Concurrent variant:** Both import offline simultaneously → sync O⇄M → both converge
- **Isolated variant:** Repeat any of the above starting from clean state

**Then**

| Field | Expected State |
|-------|----------------|
| Book count | Exactly ONE visible library entry across both devices |
| Metadata | Merged by HLC (newer timestamps win per field) |
| `id` conflict | If same `hash` + different `id`: deduplicate to one book. The winning `id` is the one with the newest HLC/metadata. Both original records are preserved in `_replicas`. |
| Tombstone interaction | If a tombstone exists on one side and the reimport is newer: book is LIVE on both. Ref: base spec §Book tombstone reimport ordering. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Exactly 1 book with hash=XYZ on both devices. Metadata converged. No duplicate library entry. `_replicas` evidence shows dedup applied. |
| **FAIL** | Two separate books with hash=XYZ on either device (duplicate). OR data loss of book metadata. OR tombstone blocks a newer reimport. |
| **WARN** | Metadata convergence cannot be verified (missing field-level timestamps). OR only one device has the deduped book. OR `_replicas` evidence incomplete. |

#### 3.2 Case 16: Same Word from Both Devices

**Source:** `casos_sync.md` §16.4, §12.3, §22.4

> **PRE-VERIFIED** — Real device (Nothing Phone A065). Verified in `fix-semantic-dedup-sync`.

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book L1 + `H_D1` → `D1(term="zozobrar")` + `F_D1` |
| Android | Book L2 + `H_D2` → `D2(term="zozobrar")` + `F_D2` |

**When**

- Both devices create the same normalized dictionary term before syncing
- Desktop-first / Android-first / Concurrent / Isolated variants apply

**Then**

| Field | Expected State |
|-------|----------------|
| Dictionary entries count | EXACTLY ONE global entry for `normalize("zozobrar")` across both devices |
| Definition | The definition with the newer HLC wins. If both set definitions, field-level HLC determines survivor. |
| `imagePath` | HLC-wins per field. Different from definition — each field resolved independently. |
| Occurrences | Both `F_D1` and `F_D2` PRESERVED. The entry has 2 occurrences. |
| Highlights | Both `H_D1` and `H_D2` preserved. Two separate highlights pointing to the same global entry. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Exactly 1 dictionary entry for `"zozobrar"` on both devices. Both occurrences (`F_D1`, `F_D2`) present. Definition and imagePath resolved by HLC. Highlights `H_D1` and `H_D2` survive. |
| **FAIL** | Two separate dictionary entries for the same word (dedup failure). OR data loss of one occurrence. OR one device loses a highlight. OR definition/image disappears. |
| **WARN** | Occurrence count differs between devices (transient sync). OR definition merge cannot be verified (missing field-level HLC). OR `config.json` missing for highlight claims. |

**Pre-verified evidence path:** `fix-semantic-dedup-sync` — real device log with replica `sent=1` for dictionary-entry and `applied=1` on Android. Both occurrences confirmed present.

#### 3.3 Case 17: Same Quote / Same Range from Both Devices

**Source:** `casos_sync.md` §17.1, §12.4, §22.3

> **PRE-VERIFIED** — Real device (Nothing Phone A065). Verified in `fix-semantic-dedup-sync`.

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_C1(range=100-120)` → `C1(text="...")` |
| Android | Book `L` + `H_C2(range=100-120)` → `C2(text="...")` |

**When**

- Both devices create a quote on the same book at the same CFI range before syncing
- Desktop-first / Android-first / Concurrent / Isolated variants apply

**Then**

| Field | Expected State |
|-------|----------------|
| Quote count | EXACTLY ONE logical quote on both devices |
| `contentHash` evidence | Both quotes have the same `contentHash` (or compatible for the same text) |
| Highlight count | One highlight `H_C` survives (not two). If both appear, they are the same BookNote resolved to the same `citeId`. |
| Dedup mechanism | `bookHash | cfi | contentHash` key eliminates the duplicate |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Exactly 1 quote + 1 highlight on both devices. Same `bookHash`, same `cfi`, same `text`. No duplicate quote rows. |
| **FAIL** | Two quote rows for the same book+range+text (duplicate). OR one device shows two highlights for the same quote. OR text content diverges. |
| **WARN** | Quote count matches but highlight count differs. OR `_replicas` evidence shows two quote entries with same semantic key (dedup applied late or on one side only). |

**Pre-verified evidence path:** `fix-semantic-dedup-sync` — real device log confirming `sent=1` quote, `applied=1` on Android, single quote row in `citas.db`.

#### 3.4 Case 18: Edit Semantic Datum with Fixed Highlight

**Source:** `casos_sync.md` §13.5–13.7, §29.4 T063

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D(range=100-120)` → `D(term="abismo", definition="deep hole")` |
| Android | Same book `L` + same `H_D` → `D(term="abismo", definition="deep hole")` (synced, converged) |

**When**

1. Desktop edits `D.definition` from `"deep hole"` to `"profound void"` (editable field)
2. Desktop syncs to Android
3. Android receives the updated definition

**Variants:**
- **Desktop-first:** Desktop edits, sync O→M, Android converges
- **Android-first:** Android edits, sync M→O, Desktop converges
- **Concurrent:** Both edit definition on the same datum before syncing → HLC wins
- **Isolated:** Repeat from clean state

**Then**

| Field | Expected State |
|-------|----------------|
| Definition | Updated to newer HLC value. On both devices. |
| Highlight `H_D` range | **UNCHANGED.** `range=100-120` remains identical. The highlight is a visual marker, not affected by datum edits. |
| Highlight color | **UNCHANGED.** Color was set at creation. |
| Highlight BookNote | `BookNote` in `config.json` must show the same CFI range before and after. |
| Datum identity | Same `term`, same `id`, same `language`. Only `definition` changed. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Definition updated on both devices to the newer HLC value. Highlight range in `config.json` is identical to pre-edit snapshot. Highlight color unchanged. No duplicate entries. |
| **FAIL** | Highlight range changed (drifted). OR highlight color changed. OR definition update lost. OR datum duplicated. OR BookNote detached from the datum. |
| **WARN** | Definition converged but `config.json` snapshot missing (cannot verify highlight stability). OR definition updated but highlight `dictionaryEntryId` reference lost and re-created. |

#### 3.5 Case 19: Same Range, Different Groups

**Source:** `casos_sync.md` §15.3, §19.1–§19.3

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_D(range=100-110)` → `D(term="abismo")` |
| Android | Book `L` + `H_C(range=100-110)` → `C(text="...")` |

**When**

- Desktop creates a dictionary highlight at range 100-110
- Android creates a quote highlight at the SAME range 100-110
- Both sync

**Variants:**
- **Desktop-first:** Dictionary created first, sync, then quote created, sync
- **Android-first:** Quote created first, sync, then dictionary, sync
- **Concurrent:** Both created offline before any sync
- **Isolated:** Repeat from clean state

**Then**

| Field | Expected State |
|-------|----------------|
| Dictionary entry | Present on both devices. One entry for `"abismo"`. |
| Quote | Present on both devices. One quote with the text. |
| Highlights | **TWO** distinct highlights on the SAME range: one `H_D` (dictionary, caller-defined color) and one `H_C` (quote, `#fca5a5` red). |
| `config.json` evidence | `booknotes[]` MUST contain BOTH entries with distinct `dictionaryEntryId` and `citeId` respectively. Both must have `deletedAt: null`. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Both devices have: (a) dictionary entry, (b) quote, (c) two separate highlights for the same range pointing to different semantic entities. `config.json` proves both BookNotes coexist without deletion. |
| **FAIL** | One highlight collapsed/deleted due to range conflict. OR one semantic datum (D or C) missing. OR both highlights merged into one. OR data loss. |
| **WARN** | Highlights present but `config.json` evidence missing or incomplete. OR highlight count differs between devices (one device still converging). |

#### 3.6 Case 20: Overlapping Ranges

**Source:** `casos_sync.md` §15.4

**Given**

| Device | Initial State |
|--------|---------------|
| Desktop | Book `L` + `H_C(range=100-150)` → `C(text="...")` |
| Android | Book `L` + `H_N(range=120-180)` → `N(note="...")` |

**When**

- Desktop creates a quote highlight spanning CFI 100-150
- Android creates an annotation highlight spanning CFI 120-180 (partial overlap: 120-150 is shared territory)
- Both sync

**Variants:**
- **Desktop-first:** Quote created first, sync, then annotation, sync
- **Android-first:** Annotation created first, sync, then quote, sync
- **Concurrent:** Both created offline before any sync
- **Isolated:** Repeat from clean state

**Then**

| Field | Expected State |
|-------|----------------|
| Quote | Present on both devices with `range=100-150`. Immutable. |
| Annotation | Present on both devices with `range=120-180`. `note` editable by HLC. |
| Highlights | **TWO** distinct highlights with DIFFERENT ranges. `H_C(range=100-150)` and `H_N(range=120-180)` coexist. |
| `config.json` evidence | `booknotes[]` MUST contain both BookNotes with their respective ranges. Neither highlight is deleted or range-modified due to the overlap. |
| Coexistence rule | **Partial overlap → both survive. No destructive collapse.** The ranges are independent geometric identities. |

**Verdict Criteria**

| Verdict | Condition |
|---------|-----------|
| **PASS** | Both devices have: (a) quote with range 100-150, (b) annotation with range 120-180, (c) both ranges in `config.json` booknotes. Neither range was modified or collapsed. Both semantic data present. |
| **FAIL** | One range was destructively collapsed into the other. OR one datum/quote missing. OR only one highlight survives. OR ranges were merged into a super-range that loses fidelity. |
| **WARN** | Ranges preserved but `config.json` evidence missing. OR one device still converging (transient). |

### §4 Edge Case Policy

#### 4.1 Tombstones and Reimport after Delete (for Case 15)

| Rule | Description |
|------|-------------|
| Tombstone identity | A tombstone is a book deletion marker tied to a specific `hash` + generation. |
| Same-hash reimport | A reimport of the same EPUB/PDF (`hash=XYZ`) with `updatedAt > deletedAt` MUST resurrect the book. |
| Multiple tombstones | Two tombstones (one from each device) for the same hash do NOT compound. A single newer reimport beats all older tombstones. |
| Stale tombstone after reimport | An older tombstone arriving AFTER a newer reimport (out-of-order delivery) MUST NOT hide the reimport. HLC ordering: the reimport wins per base spec §Book tombstone reimport ordering. |
| **Evidence requirement** | For PASS verdict, the report MUST prove `updatedAt > deletedAt` for the winning reimport. Without HLC timestamps: max WARN. |

#### 4.2 Group Coexistence Rules (for Cases 19, 20)

| Rule | Description |
|------|-------------|
| Same-range coexistence | Two highlights with the same CFI range but different `{dictionaryEntryId | citeId | annotationId}` MUST coexist. |
| Different-type coexistence | Dictionary + Quote + Annotation on the same range → THREE highlights. All coexist. |
| Same-type different entity | Two dictionary entries on the same range (e.g., two different words) → TWO highlights. Both coexist. |
| Overlap coexistence | Ranges that partially overlap → both survive as independent geometric identities. |
| **Never collapse** | The system MUST NOT collapse two highlights into one, merge ranges, or delete one highlight to "resolve" an overlap. Ranges are immutable after creation. |
| **Evidence floor** | Without `config.json` booknotes proving coexistence → max WARN. Counts from replica alone are insufficient for range/group coexistence claims. |

#### 4.3 Field-level Merge vs Entity-level Merge

| Aspect | Rule |
|--------|------|
| Entity-level identity | Dedup by semantic key (identity rules above) happens at entity level: ONE logical row per key. |
| Field-level merge | Editable fields are merged INDEPENDENTLY by HLC. `definition` and `imagePath` on a dictionary entry have separate HLC timestamps and are resolved separately. |
| Immutable fields never merge | `term`, `language`, `text`, `cfi`, `selectedText`, `hash` — these are never overwritten. On dedup, the first-created value stands (or the one with the highest HLC if timestamps exist, but semantically they should be identical). |
| Mixed edit + create concurrent | If A creates a datum with `definition=A` and B creates the same datum (same key) with `definition=B`, field-level HLC determines which definition survives. The entity itself is deduplicated to one. |
| Edit + concurrent delete | Ref: base spec §Book tombstone reimport ordering for book tombstones. For dictionary/quote/annotation tombstones: newer edit beats older delete. Newer delete beats older edit. Rule: **HLC timestamp decides at entity level** for delete vs edit conflicts. |

### §5 Verification Evidence Requirements

#### 5.1 Evidence Minimums per Verdict

| Claim | Minimum Evidence for PASS | Without → max verdict |
|-------|---------------------------|-----------------------|
| Entity convergence | `_replicas` HLC timestamps + post-sync state on both devices | WARN |
| No duplicates | Row counts match expectations + replica dedup evidence | FAIL if duplicates visible; WARN if unreproducible |
| Range/group coexistence | `config.json` → `booknotes[]` with all expected entries + ranges | WARN |
| Field-level merge | Per-field HLC timestamps in `_replicas` | WARN |
| Highlight stability (C18) | Pre/post `config.json` snapshots showing identical range + type + color | WARN |
| Tombstone defeat (C15) | HLC timestamps proving `updatedAt > deletedAt` for the winning reimport | WARN |
| Desired book count | `library.json` / `/books/index` manifest count per device | FAIL if wrong; WARN if one device not verified |

#### 5.2 Verdict Determinism Matrix

```
                     Evidence Complete          Evidence Partial        Evidence Missing
Converged           ───────── PASS ──────       ──────── WARN ─────       ────── WARN ─────
Diverged            ───────── FAIL ──────       ──────── FAIL ─────       ────── WARN ─────
Ambiguous counts    ───────── WARN ──────       ──────── WARN ─────       ────── WARN ─────
```

#### 5.3 Pre-verified Cases: Evidence Path Reference

**Cases 16 and 17** were pre-verified on real device (Nothing Phone A065) under `fix-semantic-dedup-sync`. Evidence saved at:

- Case 16: Engram observation logs from `2026-07-04-fix-semantic-dedup-slice2` session. Desktop `dictionary.db` shows 1 entry, 2 occurrences. Android replica state confirms `dictionary-entry sent=1, applied=1`.
- Case 17: Engram observation logs from same session. Desktop `citas.db` shows 1 quote. Android replica state confirms `quote sent=1, applied=1`.

These cases do NOT need re-execution but their PASS criteria are formally defined here for the first time. The existing evidence satisfies the criteria defined in §3.2 and §3.3.

#### 5.4 Reporting Template

Each case execution MUST produce a structured report:

```markdown
## Case {N}: {Name} — {Variant}

### Devices
- Desktop: {snapshot path}
- Android: {snapshot path}

### Operations
- Desktop: {what was created/edited/deleted}
- Android: {what was created/edited/deleted}

### Sync Order
{desktop-first | android-first | concurrent | isolated-N}

### Evidence
- `_replicas` HLC: {path}
- `config.json` booknotes: {path}
- Pre-snapshots: {path}
- Post-snapshots: {path}

### Verdict
{PASS | FAIL | WARN}

### Diagnosis (if not PASS)
{reasoning}

### Evidence Gaps (if any)
{what was missing}
```

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-07-04 | Added Phase 3: Light Conflicts (Cases 15–20) — identity rules, execution matrix, PASS/FAIL/WARN criteria, edge policy, evidence requirements | SDD Archive |
