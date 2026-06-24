## Exploration: fix-caso3-dictionary-sync-android-receive

### Current State
`dev-sync-trigger.mjs` posts to `/api/sync-trigger`, and that route increments a counter but also directly executes `scripts/sync-execute.mjs`. The executed script only syncs book library metadata/assets through `/books/*`; it never calls `/replicas/dictionary-entry` or `/replicas/dictionary-occurrence`. That explains the harness evidence: `syncResult.sent=1` is the one book sent, not one dictionary replica, while Android dictionary replicas remain `0` and `dictionary.db` is never created.

Desktop dictionary rows are available: the fixture creates `dictionary_entries` and `dictionary_occurrences` in desktop `Readest/dictionary.db`, and the real app path can collect them via `defaultVisibleSeedProvider`/`DictionaryService.listAllEntries()` and `listAllOccurrences()` inside `runSyncCycle`. Android can receive them if `/replicas/:kind` is called: the Rust local sync server routes PUT to `VisibleRepository::push`, opens `Readest/dictionary.db`, creates `_replicas`, and creates `dictionary_entries`/`dictionary_occurrences` before upserting incoming rows.

Book/library sync is a separate path. `runSyncCycle` performs CRDT replica sync first, then runs `syncUsbBooks`; `sync-execute.mjs` currently implements only the latter in a reduced Node form. Dictionary rows do not require Android `library.json` to create the DB/tables, although occurrences reference `book_hash` semantically and the harness scenario expects the book to converge too.

### Affected Areas
- `apps/readest-app/src/app/api/sync-trigger/route.ts` — production of the harness sync result; currently delegates to `sync-execute.mjs`.
- `apps/readest-app/scripts/sync-execute.mjs` — likely smallest fix location; it must either execute the same replica sync semantics as `runSyncCycle` or explicitly push desktop visible dictionary rows before/alongside book sync.
- `apps/readest-app/src/services/sync/localSyncUtils.ts` — reference implementation for app/browser USB sync; confirms intended order and kind list.
- `apps/readest-app/src/services/sync/visibleSeedRepository.ts` — TypeScript collector for desktop visible dictionary entries/occurrences in the app runtime.
- `apps/readest-app/src-tauri/src/local_sync_server.rs` — Android HTTP receiver; `/replicas/:kind` dispatches to visible repository PUT/GET.
- `apps/readest-app/src-tauri/src/visible_repo.rs` — Android apply path; lazily creates `dictionary.db`, `_replicas`, and dictionary tables when receiving rows.
- `apps/readest-app/scripts/dev-sync-fixture.mjs` and `scripts/sync-dev-inject.mjs` — fixture/injection path confirmed to create realistic desktop dictionary rows.

### Approaches
1. **Teach `sync-execute.mjs` to push replica rows** — add a minimal Node-side desktop SQLite collector for the four `REPLICA_KINDS` and PUT rows to Android `/replicas/:kind`, then keep existing book sync.
   - Pros: smallest harness-facing fix; no browser polling dependency; aligns `/api/sync-trigger` evidence with real applied replicas.
   - Cons: duplicates some mapping logic from `visibleSeedRepository`/`visible_repo.rs`; needs focused tests to prevent schema drift.
   - Effort: Medium

2. **Route `/api/sync-trigger` back to browser DebugSync polling only** — make POST only increment the counter and rely on `DebugSyncTrigger` to call `runSyncCycle` in the app runtime.
   - Pros: reuses existing TypeScript sync implementation.
   - Cons: harness becomes dependent on a mounted browser/webview and polling timing; weaker terminal evidence; current API response would not prove completion.
   - Effort: Medium

3. **Create a shared Node-runnable sync module from `runSyncCycle`** — refactor app sync logic into a module usable by both browser and Node.
   - Pros: best long-term deduplication.
   - Cons: larger scope, bundling/path-alias/runtime-service complexity; not minimal for Caso 3.
   - Effort: High

### Recommendation
Use Approach 1. Add a focused failing Vitest case around `/api/sync-trigger`/`sync-execute.mjs` proving dictionary entry and occurrence rows are PUT to Android `/replicas/dictionary-entry` and `/replicas/dictionary-occurrence`, then implement the smallest Node-side replica collector for desktop SQLite visible tables. Keep book sync as a separate phase in the same script, but report replica sent/received counts distinctly enough that `sent=1` cannot be misread as dictionary transport.

### Risks
- Duplicating row mapping in Node can drift from `visibleSeedRepository` and Rust `visible_repo`; tests should assert field names for dictionary entry and occurrence.
- `sync-execute.mjs` currently reports only `{sent, received}` for books; changing evidence shape may require harness test updates.
- If Android receives occurrence before entry, the current schema has no FK, so it applies, but semantic assertions should still require both kinds.
- The harness evidence path is `syncResult`, not `syncResult.evidence.path`; existing evaluator accepts it through API evidence, but richer evidence would reduce ambiguity.

### Ready for Proposal
Yes — propose a minimal Strict-TDD fix in `sync-execute.mjs`: preserve book sync, add desktop visible replica collection and Android `/replicas/:kind` PUTs for dictionary-entry and dictionary-occurrence at minimum, ideally all four `REPLICA_KINDS` for consistency.
