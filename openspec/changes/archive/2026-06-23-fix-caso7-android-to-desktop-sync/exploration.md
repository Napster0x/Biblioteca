## Exploration: fix-caso7-android-to-desktop-sync

### Current State
`scripts/dev-sync-trigger.mjs` advertises `direction: 'bidirectional-local-usb'`, but the actual executor is `scripts/sync-execute.mjs`. That executor currently reads desktop SQLite DBs, converts visible rows into ReplicaRow arrays, and PUTs them to Android `/replicas/{kind}` for `dictionary-entry`, `dictionary-occurrence`, `quote`, and `annotation`. It then performs a shallow book/library comparison. It does not GET Android `/replicas/{kind}` nor apply pulled ReplicaRows into the desktop SQLite DBs, so Android-only D rows never reach desktop.

Desktop fixture injection writes directly to visible SQLite tables via `scripts/sync-dev-inject.mjs` / `scripts/dev-sync-fixture.mjs`:
- `Readest/dictionary.db`: `dictionary_entries`, `dictionary_occurrences`
- `Readest/citas.db`: `quotes`
- `Readest/annotations.db`: `annotations`

Android `/replicas/*` is served by `src-tauri/src/local_sync_server.rs`, backed by `src-tauri/src/visible_repo.rs`. GET calls `VisibleRepository.pull(kind, since)` and returns a raw `ReplicaRow[]`; PUT calls `VisibleRepository.push(kind, rows)` and writes both `_replicas` metadata and visible application tables using HLC gates and semantic identity rules.

### Affected Areas
- `apps/readest-app/scripts/sync-execute.mjs` — surgical target: add Android→Desktop GET/apply after or alongside existing desktop→Android PUTs.
- `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` — focused failing unit tests should cover pulling Android ReplicaRows and idempotent re-application into desktop DBs.
- `apps/readest-app/scripts/sync-dev-inject.mjs` — useful schema reference for desktop table creation; avoid changing unless tests expose a missing column mismatch.
- `apps/readest-app/src-tauri/src/visible_repo.rs` — reference implementation for ReplicaRow→table mapping, HLC gate, tombstone behavior, and semantic dedupe; product Rust changes are not needed for this bug.
- `apps/readest-app/scripts/sync-dev-state.mjs` — confirms Android replica API responses may be either `ReplicaRow[]` or `{ rows: [...] }` in inspection tooling; actual server returns `ReplicaRow[]`.

### Approaches
1. **Surgical pull/apply inside `sync-execute.mjs`** — Add small helpers to GET each Android `/replicas/{kind}`, validate/filter ReplicaRow-like objects, and upsert into the matching desktop SQLite tables plus `_replicas`.
   - Pros: Minimal scope, fixes the failing executor directly, no sync architecture redraw, easy focused tests with a mock HTTP server and temp SQLite DBs.
   - Cons: Duplicates a subset of `visible_repo.rs` mapping logic in JavaScript; must be disciplined to keep only the four required kinds.
   - Effort: Medium

2. **Route `sync-execute.mjs` through the app's TypeScript sync stores** — Reuse `runSyncCycle` semantics instead of direct SQLite writes.
   - Pros: Less mapping duplication in theory.
   - Cons: Not practical for this Node harness path: depends on app stores/environment services, increases runtime coupling, and risks broad redesign.
   - Effort: High

3. **Move bidirectional sync into Rust/Android server responsibilities** — Make Android push back or otherwise orchestrate desktop writes.
   - Pros: Could centralize CRDT logic long term.
   - Cons: Wrong layer for the immediate data loss; requires broader architecture and real-device behavior changes.
   - Effort: High

### Recommendation
Use Approach 1. Add only the missing Android→Desktop leg to `sync-execute.mjs`: for each of `dictionary-entry`, `dictionary-occurrence`, `quote`, and `annotation`, `GET ${baseUrl}/replicas/{kind}`, then apply returned ReplicaRows to the desktop DB that already backs fixture state. Preserve existing Desktop→Android PUTs exactly.

Implementation shape for the next phase:
1. Test first in `devSyncHarness.test.ts` with a temp desktop root containing `L` only and a mock Android server returning ReplicaRows for D. Assert `sync-execute.mjs` exits ok and desktop tables contain D after execution.
2. Add a second idempotence test: run/apply the same pulled rows twice or return rows that already exist locally; assert row counts remain stable and no duplicate logical quote/annotation/dictionary rows are created.
3. In `sync-execute.mjs`, add helpers:
   - `getReplicas(baseUrl, kind, endpoint)` accepting actual `ReplicaRow[]` and optionally `{ rows: ReplicaRow[] }` for harness tolerance.
   - `ensureReplicasTable(dbPath)` with the existing `_replicas` schema from migrations.
   - `applyReplicaRowsToDesktop(kind, rows, dbPath)` with `INSERT OR REPLACE` / `ON CONFLICT(id) DO UPDATE` style writes gated by `_replicas.updated_at_ts` so equal/older rows are skipped.
4. Map fields using the existing field names already emitted by desktop→Android conversion:
   - `dictionary-entry` → `dictionary_entries`: `term`, `displayTerm`, `language`, `definition`, `imagePath`, `curiosity`, `enrichmentStatus`, timestamps/deleted.
   - `dictionary-occurrence` → `dictionary_occurrences`: `entryId`, `bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `selectedText`, `contextBefore`, `contextAfter`, `highlightNoteId`, timestamps/deleted.
   - `quote` → `quotes`: `bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `text`, `contextBefore`, `contextAfter`, `contentHash`, timestamps/deleted.
   - `annotation` → `annotations`: `bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `text`, `note`, `style`, `color`, timestamps/deleted.
5. Extend `replicas` evidence rather than replacing it. Current fields mean desktop→Android (`attempted`, `applied`). Add non-breaking pull fields such as `pulled` and `appliedToDesktop` per kind, so Caso 3-6 evidence remains compatible while Caso 7 can prove Android→Desktop convergence.

### Risks
- `sync-execute.mjs` must create missing desktop tables with compatible columns before applying Android rows; otherwise a clean desktop with only L may lack D tables.
- HLC/idempotence must be enforced via `_replicas` before writing visible tables; blind `INSERT OR REPLACE` can regress Caso 8 by duplicating semantic rows or overwriting newer local state.
- Dictionary occurrences can arrive before their dictionary entry. Apply order should be `dictionary-entry` before `dictionary-occurrence`, matching current kind order and avoiding FK/semantic gaps.
- Quote `content_hash` may be required by production schema. If Android rows omit it, preserve null-tolerant harness DDL or compute only if an existing pattern already does; do not invent broad quote semantics in this fix.

### Ready for Proposal
Yes — propose a narrow test-first change in `sync-execute.mjs`: keep Desktop→Android transport, add Android→Desktop pull/apply for the four ReplicaRow kinds, and preserve idempotence with `_replicas` HLC gates.
