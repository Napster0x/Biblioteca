# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

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
