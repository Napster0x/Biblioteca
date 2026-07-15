## Exploration: fix-phase2-book-tombstone-reimport-mirror

### Current State
Phase 2 rerun leaves 4 real failures: `13a` desktop same-hash reimport after tombstone does not resurrect Android (`gone=true, back=false`), and `10Ma`/`10Mb`/`10Mc` Android-originated book delete does not become a desktop tombstone (`book.deletedAt=undefined`) while semantic D/C/N rows survive.

Desktop prepare imports EPUBs through `importEpubToLibrary()`. It computes the partial MD5, then skips any existing `library.json` entry with the same hash. That skip does not distinguish live entries from tombstones, so a same-hash reimport after desktop delete never creates a newer live entry for sync.

Sync execution pulls Android active books from `/books/manifest`, which intentionally omits tombstones. Android `/books/delete` writes tombstones to `/books/index`, and `/books/index` GET exposes them, but `sync-execute.mjs` does not read or merge that index into desktop `library.json`. Because `remoteBooks` is built from manifest only, desktop can miss Android tombstones and may treat the book as absent/active instead of deleted.

### Affected Areas
- `apps/readest-app/scripts/prepare-engine.mjs` — same-hash import skip must allow tombstoned entries to be resurrected as newer live imports.
- `apps/readest-app/scripts/sync-execute.mjs` — must pull Android `/books/index` tombstones and apply them to desktop library before push/reconciliation.
- `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` — focused tests for remote tombstone merge and push ordering.
- `apps/readest-app/scripts/__tests__/prepare-engine*.test.mjs` or new focused test — import-after-tombstone behavior.
- `apps/readest-app/src-tauri/src/local_sync_server.rs` — already supports `/books/delete`, `/books/index`, tombstone preservation, and live reimport rules; likely no Rust production change needed.

### Approaches
1. **Minimal harness repair** — update prepare import resurrection and desktop sync’s remote tombstone merge.
   - Pros: directly targets 4 failures; preserves D/C/N replicas; no Android capability expansion; testable with Node unit tests and existing Rust contracts.
   - Cons: sync-execute receives another book-index merge step; timestamp comparison must be careful across number/string values.
   - Effort: Medium

2. **Treat book library as a full CRDT replica kind** — model books in replica tables/HLC path.
   - Pros: conceptually uniform with dictionary/quote/annotation.
   - Cons: broad production redesign; exceeds scope; risks breaking Phase 2 harness and app storage semantics.
   - Effort: High

3. **Change Android manifest to include tombstones** — make `/books/manifest` return deleted entries too.
   - Pros: fewer desktop HTTP calls.
   - Cons: violates current manifest contract: active asset manifest omits tombstones while `/books/index` exposes tombstone evidence.
   - Effort: Medium

### Recommendation
Use Approach 1. Make desktop same-hash reimport after tombstone an explicit resurrection by replacing/updating the tombstoned `library.json` entry with a live entry whose creation/update timestamp is newer than `deletedAt`, while retaining the existing skip for live same-hash imports. In sync execution, fetch Android `/books/index`, merge newer remote tombstones into desktop `library.json` before `pushBooks()`, and keep D/C/N data untouched because it lives in separate replica/SQLite paths.

### Risks
- Mixed timestamp shapes (`number` from tombstone/delete paths, ISO strings from prepare import) can produce wrong ordering unless normalized with `Date.parse`/numeric handling.
- Applying remote tombstones after pushing local live books would resurrect deleted books; merge must happen before push decisions.
- Existing local newer live reimport must be allowed to win over older remote tombstone, matching Rust’s `createdAt > deletedAt` reimport rule.

### Ready for Proposal
Yes — propose a minimal bugfix scoped to prepare resurrection and sync-execute remote book tombstone merge, with focused tests first and no build/commit.
