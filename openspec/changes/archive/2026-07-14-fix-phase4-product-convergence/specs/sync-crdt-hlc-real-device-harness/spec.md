# Delta for sync-crdt-hlc-real-device-harness

## MODIFIED Requirements

### Requirement: REQ-PC-3 — Cases 22a and 22c Delete Convergence Verdict

Cases 22a and 22c MUST report `PASS` when both devices agree the entity is in deleted (tombstoned) state, regardless of `replica_id` divergence. `replica_id` mismatches between independently-created entities SHALL NOT block a PASS verdict — they are expected under concurrent creation. The harness MUST verify delete-state convergence (tombstone presence, deleted timestamp) NOT replica-level identity match. HLC evidence proving delete > edit ordering SHALL independently produce PASS.
(Previously: Cases 22a and 22c required PASS only with proven HLC winner ordering; replica_id divergence was flagged as WARN/FAIL.)

#### Scenario: Delete wins on both devices, replica_ids differ — PASS

- GIVEN Desktop has deleted entity `D(replica_id=A, deleted_at=HLC=15)` and Android has deleted same-semantic-key entity `D(replica_id=B, deleted_at=HLC=15)`
- WHEN harness evaluates Case 22a or 22c
- THEN verdict MUST be `PASS`
- AND `replica_id` divergence is noted as expected, NOT as failure evidence

#### Scenario: Delete wins but delete proofs absent — WARN

- GIVEN both devices agree entity is tombstoned
- WHEN `deleted_at` timestamps or HLC ordering cannot be confirmed
- THEN verdict MUST be `WARN`, not `PASS`
- AND evidence gaps list missing `_replicas` or tombstone timestamps

#### Scenario: One device live, one tombstoned — FAIL

- GIVEN Desktop has live entity and Android has tombstoned same entity
- WHEN delete-wins assertion runs
- THEN verdict MUST be `FAIL` (divergent state)
- AND diagnosis cites HLC ordering conflict

### Requirement: REQ-PC-4 — Cases 24 Same-CFI Coexistence Verdict

Case 24 MUST report `PASS` when two distinct annotations (`different note` values, different `replica_id`s) coexist on both devices at the same CFI range. Multi-annotation coexistence is CORRECT CRDT behavior (concurrent creates, different semantic keys due to different `text` values), NOT an "expected-invalid" condition. The harness SHALL accept count >= 2 with distinct `note` values and matching `book_hash` + `cfi` as valid convergence. Verdict SHALL NOT be downgraded due to annotation count > 1 at the same range.
(Previously: Case 24 was grouped under "Expected-invalid Evidence" with Cases 25/26; coexistence was not explicitly classified as valid CRDT PASS behavior.)

#### Scenario: Two annotations coexist at same CFI, both devices — PASS

- GIVEN Desktop has 2 annotations `(note="Idea A", note="Idea B")` at same `book_hash+cfi`, and Android also has both annotations with matching `replica_id`s
- WHEN harness evaluates Case 24
- THEN verdict MUST be `PASS`
- AND evidence confirms both annotations present on both devices

#### Scenario: Annotations count < 2 on either device — FAIL

- GIVEN Desktop has 2 annotations at CFI range X but Android has only 1
- WHEN Case 24 assertion runs
- THEN verdict MUST be `FAIL` (incomplete convergence)
- AND diagnosis names the missing annotation

#### Scenario: Coexistence verified but config.json missing — WARN

- GIVEN annotation rows present on both devices
- WHEN `config.json` booknotes evidence is unavailable
- THEN verdict capped at `WARN`
- AND evidence gap lists missing config.json for highlight claims

### Requirement: Cases 24, 25, and 26 Expected-invalid Evidence

Cases 25 and 26 MUST continue to distinguish expected invalid/conflict behavior from harness/product failure using BookNote/config evidence. Case 24 is EXCLUDED from "expected-invalid" classification — multi-annotation coexistence at same CFI is valid CRDT convergence (see REQ-PC-4).
(Previously: Cases 24, 25, and 26 were grouped together under a single expected-invalid evidence requirement. Case 24 is now separately classified as valid CRDT behavior.)

#### Scenario: Case 24 proves annotation coexistence (separated from invalid classification)

- GIVEN two annotations share range but have distinct identities
- WHEN both survive with two BookNotes on both devices
- THEN verdict MUST be `PASS` per REQ-PC-4
- AND the case SHALL NOT appear under "expected-invalid" classification

#### Scenario: Cases 25 and 26 classify invalid highlight behavior

- GIVEN type mutation or cross-type pointer input is injected
- WHEN config evidence shows rejection, unresolved marking, correction, drift, or silent acceptance
- THEN the report MUST classify expected invalid/conflict versus product failure per existing criteria
- AND Cases 25/26 remain discover-phase with WARN-as-pass acceptance
