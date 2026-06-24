## Exploration: fix-caso8-sync-idempotence

### Current State

The dev sync harness (`sync-execute.mjs`) performs a Desktop↔Android sync via HTTP to the Android local sync server (Rust `local_sync_server.rs` + `visible_repo.rs`). The sync flow runs as a single JS execution:

1. **Push phase**: Read ALL rows from Desktop SQLite dbs (`dictionary_entries`, `dictionary_occurrences`, `quotes`, `annotations`) via `SELECT *`, convert each to `ReplicaRow` via `rowToReplica()`, and PUT all to Android `/replicas/:kind` endpoints.
2. **Pull phase**: GET all replicas from Android `/replicas/:kind`, apply to Desktop via `upsertReplicaRow()` which checks Desktop `_replicas` via `newerOrEqualReplicaExists()`.

**Caso 8 (Idempotence) failure evidence**:
- Sync 1: dictionary-entry(1/1/2/2), dictionary-occurrence(1/1/6/3), quote(1/1/5/5), annotation(1/1/1/1)
- Sync 2: dictionary-entry(3/3/2/2), dictionary-occurrence(3/3/6/2), quote(5/5/5/0), annotation(2/2/1/0)
- Format: (attempted/applied/pulled/appliedToDesktop)
- Sync 2 generated 44 total ops across all replicas; expected 0.

### Root Cause Analysis

**Root Cause 1: Desktop push has NO change tracking (primary)**
`sync-execute.mjs` reads ALL rows from all Desktop visible tables and pushes every single one on every sync. There is no "already synced" filter. The Desktop `_replicas` table (created by `ensureDesktopReplicaTables`, populated during the pull phase) is *never read* on the push side. Every sync re-pushes the entire Desktop dataset.

**Root Cause 2: Push-then-pull echo within the same execution**
The push and pull run in one execution. After pushing all Desktop rows to Android, the pull immediately fetches them back. On the first sync, Desktop `_replicas` is empty so everything gets applied. On subsequent syncs, the Desktop `newerOrEqualReplicaExists` guard blocks SOME re-application (quotes and annotations: 0 appliedToDesktop on Sync 2), but NOT all (dictionary-entry: 2 appliedToDesktop on Sync 2 with 3 pushed). The remaining re-applications cause a cascading effect where visible rows on Desktop grow, leading to more pushed rows on later syncs (3 dictionary-entry attempted on Sync 2 vs 1 on Sync 1).

**Root Cause 3: Android `push()` HLC gate may be bypassed by timestamp drift**
Android's `LibsqlVisibleRepo::push()` (visible_repo.rs:1075-1203) has a proper HLC gate (`hlc_gt()`) that skips rows with equal or lower `updated_at_ts`. However, the Desktop repeatedly pushes ALL rows on every sync. If any timestamp differs between syncs (due to the `hlcMillis→toHlc` round-trip, or `Date.now()` fallback, or `upsertVisibleRow` overwriting `updated_at`), the HLC changes and Android's gate lets the row through. The `resolve_semantic_id` remapping can also change the `replica_id` used for the gate check, though this alone does not explain the full scope of the failure.

### Affected Areas

- **`apps/readest-app/scripts/sync-execute.mjs`** — Primary target. The `main()` function (lines 402-513) orchestrates push-then-pull without any push-side change tracking. Fix: add a pre-push filter using the existing `newerOrEqualReplicaExists()` function (line 215) and Desktop `_replicas` table.
  - `rowToReplica()` (line 330): generates `updated_at_ts` from visible row data.
  - `putReplicas()` (line 370): sends all rows without filtering.
  - `ensureDesktopReplicaTables()` (line 175): creates Desktop `_replicas` table (already exists and works).
  - `newerOrEqualReplicaExists()` (line 215): existing guard on PULL side — can be reused for push filtering.

- **`apps/readest-app/src-tauri/src/visible_repo.rs`** — Android-side push/pull logic. Not needing changes, but relevant for verification.
  - `push()` (line 1075): HLC gate, `resolve_semantic_id`, `merge_fields_jsonb`, `sync_to_app_table`. Correct but may receive more data than needed.
  - `seed_replicas_from_visible()` (line 178): idempotent — skips existing `_replicas` rows.
  - `pull()` (line 1061): runs seed then reads from `_replicas`.
  - `make_hlc()` (line 482): generates `{hex-ms}-00000001-visible`; matches JS `toHlc()` format.
  - `hlc_gt()` (line 532): millis→counter→deviceId comparison; correct for equal-timestamp blocking.
  - `sync_to_app_table()` (line 709): writes to visible tables. Note: `dictionary_occurrences` DDL (line 853-859) has NO `updated_at` column (unlike Desktop DDL which includes it).

- **`apps/readest-app/scripts/sync-dev-inject.mjs`** — DDL discrepancy. The `TABLE_DDL.quotes` (line 31) includes `replica_timestamps TEXT` but `sync-execute.mjs`'s `ensureDesktopReplicaTables.quote` (line 190) does NOT. Minor inconsistency; not a functional blocker but should be reconciled.

### Approaches

#### 1. **Surgical: Add push-side `_replicas` filter in `sync-execute.mjs`** (RECOMMENDED)

Add a pre-push filter that checks Desktop `_replicas` before sending each replica to Android. Skip rows that already exist with equal-or-higher `updated_at_ts`.

- **Where**: In `sync-execute.mjs` `main()`, before each `putReplicas()` call.
- **How**: Filter replica arrays using `!newerOrEqualReplicaExists(dbPath, replica.replica_id, replica.updated_at_ts)`.
- **Lines changed**: ~5-8 lines in `main()`, plus a helper like `filterUnchangedReplicas()`.
- **Pros**:
  - Minimal change (~10 lines total).
  - Reuses existing `newerOrEqualReplicaExists()` and Desktop `_replicas` table.
  - No changes to Android side.
  - Preserves Caso 7 (bidirectional) — first sync still pushes everything (Desktop `_replicas` is empty), subsequent syncs only push changes.
- **Cons**:
  - Relies on Desktop `_replicas` being populated from previous pulls. On the very first sync, everything gets pushed (correct bootstrapping behavior).
  - Does not fix timestamp drift between sides — but since push now only sends truly new/changed rows, the HLC comparison is more reliable.
- **Effort**: Low

#### 2. **Phase separation: Capture pre-sync state, push only changes**

Capture Desktop `_replicas` state before the sync begins. Then push only rows whose `updated_at_ts` is newer than the captured state.

- **Pros**: More explicit change detection, less dependent on `_replicas` content.
- **Cons**: More code, adds complexity, introduces a "cursor" concept. Over-engineered for the current scope.
- **Effort**: Medium

#### 3. **Android-side: Use `since` parameter for pull**

Pass a `since` HLC cursor to Android's GET `/replicas/:kind?since={hlc}` to only pull rows newer than the last known state.

- **Pros**: Reduces pull echo. Android `pull()` already supports the `since` parameter.
- **Cons**: Desktop must track the last-seen HLC per kind. Doesn't fix the push-side over-sending. Adds complexity.
- **Effort**: Medium

#### 4. **Push-side `_replicas` write after push**

After pushing rows to Android, write `_replicas` metadata on Desktop for each pushed row. This would populate Desktop `_replicas` even before the pull runs.

- **Pros**: Desktop `_replicas` is populated earlier, making subsequent syncs fully idempotent.
- **Cons**: Dual-purpose `_replicas` writes (both on push and pull). Redundant data.
- **Effort**: Low-Medium (can be combined with Approach 1)

### Recommendation

**Approach 1 (Surgical push-side filter)** is the right fix for this change. It directly addresses the primary root cause: the push sends all rows every time. It uses existing infrastructure (`newerOrEqualReplicaExists`, Desktop `_replicas`), requires minimal code changes, and preserves bidirectional sync.

**Supplementary**: After the push succeeds, call `writeReplicaMetadata()` on Desktop for each pushed replica. This populates Desktop `_replicas` immediately (not waiting for the pull), ensuring the push filter works correctly even if the pull phase fails. This adds ~2 lines in the push loop.

**Implementation sketch**:
```javascript
function filterUnchangedReplicas(dbPath, replicas) {
  return replicas.filter(r => !newerOrEqualReplicaExists(dbPath, r.replica_id, r.updated_at_ts));
}

// In main():
const entryRows = filterUnchangedReplicas(desktopReplicaDbPath(env.desktop.dataRoot, 'dictionary-entry'), dictionaryRows.entries);
await putReplicas(baseUrl, 'dictionary-entry', DICTIONARY_ENTRY_ENDPOINT, entryRows, replicas);
// ... same for other kinds
```

**Verification**: After the fix, Sync 2 should produce `attempted=0, applied=0` for all replicate kinds (assuming no Desktop data changes between syncs). Caso 8 should pass.

### DDL Discrepancy Note

`sync-dev-inject.mjs` `TABLE_DDL.quotes` includes `replica_timestamps TEXT` (line 36), while `sync-execute.mjs` `ensureDesktopReplicaTables.quote` does NOT (line 192-195). This is benign (the `replica_timestamps` column stays NULL when present, or doesn't exist when the inject DDL hasn't run first). Recommend reconciling for consistency — either add the column to the sync-execute DDL or remove it from the inject DDL.

### Risks

- **Deskope `_replicas` may be empty on first sync**: Expected — first sync pushes everything (bootstrapping). The filter only reduces re-pushes on subsequent syncs.
- **`resolve_semantic_id` remapping**: Android may remap the `replica_id` of an incoming row. The Desktop push filter checks against Desktop's `_replicas` (which uses the ORIGINAL `replica_id`). If Android remaps to a different ID, the Desktop still pushes under the original ID. This is fine because: (a) Android remaps on push acceptance, and (b) the Desktop filter only cares about whether THIS Desktop row was already synced.
- **`newerOrEqualReplicaExists` string comparison**: Uses `>=` on HLC strings. HLCs are designed for lexicographic ordering (`hex-ms` + counter + deviceId), so this is correct as long as both sides produce the same HLC format. Both JS `toHlc` and Rust `make_hlc` use `{hex-ms-padded-to-13}-00000001-visible`, ensuring format compatibility.
- **Caso 7 (bidirectional) regression risk**: Low. The push filter only removes rows that Desktop `_replicas` already knows about with same-or-higher HLC. New rows or changed rows (with higher HLC) still get pushed. The pull path is unchanged.

### Ready for Proposal

Yes. The exploration has identified a clear, surgical root cause with a minimal fix path. The orchestrator should proceed to `sdd-propose` with this exploration as input.
