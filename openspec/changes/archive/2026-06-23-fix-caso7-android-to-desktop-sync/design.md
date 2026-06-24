# Design: Fix Caso 7 Android-to-Desktop Replica Sync

## Technical Approach

Add the missing Android→Desktop leg inside `apps/readest-app/scripts/sync-execute.mjs` only. The script already pushes desktop visible rows to Android `/replicas/*`; after those PUTs, it should GET Android replica rows, normalize `ReplicaRow[] | { rows }`, then apply newer rows into the desktop SQLite visible tables and each DB's `_replicas` table. No Rust, app-store, or sync architecture changes.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Scope | Keep logic in `sync-execute.mjs` | Move through TS stores or Rust server | The bug is in the dev executor path; surgical Node helpers avoid a broad redesign and preserve Desktop→Android behavior. |
| Apply gate | Skip when existing `_replicas.updated_at_ts >= incoming.updated_at_ts` | Blind `INSERT OR REPLACE` | Strict HLC gate preserves Caso 8 idempotence and avoids stale Android rows overwriting newer desktop state. |
| Visible writes | Upsert by `id` extracted from `replica_id` after `_replicas` gate | Semantic dedupe redesign | Existing `visible_repo.rs` maps ReplicaRows to visible tables by id; duplicating only this subset is the minimum compatible fix. |
| Ordering | Pull/apply `dictionary-entry` before `dictionary-occurrence` | Parallel apply all kinds | Occurrences depend on entries logically; fixed order removes avoidable gaps. |

## Data Flow

```text
desktop SQLite ──existing rowToReplica/PUT──> Android /replicas/{kind}
Android /replicas/{kind} ──new GET──> normalize rows
normalize rows ──HLC gate──> desktop _replicas + visible tables
```

Apply order: `dictionary-entry`, `dictionary-occurrence`, `quote`, `annotation`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Add GET helpers, SQLite DDL/upsert helpers, pull evidence, and apply invocation after current PUTs. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | Add failing unit tests for Android-only rows landing on desktop and HLC/idempotent reapply. |

## Interfaces / Contracts

New helper shapes in `sync-execute.mjs`:

```js
async function getReplicas(baseUrl, kind, endpoint, replicas) // updates pulled/failures
function replicaRowsFromPayload(payload, kind) // accepts ReplicaRow[] or { rows }
function applyReplicaRowsToDesktop(kind, rows, dbPath) // returns applied count
function ensureDesktopReplicaTables(dbPath, kind) // _replicas + visible table DDL
function upsertReplicaRow(dbPath, kind, row) // HLC gate, _replicas, visible upsert
```

Evidence remains backward compatible: keep `attempted`, `applied`, `endpoint`, `failures`; add `pulled` and `appliedToDesktop` per kind.

DDL strategy mirrors `visible_repo.rs` plus existing fixture `replica_timestamps TEXT` where current harness tables use it. `_replicas` schema: `replica_id` PK, `kind`, `user_id`, `fields_jsonb`, `manifest_jsonb`, `deleted_at_ts`, `reincarnation`, `updated_at_ts`, `schema_version`, and index `(kind, updated_at_ts)`.

Visible mapping uses current field maps: `ENTRY_FIELDS`, `OCCURRENCE_FIELDS`, `QUOTE_FIELDS`, `ANNOTATION_FIELDS`. Convert field envelopes via `field.v`; derive `id` by stripping repeated `${kind}:`; derive `created_at`/`updated_at` from `updated_at_ts` using the existing HLC millis pattern. Tombstones set `deleted_at`; live rows clear `deleted_at`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit/script | Caso 7 pull/apply | Mock HTTP server returns Android ReplicaRows for all four kinds; temp desktop root starts without those rows; assert SQLite visible rows and `pulled`/`appliedToDesktop`. |
| Unit/script | Dictionary ordering | Server returns occurrence and entry; assert both visible tables converge with entry applied first. |
| Unit/script | Caso 8 idempotence | Run `sync-execute.mjs` twice or preseed newer `_replicas`; assert row counts stable and older/equal rows skipped. |
| Regression | Desktop→Android | Existing PUT tests keep passing; assertions for `attempted`/`applied` remain unchanged. |

## Migration / Rollout

No migration required. Helpers create missing harness tables idempotently in the desktop dev data root only.

## Open Questions

- [ ] None blocking. Avoid computing missing `contentHash` unless a row already provides it; do not invent quote semantics.
