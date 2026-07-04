# Proposal: Fix Phase 2 Sync Failures

## Intent

Resolve the Phase 2 real-device sync failures that block reliable desktop↔Android convergence for book deletion and dictionary definition edits. The rerun shows 5 PASS / 6 FAIL / 3 WARN; this change targets only the P0/P1 failures needed to unblock Phase 2 mirror confidence.

## Scope

### In Scope
- Fix Android book delete support: add the missing `/books/delete` endpoint or correct the harness route if the intended endpoint differs.
- Ensure desktop book tombstones/deletes propagate to Android and remove/tombstone the Android manifest entry while preserving collected data.
- Fix `dictionary_entries.definition` propagation from desktop to Android, including HLC/per-field merge behavior.

### Out of Scope
- BookNote/cruz-roja semantic delete runner work; it remains the final pending harness tool.
- Production sync redesign, UI automation, builds, redeploys, or unrelated Phase 2 warnings.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: tighten Phase 2 expectations for book tombstone propagation, Android delete endpoint coverage, and desktop→Android dictionary definition convergence.

## Approach

Options:
- Add/fix Android `/books/delete`: lowest-risk if harness contract is correct; validates delete-book mirror cases directly.
- Route harness delete-book through `/books/index` tombstones: smaller API surface but keeps route mismatch hidden.
- Patch dictionary sync only: insufficient because P0 delete mirrors stay blocked.

Chosen: fix the contract at the source. Add or correct the Android book delete route, ensure desktop tombstones are pushed through book sync, and repair dictionary-entry merge/serialization so newer desktop `definition` values win on Android.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/src-tauri/src/local_sync_server.rs` | Modified | Android local sync routes, book index/delete handling, merge tests. |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Modified | Dictionary-entry visible row / replica merge if definition HLC is dropped or stale. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Desktop→Android tombstone push and dictionary replica evidence. |
| `apps/readest-app/scripts/sync-dev-inject-http.mjs` | Modified | Delete-book HTTP client contract if route changes. |
| `apps/readest-app/scripts/__tests__/*.test.mjs`, `src/__tests__/services/sync/*.test.ts` | Modified | Focused `node:test`/sync harness regression coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Deletion removes data instead of tombstoning | Med | Test preserved dictionary/quote/annotation data after book delete. |
| HLC merge regression | Med | Add older/newer definition tests both directions. |
| Real-device state flake | Med | Verify with focused unit tests before Phase 2 rerun. |

## Rollback Plan

Revert the changed route/merge/sync files and tests. If only real-device verification fails, keep unit tests and revert implementation slice-by-slice.

## Dependencies

- Real Android device/dev server reachable for final Phase 2 rerun.

## Success Criteria

- [ ] Focused tests fail first, then pass for delete endpoint, tombstone propagation, and dictionary definition merge.
- [ ] Real Phase 2 rerun clears P0/P1 failures: 9a, 10a, 10b, 11b, 12a, 12b.
- [ ] P2 BookNote runner remains explicitly pending.
