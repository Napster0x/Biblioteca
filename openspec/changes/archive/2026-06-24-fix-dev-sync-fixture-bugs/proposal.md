# Proposal: Fix Dev Sync Fixture Bugs

## Intent

`dev-sync-fixture.mjs` silently fails in real-device sync testing (Caso 3):  
- `injectRows` errors are discarded — fixture always returns `{ok: true}`  
- SQLite DBs created empty by Tauri have no tables → INSERT fails  
- `selected_text` column doesn't exist in annotations schema → INSERT fails  

These bugs make the fixture unreliable for harness test data creation.

## Scope

### In Scope
1. **Error propagation**: `injectDictionary`, `injectQuote`, `injectAnnotation` MUST check `injectRows` return and surface errors.
2. **Schema init**: Run `CREATE TABLE IF NOT EXISTS` matching Tauri sync schema (`visible_repo.rs`) before inserts.
3. **Column alignment**: Remove `selected_text` from annotations; remove `comment` from quotes (column doesn't exist in either Tauri or TS schema).
4. **CLI output**: Use `result.ok` instead of hardcoded `true`.

### Out of Scope
- Tauri/DB schema changes — fixture adapts to existing schema
- New fixture capabilities (edits, deletes, tombstones)
- Spec-level behavior changes

## Capabilities

### New Capabilities
None — pure reliability fix, no new feature.

### Modified Capabilities
None — spec-level behavior unchanged; only robustness improves.

## Approach

1. **`sync-dev-inject.mjs`**: Add `ensureTable(dbPath, table, execFileSync)` helper that runs `CREATE TABLE IF NOT EXISTS` using exact DDL from `visible_repo.rs` (annotations, quotes, dictionary_entries, dictionary_occurrences). Call at `injectRows` start.
2. **`dev-sync-fixture.mjs`**: Wrap each `injectRows` call with `const result = injectRows(...); if (!result.ok) return {ok: false, error: result.error}`. Remove `selected_text` from annotation row. Remove `comment` from quote row. Fix CLI `console.log` to use `result.ok`.
3. **Tests**: Verify existing 10 fixture tests still pass.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `scripts/sync-dev-inject.mjs` | Modified | Add `ensureTable` DDL helper |
| `scripts/dev-sync-fixture.mjs` | Modified | Error checks, column fixes, CLI fix |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DDL schema drifts from Tauri | Low | Mirror `visible_repo.rs` exactly; comment source ref |
| Break existing tests | Low | Run all 10 fixture tests post-fix |

## Rollback Plan

Revert `scripts/sync-dev-inject.mjs` and `scripts/dev-sync-fixture.mjs`. No migrations or schema changes involved.

## Dependencies

None — dev-only tooling.

## Success Criteria

- [ ] `injectDictionary` returns `{ok: false, error}` when `injectRows` fails
- [ ] `injectAnnotation` succeeds on empty DB (no `selected_text` column)
- [ ] `injectQuote` succeeds on empty DB (no `comment` column)
- [ ] Fixture auto-creates tables on first insert into empty DB
- [ ] All existing fixture tests pass
- [ ] Caso 3 harness can inject test data without silent failures
