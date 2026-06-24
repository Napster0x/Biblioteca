# Proposal: Fix Caso 4 Quote Sync Android Receive

## Intent

Caso 4 reports book sync success while Android receives no quote (citas) replicas. `/api/sync-trigger` executes `scripts/sync-execute.mjs`, which currently transports dictionary entries/occurrences but never collects or PUTs desktop quote rows from `Readest/citas.db` to Android `/replicas/quote`. Pattern is identical to the archived Caso 3 dictionary fix (`2026-06-23-fix-caso3-dictionary-sync-android-receive`).

## Scope

### In Scope
- Add minimal quote replica collection from desktop `Readest/citas.db` (`quotes` table) in `sync-execute.mjs`.
- PUT collected rows to Android `/replicas/quote` alongside existing dictionary/book sync.
- Add Strict-TDD coverage proving `quote` PUT is called with expected field envelope.

### Out of Scope
- Broad sync redesign or shared browser/Node sync refactor.
- Android receiver changes; exploration confirms receiver already applies `/replicas/quote` PUT to `quote.json` shadow and visible adapter syncs to `citas.db`.
- Annotation coverage (annotations have their own Caso already passing).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: sync trigger evidence and execution MUST include quote replica transport when desktop quote rows exist.

## Approach

Extend `apps/readest-app/scripts/sync-execute.mjs` with Node-side SQLite read for `quotes` table from `Readest/citas.db`, map columns to replica field names matching Rust `visible_repo.rs` (bookHash, bookTitle, bookAuthor, cfi, sectionHref, page, text, contextBefore, contextAfter, contentHash), and PUT to Android `/replicas/quote`. Add quote to `replicas` evidence alongside existing dictionary-entry/dictionary-occurrence entries. HLC uses `updated_at ?? created_at` fallback, matching Rust seed logic.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Add quote collection, field mapping, PUT transport, and evidence |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Add failing test for `/replicas/quote` PUT assertion |
| `apps/readest-app/src/__tests__/store/citasStore-replica.test.ts` | Reference | Confirms Android receive/merge for quote replicas; no planned change |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Reference | Confirms `quotes` table schema and field mapping; no planned change |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Node field mapping drifts from Rust `visible_repo.rs` seed | Medium | Test asserts expected replica field names and payload shape |
| `citas.db` missing or quotes table absent at sync time | Low | Skip quote sync gracefully; zero attempted counts in evidence |

## Rollback Plan

Revert the `sync-execute.mjs` quote collection/PUT changes and associated test modifications. Existing dictionary and book sync paths are unchanged.

## Dependencies

- Existing desktop fixture quote rows in `Readest/citas.db` (via `--quote` fixture).
- Android `/replicas/quote` PUT receiver remains reachable (confirmed by doctor).

## Success Criteria

- [ ] Failing test proves `/replicas/quote` PUT is required when desktop quotes exist.
- [ ] `sync-execute.mjs` sends desktop `quotes` rows to Android `/replicas/quote`.
- [ ] Sync evidence reports quote replica transport separately from book and dictionary counts.
