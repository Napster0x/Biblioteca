# Design: Fix Caso 4 Quote Sync Android Receive

## Technical Approach

Extend `apps/readest-app/scripts/sync-execute.mjs` only — same single-script pattern as the archived Caso 3 dictionary fix. Before the existing `/books/*` sync, read desktop `Readest/citas.db` table `quotes`, map columns to `ReplicaRow[]` JSON, and PUT to Android `/replicas/quote`. Add `quote` to the existing `replicas` evidence object alongside `dictionary-entry` and `dictionary-occurrence`. HLC timestamps use `updated_at ?? created_at` fallback, matching Rust `visible_repo.rs` seed logic.

The fix is minimal: `sync-execute.mjs` already has `readSqliteJson`, `toHlc`, `replicaTimestamps`, `rowToReplica`, and `putReplicas` — all reusable. Only the quote-specific field map, endpoint constant, and evidence entry are new.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Collection point | `join(env.desktop.dataRoot, 'Readest', 'citas.db')` inside `sync-execute.mjs` with existing `sqlite3 -json` CLI. | Browser `runSyncCycle`; shared sync refactor. | Minimal; follows existing dictionary pattern; avoids polling/window dependency. |
| Endpoint | `/replicas/quote` (singular, matching `REPLICA_KINDS` and `visible_repo.rs` kind `"quote"`). | `/replicas/quotes` (plural). | Rust local_sync_server routes by kind name; kind is `"quote"` everywhere. |
| Field mapping | Use Rust-visible camelCase keys: `bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `text`, `contextBefore`, `contextAfter`, `contentHash`. | Column snake_case as-is. | Put contract must match what Android `visible_repo.rs push` expects; mismatch causes 400. |
| Payload shape | Emit `ReplicaRow[]` with `user_id: 'visible'`, `kind: 'quote'`, `replica_id: 'quote:{id}'`, `fields_jsonb` envelope `{v, t, s:'visible'}`, `manifest_jsonb: null`, `deleted_at_ts`, `updated_at_ts`, `reincarnation: null`, `schema_version: 1`. | Wrap in `{rows: [...]}`. | Android `local_sync_server.rs` deserializes raw `Vec<ReplicaRow>`; dictionary 400 fix already confirmed this. |
| Failure semantics | Any non-2xx PUT, invalid JSON response, or fetch throw makes script print `{ok:false, error, sent, received, replicas}` and exit non-zero. | Best-effort warning. | A green sync with missing quote rows is the bug; failures must be visible. |
| Graceful absence | Missing `citas.db` or empty/missing `quotes` table → `attempted: 0, applied: 0`. No error. | Fail the sync. | Same as dictionary pattern: don't punish users without quote data. |

## Data Flow

```text
desktop Readest/citas.db ── quotes table ── map fields ── PUT /replicas/quote
                                                               │
desktop Readest/dictionary.db ── entries / occurrences ───────┼──── (existing)
                                                               │
existing sync-execute book flow remains unchanged ────────────┘
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Add `QUOTE_ENDPOINT`, `QUOTE_FIELDS` map, `readQuotesRows()`, quote key in `emptyReplicaEvidence()`, and `putReplicas('quote', ...)` call in `main()`. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | Add 3 Strict-TDD tests: PUT to `/replicas/quote` with expected shape, absent-DB zero counts, and replica PUT 400 failure. |

## Interfaces / Contracts

### ReplicaRow (same envelope as dictionary)

```json
{
  "user_id": "visible",
  "kind": "quote",
  "replica_id": "quote:{id}",
  "fields_jsonb": {
    "bookHash":   {"v": "hash",  "t": "0019...visible", "s": "visible"},
    "bookTitle":  {"v": "Title", "t": "0019...visible", "s": "visible"},
    "bookAuthor": {"v": "Author","t": "0019...visible", "s": "visible"},
    "cfi":          {"v": "/6/4",  "t": "...", "s": "visible"},
    "sectionHref":  {"v": "ch.xhtml","t":"...", "s": "visible"},
    "page":         {"v": 12,     "t": "...", "s": "visible"},
    "text":         {"v": "quote","t": "...", "s": "visible"},
    "contextBefore":{"v": "before","t":"...", "s": "visible"},
    "contextAfter": {"v": "after", "t": "...", "s": "visible"},
    "contentHash":  {"v": "h",    "t": "...", "s": "visible"}
  },
  "manifest_jsonb": null,
  "deleted_at_ts": null,
  "reincarnation": null,
  "updated_at_ts": "0019...visible",
  "schema_version": 1
}
```

### Result shape (added `quote` to replicas evidence)

```json
{
  "ok": true,
  "sent": 1,
  "received": 0,
  "replicas": {
    "dictionary-entry":     { "attempted": 1, "applied": 1, "endpoint": "/replicas/dictionary-entry" },
    "dictionary-occurrence":{ "attempted": 1, "applied": 1, "endpoint": "/replicas/dictionary-occurrence" },
    "quote":                { "attempted": 1, "applied": 1, "endpoint": "/replicas/quote", "failures": [] }
  },
  "evidence": { "path": "syncResult.replicas" }
}
```

### QUOTE_FIELDS mapping (column → replica field)

```
id              → (replica_id prefix only)
book_hash       → bookHash
book_title      → bookTitle
book_author     → bookAuthor
cfi             → cfi
section_href    → sectionHref
page            → page
text            → text
context_before  → contextBefore
context_after   → contextAfter
content_hash    → contentHash
created_at      → (HLC fallback)
updated_at      → (HLC primary)
deleted_at      → (tombstone via deleted_at_ts)
replica_timestamps → (per-field timestamps JSON)
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Script integration | PUT to `/replicas/quote` with expected `fields_jsonb` keys, `replica_id` prefix, and envelope shape. | Add failing Vitest case in `devSyncHarness.test.ts`; create temp `Readest/citas.db` via `sqlite3`, fake `/books/manifest`, `/books/index`, and `/replicas/*`. |
| Evidence | Preserve book `sent/received` and dictionary evidence; add `replicas.quote.{attempted,applied,endpoint}`. | Assert final stdout JSON. |
| Graceful absence | Missing `citas.db` → `quote.attempted: 0` without breaking book/dictionary sync. | Fake server; no citas.db on disk. |
| Error handling | Replica PUT 400 with body diagnostics → non-zero exit, error contains `quote`, failures array shows status + body. | Fake server returns 400 for `/replicas/quote` with diagnostic body. |

## Migration / Rollout

No migration required. This changes only the dev sync harness execution path.

## Open Questions

None.
