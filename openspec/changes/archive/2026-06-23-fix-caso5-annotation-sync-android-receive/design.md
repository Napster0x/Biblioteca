# Design: Fix Caso 5 Annotation Sync Android Receive

## Technical Approach

Extend `sync-execute.mjs` only — same single-script pattern as archived Caso 3 (dictionary) and Caso 4 (quote). Before existing `/books/*` sync, read desktop `Readest/annotations.db` table `annotations`, map columns to `ReplicaRow[]`, and PUT to Android `/replicas/annotation`. Add `annotation` to `replicas` evidence. HLC uses `updated_at ?? created_at` fallback. All existing functions (`readSqliteJson`, `toHlc`, `replicaTimestamps`, `rowToReplica`, `putReplicas`) are reused without modification.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Collection source | `Readest/annotations.db` table `annotations`, read via `sqlite3 -json` CLI | Browser `runSyncCycle`; shared sync refactor | Minimal; follows existing dictionary/quote pattern; avoids polling/window dependency |
| Endpoint | `/replicas/annotation` (singular, matching `visible_repo.rs` kind `"annotation"` and `local_sync_server.rs` route) | `/replicas/annotations` (plural) | Rust `local_sync_server` routes by kind name; kind is `"annotation"` everywhere |
| Field mapping | Rust-visible camelCase: `bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `text`, `note`, `style`, `color` | Column snake_case as-is; including novel fields like `contextBefore`/`contextAfter` | PUSH contract must match Android `visible_repo.rs push` (lines 746-783); annotations table has no `context_before`/`context_after` columns — those exist only in `quotes` |
| Payload shape | `ReplicaRow[]` with `kind: 'annotation'`, `replica_id: 'annotation:{id}'`, envelope `{v, t, s:'visible'}` | Wrap in `{rows: [...]}` | Android `local_sync_server.rs` deserializes raw `Vec<ReplicaRow>` |
| Graceful absence | Missing `annotations.db` or empty `annotations` table → `attempted: 0, applied: 0` | Fail the sync | Same as dictionary/quote patterns |
| Failure semantics | Any non-2xx PUT or invalid JSON → `{ok:false, error, ...}` and non-zero exit | Best-effort warning | Green sync with missing annotation rows is the bug; failures must be visible |

## Data Flow

```text
desktop Readest/annotations.db ── annotations table ── map fields ── PUT /replicas/annotation ── NEW
desktop Readest/citas.db       ── quotes table       ── map fields ── PUT /replicas/quote       ── (existing)
desktop Readest/dictionary.db  ── entries/occurrences ── map fields ── PUT /replicas/dictionary-* ── (existing)
existing sync-execute book flow remains unchanged ────────────────────────────────────────────────── (existing)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Add `ANNOTATION_ENDPOINT`, `ANNOTATION_FIELDS` map, `readAnnotationRows()`, `annotation` key in `emptyReplicaEvidence()`, and `putReplicas('annotation', ...)` call in `main()` |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | Add 3 Strict-TDD tests: PUT to `/replicas/annotation` with expected shape; absent-DB zero counts; replica PUT 400 failure |

## Interfaces / Contracts

### ANNOTATION_FIELDS mapping (column → replica field)

```
id              → (replica_id prefix only, via rowToReplica)
book_hash       → bookHash
book_title      → bookTitle
book_author     → bookAuthor
cfi             → cfi
section_href    → sectionHref
page            → page
text            → text
note            → note
style           → style
color           → color
created_at      → (HLC fallback)
updated_at      → (HLC primary)
deleted_at      → (tombstone via deleted_at_ts)
replica_timestamps → (per-field timestamps JSON)
```

### Result shape (added `annotation` to replicas evidence)

```json
{
  "ok": true, "sent": 1, "received": 0,
  "replicas": {
    "dictionary-entry": { "attempted": 1, "applied": 1, "endpoint": "/replicas/dictionary-entry" },
    "dictionary-occurrence": { "attempted": 1, "applied": 1, "endpoint": "/replicas/dictionary-occurrence" },
    "quote": { "attempted": 1, "applied": 1, "endpoint": "/replicas/quote" },
    "annotation": { "attempted": 1, "applied": 1, "endpoint": "/replicas/annotation", "failures": [] }
  },
  "evidence": { "path": "syncResult.replicas" }
}
```

### Test fixture DDL

```sql
CREATE TABLE annotations (
  id TEXT PRIMARY KEY, book_hash TEXT, book_title TEXT, book_author TEXT,
  cfi TEXT, section_href TEXT, page INTEGER, text TEXT, note TEXT DEFAULT '',
  style TEXT DEFAULT 'highlight', color TEXT DEFAULT 'yellow',
  created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, replica_timestamps TEXT
);
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Script integration | PUT to `/replicas/annotation` with expected `fields_jsonb` keys (`bookHash`, …, `color`), `replica_id: 'annotation:{id}'` prefix, and envelope shape | Add failing Vitest case in `devSyncHarness.test.ts`; create temp `Readest/annotations.db`, fake HTTP server for `PUT /replicas/annotation` |
| Evidence | Preserve book/dictionary/quote evidence; add `replicas.annotation.{attempted,applied,endpoint}` to stdout JSON | Assert final stdout JSON contains `annotation` key with correct shape |
| Graceful absence | Missing `annotations.db` → `annotation.attempted: 0` without breaking book/dictionary/quote sync | Fake server; no annotations.db on disk |
| Error handling | Replica PUT 400 with body diagnostics → non-zero exit, error contains `annotation`, failures array shows status + body | Fake server returns 400 for `/replicas/annotation` |

## Migration / Rollout

No migration required. Changes only the dev sync harness execution path.

## Open Questions

None — proposal and Rust `visible_repo.rs` (lines 720-783) fully define the field contract. The annotations table has no `context_before`/`context_after` columns (those are quote-specific); the field map must match what `visible_repo.rs push` accepts.
