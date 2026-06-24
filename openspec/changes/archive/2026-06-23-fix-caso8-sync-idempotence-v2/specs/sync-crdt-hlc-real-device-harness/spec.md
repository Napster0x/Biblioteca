# Delta for Sync CRDT+HLC Real Device Harness

## MODIFIED Requirements

### Requirement: Caso 8 Push Idempotence

The Desktop-to-Android push phase MUST filter out replicas already recorded in Desktop `_replicas` with equal-or-higher `updated_at_ts` using the HLC gate. Repeated sync with no data changes MUST produce `attempted=0` for all four replica kinds: dictionary-entry, dictionary-occurrence, quote, and annotation — whether executed via direct CLI invocation or via the cycle harness HTTP trigger chain (dataRoot MUST propagate from cycle through sync-trigger route to spawned sync-execute). An empty `_replicas` on first sync (bootstrapping) MUST NOT block the push.
(Previously: Push idempotence required `attempted=0` on second sync but did not specify cycle-triggered path; cycle had dataRoot propagation gap.)

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
- THEN row excluded from PUT batch

#### Scenario: New or changed replicas pass the HLC gate

- GIVEN `_replicas` holds entry with `updated_at_ts = 100`
- WHEN push reads same row with `updated_at_ts > 100`
- THEN row included in PUT batch

#### Scenario: Caso 7 bidirectional sync preserved

- GIVEN Caso 7 pull populated Desktop `_replicas`
- WHEN Caso 8 push executes afterward
- THEN Android-sourced replicas NOT re-pushed
- AND Caso 7 evidence fields unchanged

#### Scenario: Per-kind zero-attempted evidence on empty push

- GIVEN second sync produced `attempted=0` for all kinds
- WHEN report generated
- THEN each kind explicitly reports `attempted=0`

#### Scenario: Direct CLI execution preserves v1 behavior

- GIVEN sync-execute.mjs invoked via direct CLI with explicit dataRoot env var
- WHEN pull filter is present in pull loop
- THEN push idempotence behavior identical to v1

## ADDED Requirements

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
