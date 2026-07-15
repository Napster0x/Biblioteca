# Proposal: fix-phase4-harness-group-c

## Intent

Fix harness bugs discovered during real-device verification (Nothing Phone A065) that produce false negatives in Phase 4 sync tests. These are not CRDT/merge layer bugs — they're harness logic bugs that mask actual failures. Fixing them first eliminates noise before tackling Groups A (merge dedup, book LWW) and B (tombstone propagation).

## Scope

### In Scope
- **Bug 1 (Case 24)**: Add `text` to `resolve_semantic_id` annotation WHERE clause in Rust `visible_repo.rs`
- **Bug 2a (Cases 25/26)**: Replace fabricated `noteId` with the real annotation ID returned by `--note` fixture
- **Bug 2b (Cases 25/26)**: Seed `config.json` on Android before booknote mutation/invalid-ref ops
- Unit tests for all three fixes
- All changes scoped to harness + `visible_repo.rs` — no product sync/merge logic

### Out of Scope
- Group A: merge dedup, book LWW resolution
- Group B: tombstone propagation
- Any other Phase 4 case fixes or enhancements

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: Annotation semantic matching adds `text` field; booknote fixture ops require seeded config.json

## Approach

| Bug | Fix | File(s) | Est. |
|-----|-----|---------|------|
| 1 | Add `AND text = ?4` to `resolve_semantic_id` annotations query | `src-tauri/src/visible_repo.rs:687` | ~3 lines Rust |
| 2a | Use real `annId` from `--note` fixture output instead of fabricated `noteId` | `scripts/dev-sync-cycle.mjs` (setupCase25Ref, setupCase26Ref) | ~10 lines JS |
| 2b | Call `putAndroidBookConfig` to seed config.json before `--booknote-mutate` / `--booknote-invalid-ref` | `scripts/dev-sync-fixture.mjs` (injectBookNoteMutation, injectBookNoteInvalidRef) | ~10 lines JS |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src-tauri/src/visible_repo.rs` | Modified | Add `text` to annotation semantic dedup query |
| `scripts/dev-sync-cycle.mjs` | Modified | Use real `annId` in setupCase25Ref / setupCase26Ref |
| `scripts/dev-sync-fixture.mjs` | Modified | Seed config.json before booknote fixture ops |
| `scripts/__tests__/dev-sync-cycle.test.mjs` | Modified | New tests for fixed Cases 24, 25, 26 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `text` field missing in some replica rows | Low | SQL handles NULL text gracefully; existing annotations always have text |
| config.json seeding interferes with existing booknote data | Low | Seeding is a no-op if config already exists (PUT overwrites with same content) |

## Rollback Plan

Revert the three commits. Each fix is an isolated, single-purpose change with no cross-dependencies. Rollback order: 1 → 2 (order doesn't matter).

## Dependencies

None — harness fixes are independent of merge layer changes.

## Success Criteria

- [ ] Case 24 passes on real device (both annotations propagate in both directions)
- [ ] Cases 25/26 pass on real device (booknote-mutate and booknote-invalid-ref succeed on android-http)
- [ ] All existing Phase 1-4 tests continue to pass
- [ ] Unit tests cover the three fixed paths
