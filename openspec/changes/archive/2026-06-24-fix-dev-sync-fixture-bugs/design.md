# Design: Fix Dev Sync Fixture Bugs

## Technical Approach

Three bugs make `dev-sync-fixture.mjs` silently fail on empty Tauri-created DBs: (1) `injectDictionary`/`injectQuote`/`injectAnnotation` discard `injectRows` errors, (2) no tables exist before INSERTs, (3) `comment`/`selected_text` columns don't exist in Tauri's schema. Fix by adding an `ensureTable` helper inside `injectRows`, propagating `{ok, error}` returns through all inject functions, and removing the two bad columns from row payloads. Mapped from spec requirements R1–R4 (error propagation, schema init, column alignment, CLI fix).

## Architecture Decisions

### Decision 1: ensureTable placement and DDL fidelity

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Call ensureTable at top of `injectRows` | Centralized; runs on every call but idempotent via IF NOT EXISTS | **Chosen** |
| Call ensureTable in each fixture function | Duplicated logic; easy to miss a path | Rejected |
| Tauri DDL from visible_repo.rs exactly | Ground truth for real-device sync; but fixture also inserts `replica_timestamps` not in Tauri DDL | **Chosen with note** |

**Rationale**: ensureTable runs inside `injectRows` so ALL callers get table creation, not just the fixture functions. The DDL mirrors Tauri's `visible_repo.rs` exactly with a source comment (file + line). The `replica_timestamps` column gap is surfaced as an open question.

### Decision 2: Error propagation pattern

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Check `result.ok` and return early | Consistent with existing `{ok, error}` convention | **Chosen** |
| Throw exceptions | Breaks caller expectations; all callers expect result objects | Rejected |

**Rationale**: Every `injectRows` call in the three fixture functions gets wrapped: `const r = injectRows(...); if (!r.ok) return r;`. Zero new convention.

### Decision 3: Column removal scope

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Remove only `comment` (quotes) + `selected_text` (annotations) | Minimal; addresses the 3 bugs | **Chosen** |
| Full column alignment with Tauri DDL | Correct but larger scope; affects `replica_timestamps` everywhere | Deferred |

**Rationale**: Scope follows the spec scenarios exactly. Removing `replica_timestamps` is a separate change (affects all 4 tables, all test helpers, and all existing fixture data).

## Data Flow

```
CLI (dev-sync-fixture.mjs)
  │ injectDictionary / injectQuote / injectAnnotation
  │   ↓ check result.ok ← NEW
  └── injectRows (sync-dev-inject.mjs)
        │ ensureTable(dbPath, table) ← NEW
        │   └── execFileSync("sqlite3", [dbPath, "CREATE TABLE IF NOT EXISTS ..."])
        │ build INSERT statement (dynamic from row keys)
        │ execFileSync / runAdb
        └── return {ok, error}  (already correct)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `scripts/sync-dev-inject.mjs` | Modify | Add `ensureTable` helper; call at top of `injectRows` before SQL build |
| `scripts/dev-sync-fixture.mjs` | Modify | Error checks on every `injectRows` call; remove `comment`/`selected_text` from payloads; CLI uses `result.ok` |
| `src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | 2 assertion removals + 4 DDL helper updates |

## Interfaces / Contracts

### ensureTable
```js
/**
 * Ensure a SQLite table exists with DDL matching Tauri's visible_repo.rs.
 * Source ref: src-tauri/src/visible_repo.rs lines 715, 781, 847, 985
 * Idempotent — safe to call on every injectRows invocation.
 *
 * @param {string} dbPath
 * @param {string} table — one of: annotations, quotes, dictionary_entries, dictionary_occurrences
 * @param {Function} execFileSync
 * @returns {{ok: boolean, error?: string}}
 */
function ensureTable(dbPath, table, execFileSync) { ... }
```

### injectDictionary / injectQuote / injectAnnotation return
All three now return `{ok: boolean, ...data}` on success, or `{ok: false, error: string}` on failure. Previously they always returned the data object and ignored errors.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Error propagation from each injectX | Existing tests continue to pass after adding error-check wrappers |
| Integration | ensureTable creates tables on empty DB | Tests already create empty DBs — ensureTable runs before inserts |
| Assertion fix | Remove `comment` from quotes assertion | `createEmptyQuotesDb` DDL gets `comment TEXT` removed; `injectQuote` test drops `expect(rows[0].comment)` |
| Assertion fix | Remove `selected_text` from annotations assertion | `createEmptyAnnotationsDb` DDL gets `selected_text TEXT` removed; `injectAnnotation` test drops `expect(rows[0].selected_text)` |
| DDL alignment | 4 inline DDL helpers in CLI + edit/delete tests | `comment TEXT` removed from quotes tables (lines 2714, 2853); `selected_text TEXT` removed from annotations tables (lines 2736, 2880) |

## Specific Test Changes

| Location | Change |
|----------|--------|
| Line 2545 | `comment TEXT,` → removed from `createEmptyQuotesDb` DDL |
| Line 2560 | `selected_text TEXT,` → removed from `createEmptyAnnotationsDb` DDL |
| Line 2647 | `expect(rows[0].comment)` → removed |
| Line 2676 | `expect(rows[0].selected_text)` → removed |
| Line 2714 | `comment TEXT,` → removed from CLI `--quote` test DDL |
| Line 2736 | `selected_text TEXT,` → removed from CLI `--note` test DDL |
| Line 2853 | `comment TEXT,` → removed from softDelete quotes DDL |
| Line 2880 | `selected_text TEXT,` → removed from stale annotations DDL |

Assertions on `selected_text` in `dictionary_occurrences` (lines 2599, 2623, 2705) are NOT removed — that column IS valid in the Tauri schema.

## Migration / Rollout

No migration required. Dev-only tooling change.

## Open Questions

- [ ] **`replica_timestamps` column gap**: Tauri DDL for all 4 tables lacks the `replica_timestamps` column, but the fixture inserts it in every row payload. If `ensureTable` creates tables with Tauri DDL, the fixture's own INSERTs will fail. The implementor should either (a) extend `ensureTable` DDL with `replica_timestamps` (pragmatic), or (b) remove `replica_timestamps` from all fixture payloads (full alignment, out-of-scope for this change). **Recommendation**: extend DDL with `replica_timestamps` and annotate it as a fixture-only extension in the source comment.
