# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

### Requirement: Android Book Metadata Edit Case 9Ma

The harness MUST support Phase 2 case `9Ma` through an Android-originated book metadata edit using the safe HTTP/fixture path. It MUST prove the edited metadata has a newer timestamp/HLC than the previous book fact, converges to desktop, and is not masked by stale local state.

#### Scenario: 9Ma Android metadata edit converges
- GIVEN a synced EPUB-backed book exists on desktop and Android
- WHEN Android edits book metadata for `9Ma` through the harness action
- THEN desktop and Android show the edited metadata with newer timestamp/HLC ordering
- AND the report cites before/after book evidence for both devices

#### Scenario: 9Ma blocked diagnostics
- GIVEN Android book index update, fixture data, or timestamp evidence is unavailable
- WHEN `9Ma` runs
- THEN the harness reports `BLOCKED`, `FAIL`, or `AMBIGUOUS` with the failed capability and evidence path
- AND it MUST NOT report `PASS`

### Requirement: Android Import and Same-hash Reimport Case 13Ma

The harness MUST support Phase 2 case `13Ma` for Android EPUB/book import and reimport. Same-hash reimport after a tombstone MUST be safe: a newer live reimport SHALL resurrect the book, while older tombstones SHALL NOT win.

#### Scenario: 13Ma same-hash reimport after tombstone passes
- GIVEN Android has a tombstoned book entry for a known EPUB hash
- WHEN Android reimports the same EPUB hash with a newer live timestamp
- THEN desktop and Android converge on the live book entry
- AND evidence shows the tombstone lost by timestamp/HLC ordering

#### Scenario: 13Ma no false PASS on unsafe import evidence
- GIVEN asset copy, book index, hash, or tombstone ordering evidence is missing
- WHEN `13Ma` is evaluated
- THEN the harness reports non-success with the missing evidence class
- AND it MUST NOT infer resurrection from counts alone

### Requirement: Semantic Highlight Delete Cases 14

The harness MUST support semantic BookNote/highlight delete tooling for `14a`, `14b`, `14c`, `14Ma`, `14Mb`, and `14Mc`. Deleting a highlight association MUST delete only its associated dictionary, quote, or annotation semantic data, using safe target resolution that prevents unrelated row deletion.

#### Scenario: Associated semantic data is deleted
- GIVEN a dictionary, quote, or annotation highlight association has a resolved semantic target
- WHEN the user deletes that highlight association through a `14*` or `14M*` action
- THEN the associated semantic data is deleted or tombstoned on the source device
- AND convergence proves the deletion on the peer device

#### Scenario: Ambiguous target prevents deletion
- GIVEN target resolution matches zero or multiple semantic rows
- WHEN a `14*` delete action is requested
- THEN the harness reports `BLOCKED` or `FAIL` with target-resolution diagnostics
- AND it MUST NOT delete unrelated dictionary, quote, or annotation rows

#### Scenario: No false PASS for association-only removal
- GIVEN the highlight association is gone but associated semantic data remains live
- WHEN the case report is generated
- THEN the verdict is `FAIL`
- AND diagnosis names the surviving semantic data kind and target id

### Requirement: Bounded Real-device Reliability Classification

The capability suite MUST demonstrate greater than `80%` real-device reliability over bounded repeated runs. Each attempt MUST be time-bounded and classified as harness, environment, product, or unknown failure; non-success attempts SHALL reduce the measured reliability.

#### Scenario: Reliability threshold passes with evidence
- GIVEN a bounded repeated run set for the Phase 2 capability suite
- WHEN definitive successful attempts exceed `80%`
- THEN the report states `PASS` with numerator, denominator, case list, and evidence paths

#### Scenario: Reliability below threshold diagnoses failures
- GIVEN repeated runs complete but success rate is `<=80%`
- WHEN the reliability report is produced
- THEN the report is `FAIL` with per-attempt failure classification
- AND it MUST NOT hide blocked, ambiguous, timeout, or environment failures from the denominator
