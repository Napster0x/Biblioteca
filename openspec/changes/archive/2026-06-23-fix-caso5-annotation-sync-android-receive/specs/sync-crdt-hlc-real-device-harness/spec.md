# Delta for sync-crdt-hlc-real-device-harness

## ADDED Requirements

### Requirement: Desktop Annotation Replica Transport

Sync execution MUST collect `annotations` rows from desktop `Readest/annotations.db` (table: `annotations`) when rows exist. It MUST PUT annotation rows to Android `/replicas/annotation`. Existing book, dictionary, and quote sync behavior MUST remain compatible and continue to run.

#### Scenario: Caso 5 sends desktop annotation rows to Android

- GIVEN desktop has a prepared book plus local `annotations` rows in `annotations.db`
- WHEN the sync trigger executes against Android
- THEN Android receives at least one `annotation` replica row
- AND existing book, dictionary, and quote sync results remain present

#### Scenario: No annotation rows preserves book, dictionary, and quote sync

- GIVEN desktop has prepared book, dictionary, and quote data but no annotation rows
- WHEN the sync trigger executes against Android
- THEN annotation replica sent count is `0`
- AND book/library, dictionary, and quote sync continue without being skipped

### Requirement: Caso 5 End-to-End Annotation Receive Pass

The Caso 5 harness MUST pass only when the clean + prepare + fixture + sync flow leaves Android with at least one `annotation` replica. The assertion MUST use Android-visible replica state, not only desktop source rows.

#### Scenario: Clean prepare fixture sync converges annotation replicas

- GIVEN Android and desktop are cleaned, a real book is prepared, and fixture annotation data is created on desktop
- WHEN the harness runs sync
- THEN Android replica state shows `annotation >= 1`
- AND the report can cite evidence for the count

#### Scenario: Android lacks annotation replicas after sync

- GIVEN Caso 5 ran clean + prepare + fixture + sync
- WHEN Android has zero annotation replicas
- THEN the harness reports `FAIL`
- AND diagnosis points to annotation replica serialization, transport, or Android receive evidence

## MODIFIED Requirements

### Requirement: Distinct Book, Dictionary, Quote, and Annotation Evidence

Evidence and reports MUST distinguish the book/library sent count from dictionary, quote, and annotation replica transport counts. Dictionary-entry, dictionary-occurrence, quote, and annotation counts MUST be separately visible so a book `sent` value cannot be interpreted as dictionary, quote, or annotation replica delivery.
(Previously: Evidence separated book, dictionary, and quote counts, without annotation replica counts.)

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

#### Scenario: Evidence separates book, dictionary, quote, and annotation counts

- GIVEN sync sends one book, dictionary, quote, and annotation replica rows
- WHEN trigger evidence or the final report is generated
- THEN book sent count is reported as book/library evidence
- AND dictionary-entry, dictionary-occurrence, quote, and annotation replica counts are reported separately

#### Scenario: Missing annotation evidence fails Caso 5

- GIVEN Caso 5 expects annotation convergence after sync
- WHEN evidence only proves book/library, dictionary, or quote sync
- THEN the harness MUST NOT report `PASS`
- AND diagnosis identifies missing annotation replica transport evidence
