# Design: Phase 4 — Conflictos Reales (Real Conflicts)

## Technical Approach

Phase 4 extends the existing 4-layer harness pattern (preflight → setup → sync → verdict) with 6 new cases (21-26, 14 sub-cases total) that test true concurrent conflict. The key architectural difference from Phase 3 is that verdicts now require **field-level value assertions** (not just row counts) and **HLC ordering evidence** (not just existence).

The design follows three principles:
1. **Same harness skeleton** — `setupCase{NN}Ref()` + `computeCase{NN}Verdict()` per case, routed through `executePhase2CaseRef` and `computeCaseAcceptanceVerdict`
2. **O⇄M concurrency via two-phase fixture** — both devices act independently before first sync; the setup function applies fixture A, then fixture B, then returns (sync runs after)
3. **DISCOVER-first for Cases 25-26** — probe real merge behavior before asserting; product fixes added only if probe reveals missing validation

## Architecture Decisions

### Decision: Field-level verdicts need extended state capture

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Add field-level SQL to `sync-dev-state.mjs` | Touches state capture but enables all verdicts cleanly | **Adopted** |
| Inline queries in verdict function | Duplicates state logic, harder to test | Rejected |
| Only check row counts + config.json | Insufficient for Cases 21-22 where field VALUE matters | Rejected |

**Rationale**: The existing `compareSemanticState` in `assert-engine.mjs` already supports field-level comparison via `hlcAndTombstoneFailures()` — but only when state includes `text`/`term` fields. We extend `sync-dev-state.mjs` to capture specific field values for dictionary entries, annotations, and quotes (desktop SQLite + Android replicas) when a `bookHash` or entity ID context is available. This gives verdict functions access to `state.desktop.sqlite.dictionary.rows[i].definition` without new DB connections.

### Decision: Case 23c/23d/23e extend Phase 3 setup functions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New `setupCase23Ref` routing to Phase 3 helpers | Clean routing, reuses proven code | **Adopted** |
| Duplicate Phase 3 setup inline | Maintenance burden | Rejected |

**Rationale**: 23c is "same word, O⇄M variant" — semantically identical to Case 16 but both sides create before sync. Rather than duplicating `setupCase16Ref`, we call it from `setupCase23Ref` for the `23c` normalized ref, then apply the O⇄M pattern. Same for 23d (→ Case 17) and 23e (→ Case 16 quote variant but different books).

### Decision: Cases 25-26 verdicts are observational, not normative

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Fixed PASS/FAIL criteria | Would fail if current behavior is lenient | Rejected |
| **DISCOVER** — capture actual behavior, decide pass/fail based on safety | Product fix only if merge layer allows corruption | **Adopted** |

**Rationale**: Per spec, "System behavior is unknown." The verdict functions for 25-26 first capture what the sync layer does, then classify: if type drift or cross-type pointer is silently accepted, it's FAIL (data corruption risk). If rejected/marked-unresolved, it's PASS. This maps to the spec's verdict criteria.

### Decision: HLC tiebreak (21d) forced by identical `--hlc` timestamps

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Manipulate counter in HLC library | Tight coupling to HLC internals | Rejected |
| **Same `--hlc` millisecond on both edits** | Counter+nodeId break tie naturally | **Adopted** |

**Rationale**: The fixture's `--hlc` accepts a numeric millisecond timestamp that becomes the HLC physical component. If both edits use `--hlc ${sameValue}`, the physical time and counter match. The `nodeId` (from `_replicas`) provides deterministic tiebreak. Determinism is verified across 5× R-n runs.

## Data Flow

```
executePhase2CaseRef("21a")
  │
  ├─ setupCase21Ref("21a", stateEnv, env, runId, now)
  │   ├─ ensurePhase2LiveBook()        # Book L + seed
  │   ├─ spawnFixture(desktop, --dict term --hlc now)    # Converged D
  │   ├─ spawnFixture(android, --dict term --hlc now)    # Same D on both
  │   ├─ spawnFixture(desktop, --edit D:definition=val1 --hlc now+10)  # Desktop edit
  │   └─ spawnFixture(android, --edit D:definition=val2 --hlc now+11)  # Android edit (wins)
  │   └─ → { ok, bookHash, term, entryId, edits: [{device, hlc, value}] }
  │
  ├─ [harness triggers sync]
  │
  └─ computeCase21Verdict("21a", pre, post, context)
      ├─ Entity count check (tableRowCount ± delta)
      ├─ Field value check: post.desktop.sqlite.dictionary.rows[0].definition === expected
      ├─ Field value check: post.android.replicas['dictionary-entry'].rows[0].definition === expected
      └─ HLC evidence: state.replicas['dictionary-entry'].hlcMax ≥ expected HLC
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modify | Add `setupCase21Ref` through `setupCase26Ref`, `computeCase21Verdict` through `computeCase26Verdict`, routing in `executePhase2CaseRef` and `computeCaseAcceptanceVerdict` |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modify | Extend `captureDesktopState` and `captureAndroidState` to include field-level SQLite row data (not just counts) and full replica row data |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modify | Add `--case21` through `--case26` operation types; add `--booknote-mutate` flag for Case 25; add `--booknote-invalid-ref` flag for Case 26 |
| `apps/readest-app/scripts/assert-engine.mjs` | Modify | Add `assertFieldValue`, `assertEntityState` (live vs tombstone), `assertBookNoteIntegrity`, `assertBookNoteType` |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modify | Add unit tests for all new verdict functions (mocked state) |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modify | Add `injectBookNoteMutation` and `injectInvalidBookNoteRef` for Cases 25-26 |

## New Functions Design

### Case 21 — Same-field Edit (4 sub-cases: 21a-21d)

**`setupCase21Ref(normalized, stateEnv, env, runId, now)`**

```
Parameters: standard (normalized, stateEnv, env, runId, now)
Execution plan:
1. ensurePhase2LiveBook() → bookHash
2. Switch on normalized:
   21a: Create D term on desktop (--dict), then on android-http. Both get same term+definition.
        Edit D.definition on desktop (--edit, HLC=now+10), edit on android-http (HLC=now+11).
   21b: Create N annotation on desktop, then on android-http. Same note text.
        Edit N.note on desktop (HLC=now+10), edit on android-http (HLC=now+12).
   21c: Seed book L. Edit L.title on desktop (HLC=now+9), on android-http (HLC=now+14).
   21d: Create D term. Edit D.definition on desktop (HLC=now+1000, same phys), on android-http (HLC=now+1000, same phys).
3. Return { ok, bookHash, term/entityId, edits: [{device, hlc, value}] }
```

**`computeCase21Verdict(normalized, pre, post, context)`**

```
Verdict logic:
- Entity count: EXACTLY ONE for the entity (no duplicate rows). Use tableRowCount delta.
- Field value: The field with newer HLC must be the winner on BOTH devices.
  - 21a: post.desktop.sqlite.dictionary.rows[0].definition === "very deep chasm" (android HLC=11 wins)
  - 21b: post.desktop.sqlite.annotations.rows[0].note === "alternative interpretation" (HL=12 wins)
  - 21c: post.desktop.library.facts[0].title === "Android Title" (HLC=14 wins)
  - 21d: post.desktop.sqlite.dictionary.rows[0].definition is the same on both, and deterministic.
- HLC evidence: context.caseActions[0].edits contains the HLC ordering.
- Duplicate check: delta > 1 → fail.
- Immutability check (21b): post.text === original text (unchanged).
- Determinism check (21d): Run R-n 5×, winner nodeId must be consistent.
Returns 'pass' | 'fail' | 'warn'
```

**What it reuses**: `ensurePhase2LiveBook`, `spawnFixture` with `--edit`, `tableRowCount`

### Case 22 — Edit vs Delete (2 active sub-cases: 22a, 22c; 22b BLOCKED)

**`setupCase22Ref(normalized, stateEnv, env, runId, now)`**

```
Execution plan:
1. ensurePhase2LiveBook() → bookHash
2. Switch on normalized:
   22a: Create D term on both. Desktop deletes D (--delete, HLC=12).
        Android edits D.definition to "gorge" (--edit, HLC=11).
        Variant: swapped HLCs (desktop delete HLC=10, android edit HLC=14).
   22c: Create N annotation on both. Desktop deletes N (HLC=15).
        Android edits N.note to "updated" (HLC=14).
        Variant: swapped HLCs.
3. Return { ok, bookHash, entityId, deleteHLC, editHLC, editValue }
```

**`computeCase22Verdict(normalized, pre, post, context)`**

```
Verdict logic:
- Entity state: entity is TOMBSTONED on both when deleteHLC > editHLC.
  Use sqlite row deletedAt / replica tombstone state.
- Entity state: entity is LIVE with edit value when editHLC > deleteHLC.
- No duplicate: exactly one row (tombstoned or live).
- HLC evidence: context records which HLC won.
Returns 'pass' | 'fail' | 'warn'
```

**What it reuses**: `spawnFixture --delete`, `spawnFixture --edit`

### Case 23 — Concurrent Creations (5 sub-cases: 23a-23e)

**`setupCase23Ref(normalized, stateEnv, env, runId, now)`**

```
Execution plan:
1. ensurePhase2LiveBook() → bookHash (for 23a-23d)
2. Switch on normalized:
   23a: spawnFixture(desktop, --case15 hashA) + spawnFixture(android, --case15 hashA) → same ID
   23b: spawnFixture(desktop, --case15 hashXYZ id=A1) + spawnFixture(android, --case15 hashXYZ id=B1)
   23c: REUSE setupCase16Ref("16a"...) but both sides create before sync.
        Desktop creates D1(term=word), Android creates D2(term=same word).
   23d: REUSE setupCase17Ref("17a"...) but both sides create before sync.
        Desktop creates C1(range=R), Android creates C2(range=R).
   23e: Two separate books. Desktop creates L1 + C1(text="same").
        Android creates L2 + C2(text="same", different book).
3. Return { ok, bookHash(s), entityIds }
```

**`computeCase23Verdict(normalized, pre, post, context)`**

```
Verdict logic:
23a: EXACTLY ONE book hash=XYZ on both sides → pass
23b: EXACTLY ONE book hash=XYZ, _replicas shows both IDs → pass
23c: REUSE computeCase16Verdict logic (one dict entry, both occs preserved)
23d: REUSE computeCase17Verdict logic (one quote)
23e: TWO quotes on both devices, different bookHash → pass
Returns 'pass' | 'fail' | 'warn'
```

**What it reuses**: `setup/verify from Case 15` for 23a-23b, `Case 16` for 23c, `Case 17` for 23d, `Case 17 + 15` for 23e

### Case 24 — Distinct Annotations Same Range (1 sub-case)

**`setupCase24Ref(normalized, stateEnv, env, runId, now)`**

```
Execution plan:
1. ensurePhase2LiveBook() → bookHash
2. Desktop creates N1(range=100-120, note="Idea A") at HLC=now
3. Android creates N2(range=100-120, note="Idea B") at HLC=now+2000
4. BOTH before sync (O⇄M)
5. Return { ok, bookHash, annIds: [id1, id2], notes: ["Idea A", "Idea B"] }
```

**`computeCase24Verdict(normalized, pre, post, context)`**

```
Verdict logic:
- TWO annotations on both sides (annotations table delta === 2)
- TWO highlights in config.json booknotes (config on both sides)
- Notes preserved: N1.note === "Idea A", N2.note === "Idea B"
- No merge: both distinct rows
Returns 'pass' | 'fail' | 'warn'
```

**What it reuses**: Case 20 annotation pattern, but simpler (no overlap, same CFI)

### Case 25 — Highlight Group Mutation (1 sub-case, DISCOVER)

**`setupCase25Ref(normalized, stateEnv, env, runId, now)`**

```
Execution plan:
1. ensurePhase2LiveBook() → bookHash
2. Desktop creates H_N(range=100-120) → N(note="original") with annotation type
3. Android creates H_C(range=100-120) → C(text="quote") with CITATION type (mutated)
4. Sync O⇄M
5. Return { ok, bookHash, originalNote, mutatedNote }
```

**`computeCase25Verdict(normalized, pre, post, context)`**

```
Verdict logic:
- OBSERVATIONAL: capture what happened
- Check if H_N type drifted to H_C (FAIL)
- Check if H_C was rejected or exists as separate highlight (PASS)
- Both devices agree on type (PASS)
Returns 'pass' if type integrity preserved, 'fail' if drift detected, 'warn' if config.json incomplete
```

**What it reuses**: `spawnFixture --note`, `spawnFixture --quote`, config.json evidence

### Case 26 — Wrong Group Pointer (1 sub-case, DISCOVER)

**`setupCase26Ref(normalized, stateEnv, env, runId, now)`**

```
Execution plan:
1. ensurePhase2LiveBook() → bookHash
2. Desktop creates H_D(range=100-120) → D(term="error") with dictionary type
3. Android modifies config.json: H_D now has citeId=C instead of dictionaryEntryId=D
4. Sync O⇄M
5. Return { ok, bookHash, originalPointer, mutatedPointer }
```

**`computeCase26Verdict(normalized, pre, post, context)`**

```
Verdict logic:
- OBSERVATIONAL: capture what happened
- Check if cross-type pointer was accepted silently (FAIL)
- Check if system rejected/marked-unresolved the invalid pointer (PASS)
- No data corruption on either device (PASS)
Returns 'pass' if mismatch detected, 'fail' if silent acceptance, 'warn' if unverifiable
```

**What it reuses**: config.json evidence, `putAndroidBookConfig` to inject invalid config

## New Assertion Helpers

### `assertFieldValue(entityType, entityId, field, expectedValue, state)`

**Purpose**: Assert a specific field on a specific entity has a specific value. Needed for Cases 21-22 where field VALUES must be checked, not just counts.

```
Parameters:
  entityType: 'dictionary-entry' | 'annotation' | 'book'
  entityId: string (normalized term for dict, hash for book, id for annotation)
  field: field name ('definition', 'note', 'title')
  expectedValue: expected string/number
  state: desktop or android state snapshot

Returns: { verdict: 'PASS'|'FAIL', failures: [{invariant, entityType, field, expected, actual}] }

Logic:
  - Access state.desktop.sqlite.dictionary.rows[i].definition for dict entries
  - Access state.desktop.sqlite.annotations.rows[i].note for annotations
  - Access state.desktop.library.facts[i].title for books
  - For Android: access state.android.replicas['dictionary-entry'].rows[i] etc.
  - Compare with expectedValue; case-sensitive
```

### `assertEntityState(entityType, entityId, state)`

**Purpose**: Determine if an entity is LIVE or TOMBSTONED. Needed for Case 22 (edit vs delete).

```
Parameters:
  entityType: 'dictionary-entry' | 'annotation' | 'book'
  entityId: string
  state: desktop or android state snapshot

Returns: { state: 'live' | 'tombstone' | 'not-found', evidence: { deletedAt?, updatedAt?, ... } }

Logic:
  - For dictionary: check sqlite.dictionary.rows[i].deleted_at
  - For annotation: check sqlite.annotations.rows[i].deleted_at
  - For book: check library.facts[i].deletedAt
```

### `assertBookNoteIntegrity(bookHash, noteId, expectedType, expectedEntityId, config)`

**Purpose**: Validate that a config.json BookNote entry has the correct type-entity reference pair. Needed for Cases 25-26.

```
Parameters:
  bookHash: string
  noteId: string (the BookNote.id in config.json)
  expectedType: 'dictionary' | 'quote' | 'annotation'
  expectedEntityId: string (the expected entity ID in the pointer field)
  config: config.json state (captured in state.desktop.bookConfig or state.android.bookConfig)

Returns: { verdict: 'PASS'|'FAIL', failures: [{invariant, field, expected, actual}] }

Logic:
  - Find note in config.booknotes[] by noteId
  - Check note.type === expectedType
  - Check that the pointer field matches the type:
    - type='dictionary' → note.dictionaryEntryId === expectedEntityId
    - type='quote' → note.citeId === expectedEntityId
    - type='annotation' → note.annotationId === expectedEntityId
  - Cross-type pointers (e.g., type='dictionary' with citeId set) are INVALID
```

### `assertBookNoteType(bookHash, noteId, expectedType, config)`

**Purpose**: Assert the semantic type of a BookNote. Simpler than integrity check — only checks type field. Needed for Case 25.

```
Parameters:
  bookHash: string
  noteId: string
  expectedType: 'dictionary' | 'quote' | 'annotation'
  config: config.json state

Returns: { verdict: 'PASS'|'FAIL', failures: [{invariant, field, expected, actual}] }

Logic:
  - Find note in config.booknotes[] by noteId
  - Assert note.type === expectedType
  - FAIL if note.type !== expectedType (type drift detected)
```

## Infrastructure Changes

### State Capture Field Values (`sync-dev-state.mjs`)

Extend `captureDictionaryDb`, `captureAnnotationsDb`, `captureQuotesDb` in `sync-dev-sqlite.mjs` to return full row data alongside counts:

```mjs
// New return shape for each table capture:
{
  available: true,
  status: 'pass',
  tables: [
    {
      name: 'dictionary_entries',
      rowCount: 1,
      rows: [{ id, term, definition, deleted_at, updated_at, replica_timestamps }],
      deletedCount: 0,
      hlcMin: 'T1000',
      hlcMax: 'T2000',
    },
  ],
}
```

This is a backward-compatible addition — existing code that only reads `rowCount` continues to work. The `rows` array is added when the state capture has a `bookHash` (for book-specific queries) or when the query is unfiltered.

For Android replicas, extend `queryReplicaKind` to also return a `rows` sample (first N rows and their field values):

```mjs
// Extended return for each replica kind:
{
  kind: 'dictionary-entry',
  reachable: true,
  rowCount: 1,
  rows: [{ id, term, definition, hlc, deleted_at_ts, fields_jsonb }],
  hlcMin: '...',
  hlcMax: '...',
  tombstoneCount: 0,
}
```

### BookNote Mutation Fixture Support

Add two new fixture CLI operations:

**`--booknote-mutate <bookHash>:<noteId>:<newType>`** — For Case 25. Overwrites a BookNote's type field in config.json on the target device:

```mjs
// In dispatchFixture:
if (opts.booknoteMutate) {
  // Parse bookHash:noteId:newType
  // Read config.json, find note by id, overwrite type
  // Write config.json back
}
```

**`--booknote-invalid-ref <bookHash>:<noteId>:<targetKind>:<wrongEntityId>`** — For Case 26. Replaces a valid entity pointer with a cross-type pointer:

```mjs
if (opts.booknoteInvalidRef) {
  // Parse bookHash:noteId:targetKind:wrongEntityId
  // If targetKind is 'quote', set H_D.citeId = wrongEntityId
  // Remove the original dictionaryEntryId field
  // Write config.json back
}
```

### Routing Table Updates

In `executePhase2CaseRef` (dev-sync-cycle.mjs, around line 595):

```mjs
// Phase 4 routing — after Phase 3 cases
if (/^2[1-6][a-e]?$/.test(normalized)) {
  if (normalized.startsWith('21')) return setupCase21Ref(normalized, stateEnv, env, runId, now);
  if (normalized.startsWith('22')) {
    if (normalized === '22b') return { ok: true, caseRef: '22b', action: 'blocked', note: 'Quotes immutable per §13.6. NOT APPLICABLE.' };
    return setupCase22Ref(normalized, stateEnv, env, runId, now);
  }
  if (normalized.startsWith('23')) return setupCase23Ref(normalized, stateEnv, env, runId, now);
  if (normalized === '24') return setupCase24Ref(normalized, stateEnv, env, runId, now);
  if (normalized === '25') return setupCase25Ref(normalized, stateEnv, env, runId, now);
  if (normalized === '26') return setupCase26Ref(normalized, stateEnv, env, runId, now);
}
```

In `computeCaseAcceptanceVerdict` (dev-sync-cycle.mjs, around line 900):

```mjs
// Phase 4 routing
if (/^2[1-6][a-e]?$/.test(normalized)) {
  if (normalized.startsWith('21')) return computeCase21Verdict(normalized, pre, post, context);
  if (normalized.startsWith('22')) return normalized === '22b' ? 'warn' : computeCase22Verdict(normalized, pre, post, context);
  if (normalized.startsWith('23')) return computeCase23Verdict(normalized, pre, post, context);
  if (normalized === '24') return computeCase24Verdict(normalized, pre, post, context);
  if (normalized === '25') return computeCase25Verdict(normalized, pre, post, context);
  if (normalized === '26') return computeCase26Verdict(normalized, pre, post, context);
}
```

## Variant Mapping

| Case | O⇄M (Concurrent) | R-n (5× isolated) | Notes |
|------|------------------|--------------------|-------|
| 21a | ✓ | ✓ | Both edit before sync. HLC 11 wins over HLC 10. |
| 21b | ✓ | ✓ | Both edit note before sync. HLC 12 wins over HLC 10. |
| 21c | ✓ | ✓ | Both edit title before sync. HLC 14 wins over HLC 9. |
| 21d | ✓ | ✓ | **Same HLC time** → deterministic nodeId tiebreak. R-n must repeat 5× and produce same winner. |
| 22a | ✓ | ✓ | Desktop delete (HLC 12), Android edit (HLC 11). Also variant: swap HLCs. |
| 22c | ✓ | ✓ | Desktop delete (HLC 15), Android edit (HLC 14). Also variant: swap HLCs. |
| 23a | ✓ | ✓ | Both import same book same ID. |
| 23b | ✓ | ✓ | Both import same book different IDs. |
| 23c | ✓ | ✓ | Both create same dictionary word. Reuses Case 16 pattern. |
| 23d | ✓ | ✓ | Both create same quote same range. Reuses Case 17 pattern. |
| 23e | ✓ | ✓ | Both create same text, different books. |
| 24 | ✓ | ✓ | Both create distinct annotations on same CFI range. |
| 25 | ✓ | — | DISCOVER. O⇄M only (5× may not add value for discovery). |
| 26 | ✓ | — | DISCOVER. O⇄M only. |

**How O⇄M is implemented**: The setup function makes TWO fixture calls — first for Device A, then for Device B — WITHOUT an intermediate sync. The harness's single sync call after `setupCase{NN}Ref` returns is the first time both devices see each other's changes.

**How HLC tiebreak (21d) is forced**: Both `spawnFixture --edit` calls pass the same `--hlc ${now+1000}` value. The physical time and counter match; the nodeId (from the replica's `_replicas` metadata) provides the deterministic total order. The fixture's `--hlc` accepts milliseconds; the HLC library converts this to a `(physical, counter, nodeId)` tuple.

## Execution Order

| Order | Case | Effort | Rationale |
|-------|------|--------|-----------|
| 1 | 23 | Lowest | Extends proven Phase 3 patterns (Cases 15-17). Minimal new code — most sub-cases call existing `setupCase{15-17}Ref` with O⇄M parameterization. |
| 2 | 21 | Medium | Core concurrent edit. Needs field-level state capture extension. 4 sub-cases establish the LWW pattern. |
| 3 | 22 | Medium | Edit vs delete. Reuses field-level state from Case 21. Simpler verdict (binary: live vs tombstone). |
| 4 | 24 | Low | Annotations same range. Trivially maps to two-annotation creation. Verdict checks count=2. |
| 5 | 25 | High | DISCOVER-first. Needs BookNote fixture mutation. May need product code changes if merge layer allows type drift. |
| 6 | 26 | High | DISCOVER-first. Needs invalid BookNote ref fixture. May need product code changes. |

### Within each case, sub-case execution order

| Case | Sub-case order | Rationale |
|------|---------------|-----------|
| 21 | 21c (book title, simplest) → 21a (dict definition) → 21b (annotation note) → 21d (tiebreak) | Easiest field to check first; tiebreak requires special HLC forcing |
| 22 | 22a (dict delete) → 22c (annotation delete). 22b = BLOCKED skip. | Dict is most established entity; annotation delete is similar pattern |
| 23 | 23a (same ID) → 23b (different IDs) → 23c (same word, extends 16) → 23d (same quote, extends 17) → 23e (same text, different book) | From simplest book dedup to more complex cross-book quote |
| 24 | Single sub-case 24 | No ordering needed |

## Real-Device Protocol

### Pre-existing Protocol (unchanged)

- `adb reverse` sets up port forwarding for Android ↔ desktop communication
- `am force-stop` for clean process restart after `pm clear`
- Device health checks: doctor verifies ADB device, package, PID, forwarding, sync trigger, manifest, replicas
- `pm clear <package>` for clean Android state
- `BIBLIOTECA_DEV_SYNC_HARNESS=1` marker prevents accidental production writes

### New Protocol Requirements for Phase 4

1. **HLC ordering on real device**: The `--hlc` timestamp must be set high enough to guarantee ordering after real clock drift. Use `now + random_offset` rather than fixed offsets to avoid collisions. For 21d tiebreak, use explicit same value.

2. **Config.json write access for Cases 25-26**: To mutate BookNote types and pointers, the fixture needs to read+write config.json on both desktop filesystem and Android (via `putAndroidBookConfig`). The existing `putAndroidBookConfig` function handles the Android side; desktop writes use direct filesystem operations.

3. **per-field HLC evidence**: The `_replicas` API must return `replica_timestamps` JSON field content. The Android replica endpoint `/replicas/:kind` already returns full row data including `fields_jsonb` envelope. If the `sync-execute.mjs` pipeline sets `replica_timestamps` on dictionary entries, this evidence is available. For Cases 21-22 verdicts, missing per-field HLC timestamps degrade to WARN (per spec §1.2).

4. **State capture timeout**: Real-device state capture for Cases 25-26 needs to read config.json after sync. The existing `captureDesktopBookConfig` and `captureAndroidBookConfig` already handle this. No new endpoints needed.

5. **Discovery log for Cases 25-26**: The harness MUST log the observed merge behavior for cases 25-26 (what happened to the mutated/invalid BookNote). This log is used to decide whether product code changes are needed. Log format: structured JSON in the report under `discovery` key.
