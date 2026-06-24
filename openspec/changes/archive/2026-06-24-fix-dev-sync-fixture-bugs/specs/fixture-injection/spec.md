# Fixture Injection Reliability Specification

## Purpose

Define reliability requirements for dev sync fixture data injection. The fixture MUST propagate injection failures, auto-create required tables, and align inserted columns with the Tauri `visible_repo.rs` schema.

## Requirements

### Requirement: Error Propagation on Injection Failure

The fixture functions `injectDictionary`, `injectQuote`, and `injectAnnotation` MUST check the return value of every `injectRows` call and propagate failures.

#### Scenario: injectDictionary returns failure when injectRows fails

- GIVEN `injectRows` returns `{ok: false, error: "sqlite3: no such table"}`
- WHEN `injectDictionary` calls `injectRows` for the entry or occurrence
- THEN `injectDictionary` MUST return `{ok: false, error: "sqlite3: no such table"}`

#### Scenario: injectQuote returns failure when injectRows fails

- GIVEN `injectRows` returns `{ok: false, error: "sqlite3: constraint failed"}`
- WHEN `injectQuote` calls `injectRows`
- THEN `injectQuote` MUST return `{ok: false, error: "sqlite3: constraint failed"}`

#### Scenario: injectAnnotation returns failure when injectRows fails

- GIVEN `injectRows` returns `{ok: false, error: "sqlite3: no such column"}`
- WHEN `injectAnnotation` calls `injectRows`
- THEN `injectAnnotation` MUST return `{ok: false, error: "sqlite3: no such column"}`

### Requirement: Schema Auto-Initialization

Before inserting rows into a table, `injectRows` (or a called helper like `ensureTable`) MUST run `CREATE TABLE IF NOT EXISTS` with DDL matching the Tauri `visible_repo.rs` schema exactly. Affected tables MUST be: `dictionary_entries`, `dictionary_occurrences`, `quotes`, `annotations`.

#### Scenario: injectDictionary creates tables on empty DB

- GIVEN a SQLite DB with no `dictionary_entries` or `dictionary_occurrences` tables
- WHEN `injectDictionary` injects data
- THEN both tables are created with columns matching `visible_repo.rs` DDL
- AND the insert succeeds

#### Scenario: injectQuote creates table on empty DB

- GIVEN a SQLite DB with no `quotes` table
- WHEN `injectQuote` injects data
- THEN the `quotes` table is created with columns matching `visible_repo.rs` DDL (no `comment` column)
- AND the insert succeeds

#### Scenario: injectAnnotation creates table on empty DB

- GIVEN a SQLite DB with no `annotations` table
- WHEN `injectAnnotation` injects data
- THEN the `annotations` table is created with columns matching `visible_repo.rs` DDL (no `selected_text` column)
- AND the insert succeeds

#### Scenario: Table creation is idempotent

- GIVEN a DB where the target table already exists
- WHEN `injectRows` runs `CREATE TABLE IF NOT EXISTS`
- THEN existing table structure is preserved
- AND insert proceeds without error

### Requirement: Column Alignment with Tauri Schema

The fixture functions MUST NOT insert columns absent from the Tauri `visible_repo.rs` DDL.

#### Scenario: injectQuote omits comment column

- GIVEN a `quotes` table created with Tauri schema (no `comment` column)
- WHEN `injectQuote` builds the INSERT statement
- THEN `comment` MUST NOT appear in the column list or values
- AND the insert succeeds on the Tauri-schema table

#### Scenario: injectAnnotation omits selected_text column

- GIVEN an `annotations` table created with Tauri schema (no `selected_text` column)
- WHEN `injectAnnotation` builds the INSERT statement
- THEN `selected_text` MUST NOT appear in the column list or values
- AND the insert succeeds on the Tauri-schema table

### Requirement: CLI Output Uses Actual Result

The CLI entry point in `dev-sync-fixture.mjs` MUST output `result.ok` instead of the hardcoded value `true`.

#### Scenario: CLI reports failure when injection fails

- GIVEN a fixture CLI call that fails injection
- WHEN the CLI prints the JSON result
- THEN `ok` MUST be `false` and `error` MUST contain the failure reason

#### Scenario: CLI reports success when injection succeeds

- GIVEN a fixture CLI call that succeeds
- WHEN the CLI prints the JSON result
- THEN `ok` MUST be `true`

### Requirement: Existing Tests Continue to Pass

Changes MUST NOT break the existing test suite. Tests that assert on removed columns (`comment` in quotes, `selected_text` in annotations) MUST be updated to reflect the corrected column alignment.

#### Scenario: All fixture tests pass after changes

- GIVEN the implementation of requirements 1-4
- WHEN `pnpm test` runs
- THEN all existing tests in `devSyncHarness.test.ts` pass
- AND tests that previously asserted on `comment`/`selected_text` are updated to match the Tauri schema
