# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

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
