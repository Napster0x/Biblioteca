# Proposal: Fix Caso 5 Annotation Sync Android Receive

## Intent

Caso 5 (`L + H_N → N + T_N | ∅ → todo en ambos`) expects annotation convergence after sync. `/api/sync-trigger` executes `sync-execute.mjs`, which currently transports dictionary entries/occurrences and quotes but never collects or PUTs desktop annotation rows from `Readest/annotations.db` to Android `/replicas/annotation`. Pattern is identical to archived Caso 3 (dictionary) and Caso 4 (quotes).

## Scope

### In Scope
- Add annotation replica collection from desktop `Readest/annotations.db` in `sync-execute.mjs`.
- PUT collected rows to Android `/replicas/annotation` alongside existing dictionary/quote/book sync.
- Add `annotation` to `replicas` evidence with distinct `attempted`/`applied` counts.
- Add Strict-TDD coverage proving `/replicas/annotation` PUT is called with expected field envelope.

### Out of Scope
- Broad sync redesign or shared browser/Node sync refactor.
- Android receiver changes; Rust `visible_repo.rs` already applies `/replicas/annotation` PUT to `annotations.db`.
- Build/redeploy or unsafe harness orchestration.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: sync trigger evidence and execution MUST include annotation replica transport when desktop annotation rows exist, and evidence MUST distinguish annotation counts from book/dictionary/quote counts.

## Approach

Extend `sync-execute.mjs` with Node-side SQLite read for `annotations` table from `Readest/annotations.db`, map columns to replica field names matching Rust `visible_repo.rs` (bookHash, bookTitle, bookAuthor, cfi, sectionHref, page, text, note, style, color), and PUT to Android `/replicas/annotation`. Add `annotation` to `replicas` evidence alongside existing dictionary/quote entries. HLC uses `updated_at ?? created_at` fallback, matching the existing pattern.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Add `ANNOTATION_FIELDS`, `readAnnotationRows()`, annotation collection in `main()`, and `annotation` evidence entry |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Add failing test for `/replicas/annotation` PUT assertion |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Reference | Confirms `annotations` table schema and field mapping (lines 719-784) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Node field mapping drifts from Rust seed | Medium | Test asserts expected replica field names and payload shape |
| `annotations.db` missing at sync time | Low | Skip annotation sync gracefully; zero attempted counts in evidence |

## Rollback Plan

Revert the `sync-execute.mjs` annotation collection/PUT changes and associated test modifications. Existing dictionary, quote, and book sync paths are unchanged.

## Dependencies

- Existing desktop fixture annotation rows in `Readest/annotations.db` (via `--note` fixture).
- Android `/replicas/annotation` PUT receiver remains reachable (confirmed by `local_sync_server.rs` and doctor).

## Success Criteria

- [ ] Failing test proves `/replicas/annotation` PUT is required when desktop annotations exist.
- [ ] `sync-execute.mjs` sends desktop `annotations` rows to Android `/replicas/annotation`.
- [ ] Sync evidence reports annotation replica transport separately from book, dictionary, and quote counts.
