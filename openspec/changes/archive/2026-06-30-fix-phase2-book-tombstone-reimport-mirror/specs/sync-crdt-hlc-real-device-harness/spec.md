# Delta for Sync CRDT+HLC Real Device Harness

## ADDED Requirements

### Requirement: Book tombstone reimport ordering

The harness MUST treat book tombstones and same-hash reimports as timestamp-ordered book-library facts. A newer legitimate reimport MUST resurrect the book; an older tombstone MUST NOT hide or re-delete that reimport.

#### Scenario: 13a O→M newer same-hash desktop reimport resurrects book

- GIVEN desktop has a tombstoned book entry and the same EPUB hash is reimported with `updatedAt` newer than `deletedAt`
- WHEN desktop prepares and syncs to Android
- THEN the desktop book entry is live with `deletedAt` cleared
- AND Android receives the resurrected or updated live book entry

#### Scenario: Older tombstone loses to newer reimport

- GIVEN a live desktop reimport has an `updatedAt` newer than a known book tombstone
- WHEN tombstone reconciliation runs during sync
- THEN the book remains live on desktop and Android
- AND the older tombstone MUST NOT be propagated as the winning state

### Requirement: Remote book tombstones are merged before local book push

Before pushing desktop book-library state, sync MUST evaluate Android `/books/index` book tombstones. A newer Android-originated book tombstone MUST be applied to desktop first so stale local book state cannot accidentally resurrect the book.

#### Scenario: Remote tombstone blocks accidental resurrection

- GIVEN Android `/books/index` contains a tombstone newer than desktop's local live book entry
- WHEN desktop-to-Android sync starts
- THEN desktop records the book as tombstoned before any book push decision
- AND sync MUST NOT push the stale live book as a resurrection

#### Scenario: Newer local reimport may still beat older remote tombstone

- GIVEN desktop has a live reimport with `updatedAt` newer than Android's book tombstone
- WHEN sync reconciles remote tombstones before push
- THEN the desktop reimport remains the winning book state
- AND Android receives the live reimported book entry

### Requirement: Android book delete propagates without D/C/N loss

For Phase 2 cases `10Ma`, `10Mb`, and `10Mc`, an Android-originated book delete MUST converge to a desktop book tombstone. Dictionary, citation/quote, and note/annotation data (D/C/N) MUST survive as independent semantic data.

#### Scenario: 10Ma M→O Android book delete creates desktop tombstone

- GIVEN Android deletes a synced book and exposes a newer book tombstone
- WHEN desktop syncs from Android
- THEN desktop `library.json` records the book tombstone
- AND the book is not restored by stale desktop state

#### Scenario: 10Mb M→O preserves dictionary and citation data

- GIVEN dictionary and citation/quote rows exist for the deleted book
- WHEN the Android book tombstone propagates to desktop
- THEN dictionary rows remain present and assertable
- AND citation/quote rows remain present and assertable

#### Scenario: 10Mc M→O preserves note and annotation data

- GIVEN note/annotation rows exist for the deleted book
- WHEN the Android book tombstone propagates to desktop
- THEN note/annotation rows remain present and assertable
- AND reports MUST NOT classify D/C/N survival as book resurrection
