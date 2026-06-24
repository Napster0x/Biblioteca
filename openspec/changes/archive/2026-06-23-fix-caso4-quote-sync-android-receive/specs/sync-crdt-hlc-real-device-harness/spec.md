# Delta for sync-crdt-hlc-real-device-harness

## ADDED Requirements

### Requirement: Desktop Quote Replica Transport

Sync execution MUST collect `quotes` rows from desktop `Readest/citas.db` (table: `quotes`) when rows exist. It MUST PUT quote rows to Android `/replicas/quote`. Existing book and dictionary sync behavior MUST remain compatible and continue to run.

#### Scenario: Caso 4 sends desktop quote rows to Android

- GIVEN desktop has a prepared book plus local `quotes` rows in `citas.db`
- WHEN the sync trigger executes against Android
- THEN Android receives at least one `quote` replica row
- AND existing book and dictionary sync results remain present

#### Scenario: No quote rows preserves book and dictionary sync

- GIVEN desktop has prepared book and dictionary data but no quote rows
- WHEN the sync trigger executes against Android
- THEN quote replica sent count is `0`
- AND book/library and dictionary sync continue without being skipped

### Requirement: Caso 4 End-to-End Quote Receive Pass

The Caso 4 harness MUST pass only when the clean + prepare + fixture + sync flow leaves Android with at least one `quote` replica. The assertion MUST use Android-visible replica state, not only desktop source rows.

#### Scenario: Clean prepare fixture sync converges quote replicas

- GIVEN Android and desktop are cleaned, a real book is prepared, and fixture quote data is created on desktop
- WHEN the harness runs sync
- THEN Android replica state shows `quote >= 1`
- AND the report can cite evidence for the count

#### Scenario: Android lacks quote replicas after sync

- GIVEN Caso 4 ran clean + prepare + fixture + sync
- WHEN Android has zero quote replicas
- THEN the harness reports `FAIL`
- AND diagnosis points to quote replica serialization, transport, or Android receive evidence

## MODIFIED Requirements

### Requirement: Distinct Book, Dictionary, and Quote Evidence

Evidence and reports MUST distinguish the book/library sent count from dictionary and quote replica transport counts. Dictionary-entry, dictionary-occurrence, and quote counts MUST be separately visible so a book `sent` value cannot be interpreted as dictionary or quote replica delivery.
(Previously: Evidence separated book from dictionary counts only, without quote replica counts.)

#### Scenario: Evidence separates book, dictionary, and quote counts

- GIVEN sync sends one book, dictionary replica rows, and quote replica rows
- WHEN trigger evidence or the final report is generated
- THEN book sent count is reported as book/library evidence
- AND dictionary-entry, dictionary-occurrence, and quote replica counts are reported separately

#### Scenario: Missing quote evidence fails Caso 4

- GIVEN Caso 4 expects quote convergence after sync
- WHEN evidence only proves book/library or dictionary sync
- THEN the harness MUST NOT report `PASS`
- AND diagnosis identifies missing quote replica transport evidence
