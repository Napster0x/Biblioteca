# Proposal: Fix Caso 3 Dictionary Sync Android Receive

## Intent

Caso 3 reports book sync success while Android receives no dictionary replicas. `/api/sync-trigger` executes `scripts/sync-execute.mjs`, but that script only syncs `/books/*`; it never PUTs desktop dictionary rows to Android `/replicas/dictionary-entry` or `/replicas/dictionary-occurrence`.

## Scope

### In Scope
- Add minimal dictionary entry/occurrence replica collection from desktop `Readest/dictionary.db` in `sync-execute.mjs`.
- PUT collected rows to Android `/replicas/dictionary-entry` and `/replicas/dictionary-occurrence` before/alongside existing book sync.
- Add focused Strict-TDD coverage proving both replica PUT endpoints are called with expected fields and evidence distinguishes replica counts from book counts.

### Out of Scope
- Broad sync redesign or shared browser/Node sync refactor.
- Android receiver changes; exploration confirms receiver already applies replica PUTs.
- Automatic build/redeploy or unsafe harness orchestration.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: sync trigger evidence and execution MUST include dictionary entry/occurrence replica transport when desktop dictionary rows exist.

## Approach

Use the smallest harness-facing fix: extend `apps/readest-app/scripts/sync-execute.mjs` with Node-side SQLite reads for visible dictionary entries and occurrences, then PUT those payloads to Android replica endpoints. Preserve existing book sync and avoid changing `/api/sync-trigger` semantics except richer nested sync evidence.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Collect and push dictionary replicas; report replica evidence. |
| `apps/readest-app/src/app/api/sync-trigger/route.ts` | Possible | Keep current execution path; only adjust response parsing if evidence shape requires it. |
| `apps/readest-app/src/services/sync/visibleSeedRepository.ts` | Reference | Match dictionary field mapping; no planned production change. |
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Reference | Confirms Android apply path; no planned change. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Node mapping drifts from app/Rust mapping | Medium | Tests assert dictionary entry/occurrence payload field names. |
| Evidence shape breaks harness expectations | Low | Preserve existing book counts; add distinct replica counts. |
| Over-scoping into sync redesign | Medium | Limit changes to `sync-execute.mjs` and focused tests. |

## Rollback Plan

Revert the `sync-execute.mjs` dictionary replica changes and associated tests. Existing book-only sync behavior returns unchanged.

## Dependencies

- Existing desktop fixture dictionary rows in `Readest/dictionary.db`.
- Android `/replicas/:kind` receiver remains reachable.

## Success Criteria

- [ ] Failing test proves `dictionary-entry` and `dictionary-occurrence` PUTs are required.
- [ ] `sync-execute.mjs` sends desktop dictionary rows to both Android replica endpoints.
- [ ] Sync evidence reports dictionary replica transport separately from book sync.
