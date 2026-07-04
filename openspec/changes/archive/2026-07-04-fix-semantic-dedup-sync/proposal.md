# Proposal: Fix Semantic Dedup Sync

## Intent

Cases 16 and 17 from Phase 3 Light Conflicts failed on real devices because semantic dedup exists in the filter standalone module but is NOT wired into the sync pipeline's push/pull loops. The harness has the logic; the real code path doesn't — a violation of **fidelity of code path** (ideal_harness.md).

## Scope

### In Scope
- Wire `computeSemanticKey()` into pull-side `filterUnchangedReplicas` for all kinds (dict-entry, quote, dict-occurrence, annotation).
- Wire `computeSemanticKey()` into push-side for dict-occurrence, quote, and annotation (dict-entry already works).
- Add `replica_timestamps` column to `quotes` table schema in `ensureReplicaTables()` and DDL in `sync-filter-standalone.mjs`.
- Add failing tests first (per strict TDD) for each dedup gap.

### Out of Scope
- New UI or product changes beyond sync dedup pipelines.
- Phase 4+ conflict resolution or merge UI.
- Reliability matrix runs (cases 15–20 as a whole).

## Capabilities

### New Capabilities
- `semantic-dedup-sync`: semantic dedup integration in sync-execute.mjs push/pull loops for dictionary entries, dictionary occurrences, quotes, and annotations.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: already spec'd in phase3-light-conflicts delta for Cases 16–17; this change implements the missing code path.

## Approach

| Step | Description |
|------|-------------|
| 1. Tests first | Write failing tests in `sync-execute.test.mjs` for each dedup gap: pull-side kind pass-through, push-side occurrence/quote/annotation kind, quote schema migration. |
| 2. Fix schema | Add `replica_timestamps TEXT` to quotes DDL in `sync-filter-standalone.mjs` and handle existing DBs via ALTER TABLE migration. |
| 3. Wire push kinds | Pass kind to `filterUnchangedReplicas` for dict-occurrence, quote, annotation on push (lines 676, 687, 698). |
| 4. Wire pull kinds | Pass kind to `filterUnchangedReplicas` for each kind in the pull loop (line 708). |
| 5. Extend semantic keys | Add quote semantic key computation (bookHash + CFI + contentHash) and dict-occurrence (entry_id + book_hash + cfi) to `computeSemanticKey`. |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-filter-standalone.mjs` | Modified | Add quote DDL migration, extend computeSemanticKey for quotes/occurrences. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Pass kind in all filterUnchangedReplicas calls. |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modified | Add tests for each dedup gap. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Semantic key collisions collapse distinct data | Medium | Key design: bookHash+CFI+contentHash for quotes; entry_id+book_hash+cfi for occurrences. |
| Existing citas.db without replica_timestamps breaks on read | Low | ALTER TABLE migration handles existing DBs; fixture --case17 already confirmed broken. |

## Rollback Plan

Revert sync-execute.mjs and sync-filter-standalone.mjs changes. Existing sync behavior is unchanged — only dedup is added, not modified.

## Dependencies

- Existing delta spec in `openspec/changes/phase3-light-conflicts/specs/sync-crdt-hlc-real-device-harness/spec.md`.

## Success Criteria

- [ ] Pull-side `filterUnchangedReplicas` passes kind for all 4 replica kinds.
- [ ] Push-side passes kind for dict-occurrence, quote, and annotation.
- [ ] Quotes table DDL includes `replica_timestamps`; migration works for existing DBs.
- [ ] Cases 16 and 17 pass on real devices (1 logical entry per semantic identity).
