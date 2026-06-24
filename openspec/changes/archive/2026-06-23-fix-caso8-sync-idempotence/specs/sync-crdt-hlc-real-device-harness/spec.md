# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

### Requirement: Caso 8 Push Idempotence

The Desktop-to-Android push phase MUST filter out replicas already recorded in Desktop `_replicas` with equal-or-higher `updated_at_ts` using the HLC gate. Repeated sync with no data changes MUST produce `attempted=0` for all four replica kinds: dictionary-entry, dictionary-occurrence, quote, and annotation. An empty `_replicas` on first sync (bootstrapping) MUST NOT block the push.

#### Scenario: First sync bootsTraps with empty _replicas

- GIVEN Desktop has fixture data and empty `_replicas`
- WHEN sync executes
- THEN `attempted > 0` for dictionary-entry, dictionary-occurrence, quote, and annotation

#### Scenario: Second sync with no changes produces zero operations

- GIVEN first sync completed and no desktop data changed
- WHEN sync executes again
- THEN dictionary-entry `attempted=0` AND `applied=0`
- AND dictionary-occurrence `attempted=0` AND `applied=0`
- AND quote `attempted=0` AND `applied=0`
- AND annotation `attempted=0` AND `applied=0`

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
