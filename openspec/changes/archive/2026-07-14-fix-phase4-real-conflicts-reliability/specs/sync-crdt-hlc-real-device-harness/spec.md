# Delta for sync-crdt-hlc-real-device-harness

## ADDED Requirements

### Requirement: Phase 4 Failure-domain Classification

The harness MUST classify each non-pass by the failing claim, not by global Android `sqlite3` availability. Missing `sqlite3` MUST be recorded as unavailable evidence only.

#### Scenario: Missing sqlite3 does not contaminate product failures
- GIVEN Android HTTP/config evidence is available and `sqlite3` is unavailable
- WHEN a Phase 4 assertion observes convergence divergence
- THEN `failureDomain` MUST be `product` or `harness`, not `environment`
- AND unavailable evidence lists `android.sqlite3`.

#### Scenario: Environment only for blocking prerequisites
- GIVEN app process, ADB, forward, or HTTP health blocks execution
- WHEN no substitute evidence can prove the case outcome
- THEN `failureDomain` MAY be `environment` with the blocking prerequisite named.

### Requirement: Android Substitute Evidence Completeness

When Android `sqlite3` is unavailable, the report MUST include sufficient HTTP/config substitute evidence for cases 22a, 22c, 24, 25, and 26, or cap the verdict at `WARN` with explicit gaps.

#### Scenario: HTTP/config evidence substitutes for sqlite3
- GIVEN Android rows cannot be read with `sqlite3`
- WHEN HTTP replica, manifest, or `config.json` evidence proves the expected state
- THEN the case MAY report `PASS`
- AND the report cites each substitute path and the unavailable SQLite path.

#### Scenario: Insufficient substitute evidence is visible
- GIVEN required Android evidence is absent or incomplete
- WHEN the case is evaluated
- THEN the verdict MUST be `WARN` or `FAIL` per observed outcome
- AND missing evidence MUST be listed per claim.

### Requirement: Cases 21a–21d Deterministic Same-field Resolution

Cases 21a–21d MUST converge deterministically by full HLC ordering, including nodeId tiebreaker, or report a visible conflict with evidence.

#### Scenario: Newer HLC wins same-field edit
- GIVEN both devices edit the same field before sync
- WHEN one edit has a higher HLC tuple
- THEN both devices MUST converge to that value
- AND evidence includes before/after values and HLC tuples.

#### Scenario: Equal HLC uses deterministic tiebreaker
- GIVEN physical time and counter are equal but nodeIds differ
- WHEN case 21d is repeated
- THEN every run MUST choose the same winner
- OR report `FAIL` with conflicting winners and nodeIds.

### Requirement: Cases 22a and 22c Edit-vs-delete Diagnosis

Cases 22a and 22c MUST report `PASS` when HLC evidence proves the correct live/tombstone winner; otherwise they MUST report `WARN` only when the observed state is plausible but evidence is incomplete.

#### Scenario: Proven edit-vs-delete winner passes
- GIVEN delete and edit HLCs are both captured
- WHEN the newer operation determines the final state on both devices
- THEN verdict MUST be `PASS` with the winner order cited.

#### Scenario: Plausible state without ordering evidence warns
- GIVEN both devices agree on live or tombstoned state
- WHEN update/delete HLC ordering cannot be proven
- THEN verdict MUST be `WARN`, not `PASS`.

### Requirement: Cases 24, 25, and 26 Expected-invalid Evidence

Cases 24, 25, and 26 MUST distinguish expected invalid/conflict behavior from harness/product failure using BookNote/config evidence.

#### Scenario: Case 24 proves annotation coexistence
- GIVEN two annotations share range but have distinct identities
- WHEN both survive with two BookNotes on both devices
- THEN verdict MUST be `PASS`; missing config caps at `WARN`.

#### Scenario: Cases 25 and 26 classify invalid highlight behavior
- GIVEN type mutation or cross-type pointer input is injected
- WHEN config evidence shows rejection, unresolved marking, correction, drift, or silent acceptance
- THEN the report MUST classify expected invalid/conflict versus product failure.

### Requirement: Phase 4 Real-device Reliability Rerun

The bounded Phase 4 real-device rerun MUST achieve at least 80% `PASS` over executable cases, or provide justified per-case classification.

#### Scenario: Reliability threshold passes
- GIVEN executable Phase 4 cases are rerun on real devices
- WHEN `PASS / executable >= 80%`
- THEN the report MUST state `PASS` with numerator, denominator, and cases.

#### Scenario: Below threshold remains actionable
- GIVEN success is below 80%
- WHEN the report is generated
- THEN it MUST be non-pass with per-case verdict, `failureDomain`, evidence gaps, and unavailable evidence.
