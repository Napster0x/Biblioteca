# replica-field-level-hlc-merge Specification

## Purpose

Field-level HLC comparison and merge semantics in the replica CRDT pull path (`apply_remote_replica`), ensuring same-semantic-key entities converge to a single record with per-field HLC resolution instead of creating duplicates. Includes deterministic tiebreak via full HLC tuple `(physical, counter, nodeId)` when timestamps are equal.

## Requirements

### Requirement: REQ-PC-1 — Field-Level HLC Merge in Replica Pull Path

When `apply_remote_replica` receives a remote replica whose `semantic_key` matches an existing local entity but has a different `replica_id`, the system MUST perform per-field HLC comparison instead of inserting a duplicate entity. Each editable field SHALL resolve to the value with the higher HLC individually. The system MUST merge into a single entity with a single `replica_id`.

| Field | Behavior |
|-------|----------|
| Editable fields | Higher-HLC value wins per field independently |
| Immutable fields | First-created value preserved; MUST be identical across replicas |
| Occurrences / children | Preserved from BOTH replicas (union, not replacement) |

#### Scenario: Higher-HLC definition wins, single entity

- GIVEN local entity `dict-entry-A` with `def="profound void"` (HLC=1000) and remote replica `dict-entry-B` with `def="very deep"` (HLC=1001), same `semantic_key`
- WHEN `apply_remote_replica` processes the remote replica
- THEN exactly ONE dictionary entry exists post-merge
- AND `definition` = `"very deep"` (HLC=1001 wins)
- AND all child occurrences from both replicas are preserved

#### Scenario: Same-semantic-key annotation merges instead of duplicates

- GIVEN local annotation `ann-A` with `note="revised"` (HLC=500) and remote `ann-B` with `note="alternative"` (HLC=501), same `book_hash | cfi | text`
- WHEN the pull path processes the remote replica
- THEN exactly ONE annotation row exists post-merge
- AND `note` = `"alternative"` (HLC=501 wins)
- AND `text`, `color`, `style` remain as first-created values

#### Scenario: No semantic key match — insert new (normal behavior preserved)

- GIVEN local entity `dict-entry-X` and remote `dict-entry-Y` with DIFFERENT `semantic_key` values
- WHEN `apply_remote_replica` runs
- THEN both entities exist as separate rows (no merge)
- AND existing non-conflicting replica behavior is unchanged

### Requirement: REQ-PC-2 — Same-HLC Tiebreaking via Deterministic nodeId

When per-field HLC comparison encounters equal `(physical_ts, counter)` values, the system MUST resolve using deterministic `nodeId` lexicographic comparison. The tiebreak MUST produce identical results across repeated runs with the same inputs.

#### Scenario: Equal timestamps, deterministic winner by nodeId

- GIVEN local `def="fate"` at HLC `(1783980179017, 0, node-desktop)` and remote `def="luck"` at HLC `(1783980179017, 0, node-android)`, same `semantic_key`
- WHEN merge executes across 5 isolated runs with identical inputs
- THEN all 5 runs select the SAME winning definition (higher `nodeId` lexicographically wins)
- AND exactly ONE entity survives

#### Scenario: Different timestamps — nodeId tiebreak NOT invoked

- GIVEN local HLC `(1783980161662, 0, node-desktop)` and remote HLC `(1783980161663, 0, node-android)`
- WHEN merge runs
- THEN remote value wins by higher physical timestamp (counter comparison skipped)
- AND nodeId is irrelevant to the outcome
