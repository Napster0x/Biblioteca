# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

### Requirement: Android Book Delete HTTP Contract

Android MUST expose a harness-supported HTTP book delete contract, using `/books/delete` unless an explicitly documented replacement route is chosen. The contract MUST delete or tombstone only the targeted book manifest entry and MUST NOT delete D/C/N domain data. Missing target books MUST be treated as idempotent success.

#### Scenario: Android delete succeeds for existing book
- GIVEN Android has a prepared book and D/C/N data linked or adjacent to the test state
- WHEN the harness calls the Android book delete HTTP route for that book
- THEN the response is success
- AND the Android book manifest no longer exposes the active book entry
- AND D/C/N data remains available for later assertions

#### Scenario: Android delete is idempotent for missing book
- GIVEN Android has no active manifest entry for the target book
- WHEN the harness calls the Android book delete HTTP route for that book
- THEN the response is success
- AND no D/C/N data is deleted as a side effect

#### Scenario: M→O delete-book mirror can call Android without route failure
- GIVEN a mirror case needs to delete a desktop-origin book on Android
- WHEN the M→O delete-book action runs through the harness route
- THEN the action MUST NOT fail with HTTP `404`
- AND delete evidence names the route and target book

### Requirement: Desktop Book Delete Sync Propagation

Desktop book deletes or tombstones MUST propagate through sync to Android as manifest removal or tombstone convergence. Sync MUST preserve D/C/N data so semantic assertions can prove data survival after book deletion.

#### Scenario: Desktop delete removes Android manifest entry while data survives
- GIVEN desktop and Android contain the same prepared book plus D/C/N data
- WHEN the desktop book is deleted or tombstoned and sync runs to Android
- THEN Android no longer exposes the active book manifest entry
- AND Android D/C/N data remains available for assertions
- AND the report cites delete/tombstone evidence

### Requirement: Desktop Dictionary Definition HLC Convergence

Desktop-to-Android dictionary-entry sync MUST include `definition` changes and replica metadata. A newer desktop `definition` MUST update Android; an older desktop update MUST NOT overwrite a newer Android value. Detached or source-unavailable dictionary entries MUST follow the same HLC convergence rule.

#### Scenario: Newer desktop definition updates Android
- GIVEN Android has a dictionary entry with definition `old` and older HLC metadata
- WHEN desktop sync sends the same logical entry with definition `new` and newer HLC metadata
- THEN Android stores definition `new`
- AND Android-visible replica metadata reflects the newer update

#### Scenario: Older desktop definition does not overwrite Android
- GIVEN Android has a dictionary entry with definition `android-new` and newer HLC metadata
- WHEN desktop sync sends the same logical entry with definition `desktop-old` and older HLC metadata
- THEN Android keeps definition `android-new`
- AND the report identifies the stale update as skipped or unchanged

#### Scenario: Detached desktop definition edit converges
- GIVEN desktop has a detached or source-unavailable dictionary entry with an edited definition and newer HLC metadata
- WHEN desktop-to-Android sync runs
- THEN Android stores the edited definition for the same logical entry
- AND convergence does not require an active book manifest entry

### Requirement: Phase 2 P0/P1 Verification Boundary

The change MUST include focused unit or integration coverage for route, merge, and delete behavior, then a real-device rerun of the failing Phase 2 P0/P1 cases. P2 BookNote semantic delete runner work MUST remain out of scope and be tracked as follow-up.

#### Scenario: Focused tests cover remediated contracts
- GIVEN the route, delete propagation, and dictionary definition merge behaviors are implemented
- WHEN focused unit or integration tests run
- THEN tests cover successful/idempotent delete, D/C/N survival, newer-wins definition merge, older-update rejection, and detached convergence

#### Scenario: Real-device Phase 2 rerun validates P0/P1
- GIVEN focused tests pass
- WHEN the Phase 2 real-device failing cases are rerun
- THEN P0/P1 cases for book delete and dictionary definition convergence pass or provide actionable failure evidence
- AND P2 BookNote semantic delete remains reported as follow-up, not required for this change
