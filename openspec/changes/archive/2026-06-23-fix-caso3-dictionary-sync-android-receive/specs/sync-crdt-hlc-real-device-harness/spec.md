# Delta for sync-crdt-hlc-real-device-harness

## ADDED Requirements

### Requirement: Desktop Dictionary Replica Transport

Sync execution MUST collect `dictionary_entries` and `dictionary_occurrences` from the desktop local `Readest/dictionary.db` when rows exist. It MUST PUT dictionary-entry rows to Android `/replicas/dictionary-entry` and dictionary-occurrence rows to Android `/replicas/dictionary-occurrence`. Existing book/library sync behavior MUST remain compatible and continue to run for prepared books.

#### Scenario: Caso 3 sends desktop dictionary rows to Android

- GIVEN desktop has a prepared book plus local `dictionary_entries` and `dictionary_occurrences`
- WHEN the sync trigger executes against Android
- THEN Android receives at least one `dictionary-entry` replica row
- AND Android receives at least one `dictionary-occurrence` replica row
- AND the existing book/library sync result remains present

#### Scenario: No dictionary rows preserves book sync

- GIVEN desktop has prepared book data but no dictionary rows
- WHEN the sync trigger executes against Android
- THEN dictionary-entry and dictionary-occurrence replica sent counts are `0`
- AND book/library sync continues without being skipped or reclassified as dictionary sync

### Requirement: Distinct Book and Dictionary Evidence

Evidence and reports MUST distinguish the book/library sent count from dictionary replica transport counts. Dictionary-entry and dictionary-occurrence counts MUST be separately visible so a book `sent` value cannot be interpreted as dictionary replica delivery.

#### Scenario: Evidence separates book and replica counts

- GIVEN sync sends one book and dictionary replica rows
- WHEN trigger evidence or the final report is generated
- THEN book sent count is reported as book/library evidence
- AND dictionary-entry and dictionary-occurrence replica counts are reported separately

#### Scenario: Missing dictionary evidence fails Caso 3

- GIVEN Caso 3 expects dictionary convergence after sync
- WHEN evidence only proves book/library sync
- THEN the harness MUST NOT report `PASS`
- AND diagnosis identifies missing dictionary replica transport evidence

### Requirement: Caso 3 End-to-End Dictionary Receive Pass

The Caso 3 harness MUST pass only when the clean + prepare + fixture + sync flow leaves Android with at least one dictionary-entry replica and at least one dictionary-occurrence replica. The assertion MUST use Android-visible replica state, not only desktop source rows or book sync counts.

#### Scenario: Clean prepare fixture sync converges dictionary replicas

- GIVEN Android and desktop are cleaned, a real book is prepared, and fixture dictionary data is created on desktop
- WHEN the harness runs sync
- THEN Android replica state shows `dictionary-entry >= 1`
- AND Android replica state shows `dictionary-occurrence >= 1`
- AND the report can cite evidence for both counts

#### Scenario: Android lacks either dictionary kind after sync

- GIVEN Caso 3 ran clean + prepare + fixture + sync
- WHEN Android has zero dictionary-entry or zero dictionary-occurrence replicas
- THEN the harness reports `FAIL`
- AND diagnosis points to dictionary replica serialization, transport, or Android receive evidence
