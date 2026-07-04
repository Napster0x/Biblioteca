# Semantic Dedup Sync Specification

## Purpose

Integration of semantic deduplication into the sync push/pull pipeline, ensuring that semantically identical data (same dictionary term, same quote by book+CFI+text, same occurrence by entry+book+CFI) converges to a single logical entry across devices. Dedup logic exists in `sync-filter-standalone.mjs` for `dictionary-entry` only; this spec extends it to all 4 replica kinds and wires it in `sync-execute.mjs`.

## Requirements

### Requirement: Semantic Key Computation

`computeSemanticKey` MUST compute deterministic keys for all 4 replica kinds.

| Kind | Key Formula | Required Fields |
|------|-------------|-----------------|
| `dictionary-entry` | `normalizeTerm(term)\|normalizeTerm(language)` | `term`, `language` |
| `dictionary-occurrence` | `entry_id\|book_hash\|cfi` | `entryId`, `bookHash`, `cfi` |
| `quote` | `book_hash\|cfi\|content_hash` | `bookHash`, `cfi`, `contentHash` |
| `annotation` | `book_hash\|cfi\|text` | `bookHash`, `cfi`, `text` |

Returns `null` for rows missing required fields or `fields_jsonb`.

#### Scenario: Key returned for valid fields
- GIVEN a row with `fields_jsonb` containing required fields for any kind
- WHEN `computeSemanticKey(row, kind)` is called
- THEN it returns the pipe-delimited key matching the table above

#### Scenario: Null for missing fields
- GIVEN a row missing required fields for its kind
- WHEN `computeSemanticKey(row, kind)` is called
- THEN it returns `null`

### Requirement: Semantic Dedup in Filter

`filterUnchangedReplicas` MUST apply semantic identity dedup for all 4 replica kinds.

#### Scenario: Quote dedup by semantic identity
- GIVEN two replicas for the same quote (same bookHash+CFI+contentHash, different replica_ids)
- WHEN `filterUnchangedReplicas(dbPath, replicas, 'quote')` is called
- THEN only the replica with higher `updated_at_ts` survives

#### Scenario: Occurrence dedup by semantic identity
- GIVEN two replicas for the same occurrence (same entry_id+book_hash+cfi, different replica_ids)
- WHEN `filterUnchangedReplicas(dbPath, replicas, 'dictionary-occurrence')` is called
- THEN only the higher-HLC replica survives

### Requirement: Kind Pass-Through in Sync Pipeline

Sync push and pull loops MUST pass `kind` to all `filterUnchangedReplicas` calls.

#### Scenario: Push passes kind for occurrence, quote, annotation
- GIVEN push code at lines 676, 687, 698 of `sync-execute.mjs`
- WHEN `filterUnchangedReplicas` is called
- THEN kind is passed as third argument (e.g. `filterUnchangedReplicas(dbPath, rows, 'quote')`)

#### Scenario: Pull passes kind for all 4 kinds
- GIVEN the pull loop at line 708 iterates `REPLICA_PULL_ORDER`
- WHEN `filterUnchangedReplicas` is called
- THEN `kind` from the loop variable is the third argument

### Requirement: Semantic Key Persistence

`writeReplicaMetadata` MUST compute and persist `semantic_key` for all 4 replica kinds.

#### Scenario: Quote semantic key stored in _replicas
- GIVEN a quote replica row being written to `_replicas`
- WHEN `writeReplicaMetadata` runs
- THEN the `semantic_key` column holds `bookHash|cfi|contentHash`

### Requirement: Quotes Schema Migration

The `quotes` table DDL MUST include `replica_timestamps TEXT`. Existing DBs MUST be migrated.

#### Scenario: New quotes table has replica_timestamps
- GIVEN `ensureReplicaTables` is called with `kind = 'quote'` on a fresh DB
- WHEN the DDL executes
- THEN the quotes table includes `replica_timestamps TEXT`

#### Scenario: Existing DB migration
- GIVEN a `citas.db` whose quotes table lacks `replica_timestamps`
- WHEN `ensureReplicaTables` runs
- THEN ALTER TABLE ADD COLUMN adds the column

### Requirement: Failing Tests Before Implementation

Every dedup gap MUST have a failing test before production code changes (strict TDD).

#### Scenario: Pull-side kind test fails before wiring
- GIVEN replicas with same semantic identity, different replica_ids, for each non-dict-entry kind
- WHEN `filterUnchangedReplicas` is called without kind (current behavior)
- THEN the test fails — duplicate identities survive

#### Scenario: Push-side kind test fails before wiring
- GIVEN push code calls `filterUnchangedReplicas(dbPath, rows)` for occurrence/quote/annotation
- WHEN `kind` is `undefined` (current behavior)
- THEN the test fails — no semantic dedup applied

#### Scenario: Quotes schema test fails before migration
- GIVEN `ensureReplicaTables` creates the quotes table
- WHEN the schema is inspected
- THEN `replica_timestamps` is absent — test fails
