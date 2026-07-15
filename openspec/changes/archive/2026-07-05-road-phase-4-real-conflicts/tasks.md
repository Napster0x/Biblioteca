# Tasks — Phase 4: Conflictos Reales (CRDT+HLC Sync Test Suite)

> **Change**: `road-phase-4-real-conflicts`
> **Cases**: 21–26 (14 sub-cases total)
> **Spec**: `openspec/changes/road-phase-4-real-conflicts/specs/real-conflicts/spec.md`
> **Design**: `openspec/changes/road-phase-4-real-conflicts/design.md`

---

## 1. Review Workload Forecast

**Estimated lines changed (production harness code only, excludes tests):**

| Area | Est. Lines | Files |
|------|-----------|-------|
| State capture — row-level data (`sync-dev-sqlite.mjs`, `sync-dev-state.mjs`) | ~25 | `sync-dev-sqlite.mjs`, `sync-dev-state.mjs` |
| Assert engine helpers (`assert-engine.mjs`) | ~95 | `assert-engine.mjs` |
| Fixture — new ops (`dev-sync-fixture.mjs`) | ~90 | `dev-sync-fixture.mjs` |
| Case 23 setup + verdict (5 sub-cases) | ~90 | `dev-sync-cycle.mjs` |
| Case 21 setup + verdict (4 sub-cases) | ~100 | `dev-sync-cycle.mjs` |
| Case 22 setup + verdict (2 active, 1 blocked) | ~80 | `dev-sync-cycle.mjs` |
| Case 24 setup + verdict (1 sub-case) | ~45 | `dev-sync-cycle.mjs` |
| Case 25 setup + verdict (DISCOVER, 1 sub-case) | ~45 | `dev-sync-cycle.mjs` |
| Case 26 setup + verdict (DISCOVER, 1 sub-case) | ~50 | `dev-sync-cycle.mjs` |
| Routing updates (`executePhase2CaseRef`, `computeCaseAcceptanceVerdict`) | ~30 | `dev-sync-cycle.mjs` |
| **Total production code** | **~650** | |
| Unit tests (mocked state for all new verdicts) | ~300 | `dev-sync-cycle.test.mjs` |
| **Total all code** | **~950** | |

**Reality check on the <400 line estimate from the proposal:**

The proposal's estimate was optimistic. Even just Cases 21–24 (harness-only) come to ~440 lines of production code plus ~200 lines of tests. Adding Case 25–26 fixture ops and DISCOVER verdicts brings it to ~650 production lines. This is still manageable as a **single PR** when 25–26 are kept DISCOVER-only (no product fix).

**Delivery recommendation:**

| Strategy | Contents | Est. Lines | When |
|----------|----------|-----------|------|
| **A — Single PR** (recommended) | Infrastructure + cases 21–26 all harness-only. 25–26 in DISCOVER mode. Product fixes deferred. | ~650 prod + ~300 tests | Now |
| **B — Split PR 1 + PR 2** | PR 1: Infrastructure + cases 23 + 24 + 21 (~440 prod). PR 2: Case 22 + cases 25–26 DISCOVER (~210 prod). | 2 PRs, ~650 total | If review capacity is tight |
| **PR 3 (conditional)** | Product code fixes if DISCOVER reveals type/pointer integrity bugs in merge layer. | TBD by discovery | After PR 1/2 |

**Recommendation**: **Strategy A** — single PR. Cases 25–26 are DISCOVER-only (observational verdicts, no assertions about correct behavior). If product fixes are needed, they go in a chained PR afterward. The 650 lines of production code is within reason for a harness-only change following well-established patterns.

---

## 2. Phase 0: Infrastructure

These tasks are prerequisites for all Phase 4 cases. They must be completed first.

### 2.1 State Capture — Row-Level Data

Tasks to extend the state capture so verdict functions can check field VALUES, not just row counts.

- **[x] 0.1** Extend `captureTable()` in `sync-dev-sqlite.mjs` to return full row data alongside metadata.
  - **Spec ref**: §4.1 (field-level HLC evidence), Design §"State Capture Field Values"
  - **What**: Augment the return shape of `captureTable` to include a `rows` array (all columns, all rows). This is backward-compatible — existing callers only read `rowCount`/`hlcMin`/`hlcMax` and continue to work.
  - **Where**: `sync-dev-sqlite.mjs` — `captureTable()` function
  - **Test**: Verify that `rows` is a non-empty array when a table has data, and that `rowCount === rows.length`.
  - **Why**: Case 21 (same-field edit) needs to check `rows[0].definition === "expected value"`. Case 22 (edit vs delete) needs `rows[0].deleted_at` for tombstone state.

- **[x] 0.2** Extend `queryReplicaKind()` in `sync-dev-state.mjs` to return replica row samples.
  - **Spec ref**: §4.1 (replica evidence), Design §"State Capture Field Values"
  - **What**: After fetching replica rows, store the first N rows (or all rows if small) in the return value under a `rows` key. The current return shape has `{ kind, reachable, rowCount, hlcMin, hlcMax, tombstoneCount }` — add `rows`.
  - **Where**: `sync-dev-state.mjs` — `queryReplicaKind()` function
  - **Test**: Mock a replica API response with 3 rows and verify `rows` appears in the return.
  - **Why**: Android-side verdicts (e.g., `post.android.replicas['dictionary-entry'].rows[0].definition`) require row data from replica queries.

### 2.2 Assert Engine Helpers

New assertion functions in `assert-engine.mjs` that Phase 4 verdict functions will call.

- **[x] 0.3** Implement `assertFieldValue(entityType, entityId, field, expectedValue, state)`.
  - **Spec ref**: R-P4.21.a–d, R-P4.22.a/c, Design §"New Assertion Helpers"
  - **What**: Assert a specific field on a specific entity has a specific value. Accepts entity type (`'dictionary-entry' | 'annotation' | 'book'`), entity ID (normalized term for dict, hash for book, id for annotation), field name, expected value, and a device state snapshot. Returns `{ verdict, failures }` with PASS/FAIL.
  - **Where**: `assert-engine.mjs` — new exported function
  - **Test**: Unit test with mock state — PASS when value matches, FAIL when mismatch or entity missing.
  - **Why**: Case 21 verdicts need "definition === 'very deep chasm'", "note === 'alternative interpretation'", "title === 'Android Title'".

- **[x] 0.4** Implement `assertEntityState(entityType, entityId, state)`.
  - **Spec ref**: R-P4.22.a/c, Design §"New Assertion Helpers"
  - **What**: Determine if an entity is LIVE or TOMBSTONED by checking `deleted_at` / `deletedAt`. Returns `{ state: 'live' | 'tombstone' | 'not-found', evidence: { deletedAt?, updatedAt? } }`.
  - **Where**: `assert-engine.mjs` — new exported function
  - **Test**: PASS for a row with `deleted_at=null` returns `live`. A row with `deleted_at=12345` returns `tombstone`. Missing row returns `not-found`.
  - **Why**: Case 22 verdicts need "entity is TOMBSTONED on both sides when delete HLC > edit HLC".

- **[x] 0.5** Implement `assertBookNoteIntegrity(bookHash, noteId, expectedType, expectedEntityId, config)`.
  - **Spec ref**: R-P4.25, R-P4.26, Design §"New Assertion Helpers"
  - **What**: Validate that a config.json BookNote entry has the correct type-entity reference pair. Checks that `note.type === expectedType` AND that the pointer field matches the type (e.g., `type='dictionary'` → `note.dictionaryEntryId === expectedEntityId`). Cross-type pointers are INVALID.
  - **Where**: `assert-engine.mjs` — new exported function
  - **Test**: Mock `config.booknotes[]` — PASS when type+pointer match, FAIL on type drift or cross-type pointer.
  - **Why**: Case 25 needs to detect type drift. Case 26 needs to detect cross-type pointers.

- **[x] 0.6** Implement `assertBookNoteType(bookHash, noteId, expectedType, config)`.
  - **Spec ref**: R-P4.25, Design §"New Assertion Helpers"
  - **What**: Simpler integrity check — only asserts the `type` field of a BookNote. Does NOT check pointer consistency. Returns `{ verdict, failures }`.
  - **Where**: `assert-engine.mjs` — new exported function
  - **Test**: PASS when `note.type === expectedType`, FAIL on type drift.
  - **Why**: Case 25 verdict needs fast "did type drift?" check without pointer validation noise.

### 2.3 Fixture Operations — Cases 25–26

New CLI operations that mutate config.json BookNote entries. Needed only for Cases 25–26 (DISCOVER).

- **[x] 0.7** Add `--booknote-mutate <bookHash>:<noteId>:<newType>` fixture operation.
  - **Spec ref**: R-P4.25, Design §"BookNote Mutation Fixture Support"
  - **What**: In `dispatchFixture()`, parse `--booknote-mutate`, read the device's config.json, find the BookNote by `noteId`, overwrite its `type` field to `newType`, and write config.json back. Supports both desktop (filesystem) and Android (via HTTP PUT).
  - **Where**: `dev-sync-fixture.mjs` — new clause in `dispatchFixture()`, new `parseFixtureArgs()` case, new inject function `injectBookNoteMutation()`
  - **Test**: Unit test with mock config.json — verify the type field is overwritten and other fields preserved.
  - **Why**: Case 25 setup needs to mutate an annotation-type highlight into a cite-type highlight to test type integrity.

- **[x] 0.8** Add `--booknote-invalid-ref <bookHash>:<noteId>:<targetKind>:<wrongEntityId>` fixture operation.
  - **Spec ref**: R-P4.26, Design §"BookNote Mutation Fixture Support"
  - **What**: In `dispatchFixture()`, parse `--booknote-invalid-ref`, read config.json, find the BookNote by `noteId`, replace its valid pointer field with a cross-type pointer. E.g., if `note.type = 'dictionary'`, remove `dictionaryEntryId` and set `citeId = wrongEntityId`. Write config.json back.
  - **Where**: `dev-sync-fixture.mjs` — new clause in `dispatchFixture()`, new `parseFixtureArgs()` case, new inject function `injectInvalidBookNoteRef()`
  - **Test**: Unit test with mock config.json — verify the pointer field is replaced and the old pointer removed.
  - **Why**: Case 26 setup needs to create a highlight whose type (dictionary) points to a quote entity ID, to test if the merge layer detects the mismatch.

### 2.4 Routing Tables

- **[x] 0.9** Add Phase 4 routing in `executePhase2CaseRef()`.
  - **Spec ref**: Design §"Routing Table Updates"
  - **What**: Add a routing block after the Phase 3 cases (`/^20[ab]$/`) that matches `2[1-6][a-e]?` and dispatches to `setupCase21Ref` through `setupCase26Ref`. Case 22b returns `{ ok: true, action: 'blocked', note: 'Quotes immutable per §13.6. NOT APPLICABLE.' }`.
  - **Where**: `dev-sync-cycle.mjs` — `executePhase2CaseRef()` function (~line 623)
  - **Test**: Verify routing produces correct action keys for each normalized ref.
  - **Note**: The setup functions themselves will be implemented in Phases 1–6. This task stubs the routing so cases can be wired incrementally.

- **[x] 0.10** Add Phase 4 routing in `computeCaseAcceptanceVerdict()`.
  - **Spec ref**: Design §"Routing Table Updates"
  - **What**: Add a routing block after the Phase 3 cases that matches `2[1-6][a-e]?` and dispatches to `computeCase21Verdict` through `computeCase26Verdict`. Case 22b returns `'warn'`.
  - **Where**: `dev-sync-cycle.mjs` — `computeCaseAcceptanceVerdict()` function (~line 965)
  - **Test**: Verify routing returns expected verdict when verdict functions are stubbed.
  - **Note**: The verdict functions themselves will be implemented in Phases 1–6. This task stubs the routing.

---

## 3. Phase 1: Case 23 — Concurrent Creations (5 sub-cases)

**Execution order**: 23a → 23b → 23c → 23d → 23e
**Rationale**: Extends proven Phase 3 patterns. Most sub-cases call existing `setupCase{15-17}Ref` with O⇄M parameterization.

### Setup

- **[x] 1.1** Implement `setupCase23Ref(normalized, stateEnv, env, runId, now)` with sub-case routing and full spawnFixture calls.
  - **Spec ref**: R-P4.23.a–e, Design §"Case 23 — Concurrent Creations"
  - **What**: Factory function with per-sub-case spawnFixture calls for all 5 sub-cases (23a-23e).
  - **Where**: `dev-sync-cycle.mjs`

- **[x] 1.2** Implement 23a (same book, same ID) + 23b (same book, different IDs).
  - **Spec ref**: R-P4.23.a, R-P4.23.b
  - **What**: Both sides call `spawnFixture(--case15 hash)` independently with same hash.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase23Ref()`

- **[x] 1.3** Implement 23c (same dictionary word, concurrent — extends Case 16).
  - **Spec ref**: R-P4.23.c
  - **What**: Desktop + Android each create independent dict entry with same term via `--dict`.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase23Ref()`

- **[x] 1.4** Implement 23d (same quote, same range — extends Case 17).
  - **Spec ref**: R-P4.23.d
  - **What**: Desktop + Android each create independent quote with same book+cfi+text via `--quote`.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase23Ref()`

- **[x] 1.5** Implement 23e (same quote text, two different books).
  - **Spec ref**: R-P4.23.e
  - **What**: Desktop creates quote on book L1. Android gets second book via `--case15 secondHash`, creates quote on L2.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase23Ref()`

- **[x] 1.6** Implement `computeCase23Verdict(normalized, pre, post, context)`.
- **[x] 1.7** Add unit tests for Case 23 verdicts.
  - **What**: Mock pre/post state snapshots for each sub-case. Test PASS/FAIL/WARN paths.
  - **Where**: `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`
  - **Pattern**: Follow the existing `describe('case-16 computeCaseAcceptanceVerdict')` pattern — basePre/basePost with `context.caseActions`.

---

## 4. Phase 2: Case 21 — Same-field Edit (4 sub-cases)

**Execution order**: 21c → 21a → 21b → 21d
**Rationale**: Easiest field to check first (book title); tiebreak requires special HLC forcing.

### Setup

- **[x] 2.1** Implement `setupCase21Ref(normalized, stateEnv, env, runId, now)` with sub-case routing and full spawnFixture calls.
  - **Spec ref**: R-P4.21.a–d, Design §"Case 21 — Same-field Edit"
  - **What**: Factory function with per-sub-case spawnFixture calls for all 4 sub-cases (21a-21d).
  - **Where**: `dev-sync-cycle.mjs`

- **[x] 2.2** Implement 21a (both edit D.definition).
  - **What**: Both sides create D(term, "deep hole") independently via `--dict`. Then both edit definition: desktop→"profound void" (HLC=now+10), android→"very deep chasm" (HLC=now+11).

- **[x] 2.3** Implement 21b (both edit N.note).
  - **What**: Both sides create annotation (text="selected") via `--note`. Set initial note="original idea" via `--edit`. Then both edit note: desktop→"revised analysis" (HLC=now+10), android→"alternative interpretation" (HLC=now+12).

- **[x] 2.4** Implement 21c (both edit L.title).
  - **What**: Both edit book title: desktop→"Desktop Title" (HLC=now+9), android→"Android Title" (HLC=now+14).

- **[x] 2.5** Implement 21d (same HLC → nodeId tiebreak).
  - **What**: Both sides create D(term, "chance"). Both edit definition at EXACT same HLC (now+1000): desktop→"fate", android→"luck". Tiebreak by nodeId.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase21Ref()`

### Verdict

- **[x] 2.6** Implement `computeCase21Verdict(normalized, pre, post, context)`.
  - **Spec ref**: R-P4.21.a–d, Design §"Case 21 — Same-field Edit"
  - **What**:
    - Entity count: EXACTLY ONE for the entity (no duplicate rows). Use `tableRowCount` delta.
    - Field value: The field with newer HLC MUST be the winner on BOTH devices.
      - 21a: `post.desktop.sqlite.dictionary.rows[0].definition === "very deep chasm"` (HLC=11 wins)
      - 21b: `post.desktop.sqlite.annotations.rows[0].note === "alternative interpretation"` (HLC=12 wins), `text` unchanged
      - 21c: `post.desktop.library.facts[0].title === "Android Title"` (HLC=14 wins)
      - 21d: Same definition value on both devices, AND consistent across 5× R-n runs.
    - HLC evidence: `context.caseActions[0].edits` records HLC ordering.
    - Duplicate check: delta > 1 → fail.
    - Determinism check (21d): R-n winner nodeId must be consistent → PASS. Otherwise → FAIL.
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `assertFieldValue` (task 0.3) for field-level comparisons.

### Tests

- **[x] 2.7** Add unit tests for Case 21 verdicts (13 tests: 21a-21d PASS/FAIL/WARN).
  - **What**: Mock pre/post state snapshots. Test each sub-case: PASS when newer-HLC value on both sides, FAIL when stale value or duplicate, WARN when HLC evidence missing. For 21d, test deterministic winner across repeated runs.
  - **Where**: `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`

---

## 5. Phase 3: Case 22 — Edit vs Delete (2 active + 1 BLOCKED)

**Execution order**: 22a (dict) → 22c (annotation). 22b = BLOCKED.

### Setup

- **[x] 3.1** Implement `setupCase22Ref(normalized, stateEnv, env, runId, now)`.
  - **Spec ref**: R-P4.22.a–c, Design §"Case 22 — Edit vs Delete"
  - **What**: Factory function. 22b returns `{ ok: true, action: 'blocked', note: 'Quotes immutable per §13.6. NOT APPLICABLE.' }`.
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Test**: Verify routing and blocked status for 22b.

- **[x] 3.2** Implement 22a (dictionary delete vs edit) + HLC variants.
  - **Spec ref**: R-P4.22.a
  - **What**: Seed D(term="valle", definition="valley") on both sides.
    - **Variant 1** (delete wins): Desktop deletes D (HLC=12). Android edits D.definition to "gorge" (HLC=11). Delete HLC > edit HLC → D tombstoned.
    - **Variant 2** (edit wins): Desktop deletes D (HLC=10). Android edits to "gorge" (HLC=14). Edit HLC > delete HLC → D live with new definition.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase22Ref()`
  - **Reuses**: `spawnFixture --delete dictionary_entries:<entryId>`, `--edit dictionary_entries:<entryId>:definition=<value>`.

- **[x] 3.3** Implement 22c (annotation delete vs edit) + HLC variants.
  - **Spec ref**: R-P4.22.c
  - **What**: Seed N(text="selected", note="original") on both sides.
    - **Variant 1** (delete wins): Desktop deletes N (HLC=15). Android edits note to "updated" (HLC=14). N tombstoned.
    - **Variant 2** (edit wins): Desktop deletes N (HLC=10). Android edits to "updated" (HLC=14). N live with new note.
  - **Where**: `dev-sync-cycle.mjs` — within `setupCase22Ref()`
  - **Reuses**: `spawnFixture --delete annotations:<annId>`, `--edit annotations:<annId>:note=<value>`.

### Verdict

- **[x] 3.4** Implement `computeCase22Verdict(normalized, pre, post, context)`.
  - **Spec ref**: R-P4.22.a–c, Design §"Case 22 — Edit vs Delete"
  - **What**:
    - Entity state check (tombstone vs live) using `assertEntityState` (task 0.4).
    - When delete HLC > edit HLC: entity TOMBSTONED on both. Edit value NOT visible.
    - When edit HLC > delete HLC: entity LIVE with edit value on both.
    - No duplicate rows (exactly one row per entity, tombstoned or live).
    - HLC evidence: context records which HLC won.
    - 22b returns `'warn'` (not applicable, not an error).
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `assertEntityState` (task 0.4), `assertFieldValue` (task 0.3) for edit value checks.

### Tests

- **[x] 3.5** Add unit tests for Case 22 verdicts.
  - **What**: Mock states with tombstoned vs live entities. Test PASS when entity state matches expected, FAIL on resurrected data or duplicate rows, WARN when HLC evidence missing. Test 22b always returns 'warn'.
  - **Where**: `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`

---

## 6. Phase 4: Case 24 — Distinct Annotations Same Range (1 sub-case)

Simple case — two annotations on the same CFI range must both survive.

### Setup

- **[x] 4.1** Implement `setupCase24Ref(normalized, stateEnv, env, runId, now)` with full spawnFixture calls.
  - **Spec ref**: R-P4.24, Design §"Case 24 — Distinct Annotations Same Range"
  - **What**: Desktop creates N1(range=100-120, note="Idea A") via `--note` → Android creates N2(range=100-120, note="Idea B") via `--note`. Both before sync.
  - **Where**: `dev-sync-cycle.mjs`

### Verdict

- **[x] 4.2** Implement `computeCase24Verdict(normalized, pre, post, context)`.
  - **Spec ref**: R-P4.24, Design §"Case 24 — Distinct Annotations Same Range"
  - **What**:
    - TWO annotations on both sides (annotations table delta === 2, replica `annotation` rowCount delta === 2).
    - TWO highlights in `config.json` booknotes on both sides.
    - Notes preserved: N1.note === "Idea A", N2.note === "Idea B".
    - No merge: both distinct rows.
    - Duplicate delta > 2 → fail.
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `tableRowCount`, `replicaRowCount`, config.json booknotes.

### Tests

- **[x] 4.3** Add unit tests for Case 24 verdicts (4 tests: PASS/FAIL/WARN).
  - **What**: Mock two-annotation post-state vs one-annotation post-state. Test PASS when both survive, FAIL when only one, WARN when config.json incomplete.
  - **Where**: `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`

---

## 7. Phase 5: Case 25 — Highlight Group Mutation (1 sub-case, DISCOVER)

**DISCOVER-first**: The verdict function OBSERVES what the merge layer does rather than asserting expected behavior. If the merge layer allows type drift, this is a FAIL and product code changes are needed.

### Setup

- **[x] 5.1** Implement `setupCase25Ref(normalized, stateEnv, env, runId, now)`.
  - **Spec ref**: R-P4.25, Design §"Case 25 — Highlight Group Mutation"
  - **What**: `ensurePhase2LiveBook()` → Desktop creates `H_N(range=100-120)` → N(note="original") with annotation type. Then Android calls `--booknote-mutate <bookHash>:<noteId>:cite` (via task 0.7) to change the BookNote type from annotation to cite.
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `spawnFixture --note`, `--booknote-mutate` (fixture op from task 0.7).
  - **Test**: Verify that the BookNote type is changed before sync.

### Verdict

- **[x] 5.2** Implement `computeCase25Verdict(normalized, pre, post, context)`.
  - **Spec ref**: R-P4.25, Design §"Case 25 — Highlight Group Mutation (DISCOVER)"
  - **What**: OBSERVATIONAL verdict. Capture what the sync layer did and classify:
    - **PASS**: Type integrity preserved — `H_N` remains annotation type. Either (a) `H_C` rejected or (b) `H_C` exists as separate highlight (type drift prevented).
    - **FAIL**: Type drift detected — `H_N` type changed to `H_C` on either device. OR data loss (one highlight replaced the other).
    - **WARN**: Type preserved but config.json evidence incomplete (missing on one device).
    - Both devices MUST agree on type → PASS. Divergent types → FAIL.
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `assertBookNoteType` (task 0.6) and `assertBookNoteIntegrity` (task 0.5).
  - **Output**: Structured discovery log in report under `discovery` key (see Design §"Real-Device Protocol" item 5).

### Tests

- **[x] 5.3** Add unit tests for Case 25 verdicts.
  - **What**: Mock config.json states where type is preserved (PASS), type drifts (FAIL), or config is missing on one device (WARN).
  - **Where**: `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`

---

## 8. Phase 6: Case 26 — Wrong Group Pointer (1 sub-case, DISCOVER)

**DISCOVER-first**: The verdict function OBSERVES whether the merge layer rejects cross-type pointers.

### Setup

- **[x] 6.1** Implement `setupCase26Ref(normalized, stateEnv, env, runId, now)`.
  - **Spec ref**: R-P4.26, Design §"Case 26 — Wrong Group Pointer"
  - **What**: `ensurePhase2LiveBook()` → Desktop creates `H_D(range=100-120)` → D(term="error") with dictionary type. Then Android calls `--booknote-invalid-ref <bookHash>:<noteId>:quote:<wrongCiteId>` (via task 0.8) to change the H_D pointer from `dictionaryEntryId=D` to `citeId=C` (cross-type).
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `spawnFixture --dict`, `--booknote-invalid-ref` (fixture op from task 0.8).
  - **Test**: Verify the BookNote pointer is cross-type before sync.

### Verdict

- **[x] 6.2** Implement `computeCase26Verdict(normalized, pre, post, context)`.
  - **Spec ref**: R-P4.26, Design §"Case 26 — Wrong Group Pointer (DISCOVER)"
  - **What**: OBSERVATIONAL verdict. Capture what the sync layer did and classify:
    - **PASS**: Cross-type pointer detected — highlight rejected, marked unresolved, or pointer corrected. Both devices agree.
    - **FAIL**: Cross-type pointer silently accepted on either device. OR data corruption.
    - **WARN**: Mismatch detected but resolution strategy unverifiable. OR one device has invalid pointer while the other rejected it.
  - **Where**: `dev-sync-cycle.mjs` — new function
  - **Uses**: `assertBookNoteIntegrity` (task 0.5) with type-entity pair check.
  - **Output**: Structured discovery log in report under `discovery` key.

### Tests

- **[x] 6.3** Add unit tests for Case 26 verdicts.
  - **What**: Mock config.json states where cross-type pointer is rejected (PASS), silently accepted (FAIL), or detection unverifiable (WARN).
  - **Where**: `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`

---

## 9. Verification Checklist

Use this checklist after all tasks are complete to verify Phase 4 readiness.

| Check | Pass criteria |
|-------|--------------|
| All 14 sub-cases have setup functions | Each normalized ref (21a-21d, 22a/22c, 23a-23e, 24, 25, 26) dispatches to a setup path |
| All 14 sub-cases have verdict functions | Each normalized ref dispatches to a verdict path in `computeCaseAcceptanceVerdict` |
| 22b returns blocked | `executePhase2CaseRef('22b')` returns `{ action: 'blocked', note: '...' }` |
| State capture includes rows | `captureTable` returns `rows` array. `queryReplicaKind` returns `rows` array. |
| Assert helpers exported | `assertFieldValue`, `assertEntityState`, `assertBookNoteIntegrity`, `assertBookNoteType` are exported from `assert-engine.mjs` |
| Fixture ops work | `--booknote-mutate` and `--booknote-invalid-ref` are parsed and dispatched in `dev-sync-fixture.mjs` |
| DISCOVER evidence logged | Cases 25-26 verdicts produce `discovery` key in report |
| O⇄M pattern used | No O→M or M→O variants for Phase 4 (redundant with Phase 2/3) |
| R-n variant supported | All cases except 25-26 support `--repeat 5` |
| Unit tests pass | `node --test apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` passes |
