# Design: Fix Caso 3 Dictionary Sync Android Receive

## Technical Approach

Extend `apps/readest-app/scripts/sync-execute.mjs` only. Before the existing `/books/*` sync, read desktop `Readest/dictionary.db`, convert visible rows into `ReplicaRow` JSON, and PUT them to Android replica endpoints. Keep the existing top-level `{ ok, sent, received }` book evidence, but add nested `replicas` evidence so the harness can prove dictionary transport happened.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Collection point | Read `join(env.desktop.dataRoot, 'Readest', 'dictionary.db')` inside `sync-execute.mjs` with the existing `sqlite3 -json` CLI pattern. | Browser `runSyncCycle`; large shared sync refactor. | Minimal harness-facing fix; avoids polling/window dependency and follows existing dev scripts. |
| Endpoint mapping | `dictionary_entries` → `/replicas/dictionary-entry`; `dictionary_occurrences` → `/replicas/dictionary-occurrence`. | Send both kinds to one endpoint; include annotation/quote in this fix. | Matches Android server kind routing and keeps scope to Caso 3 dictionary rows. |
| Payload shape | Emit `ReplicaRow[]` with `kind`, `replica_id`, `fields_jsonb`, `manifest_jsonb: null`, `deleted_at_ts`, `updated_at_ts`, `schema_version: 1`. Field keys use app/Rust camelCase: entries `term`, `displayTerm`, `language`, `definition`, `imagePath`, `curiosity`, `enrichmentStatus`; occurrences `entryId`, `bookHash`, `bookTitle`, `bookAuthor`, `cfi`, `sectionHref`, `page`, `selectedText`, `contextBefore`, `contextAfter`, `highlightNoteId`. | Reuse TS `createReplicaRow` via path aliases. | Node script is plain `.mjs`; direct mapping is smaller and testable. HLC should match Rust visible seed format: `{13-hex-ms}-00000001-visible`. |
| Failure semantics | Any non-2xx replica PUT, invalid JSON response, or thrown fetch error makes the script print `{ ok:false, error, sent, received, replicas }` and exit non-zero. | Best-effort warning while book sync passes. | A green sync with missing dictionary rows is the bug; failures must be visible. |

## Data Flow

```text
desktop Readest/dictionary.db
  ├─ dictionary_entries      ── map fields ── PUT /replicas/dictionary-entry
  └─ dictionary_occurrences  ── map fields ── PUT /replicas/dictionary-occurrence
                                                     │
existing sync-execute book flow remains unchanged ───┘
```

Rows with missing `dictionary.db` or missing tables produce zero replica attempts, not failure. Rows with `deleted_at` become tombstones via `deleted_at_ts`; occurrence HLC uses `created_at`, entry HLC uses `updated_at || created_at`, matching Rust seed logic.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/sync-execute.mjs` | Modify | Add dictionary SQLite collector, table-to-kind mapper, replica PUT helper, nested evidence, and fail-fast result handling. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | Add Strict-TDD tests that run the script against a temp dictionary DB and fake Android HTTP server. |
| `apps/readest-app/src/app/api/sync-trigger/route.ts` | No planned change | Existing parsing already propagates `ok:false`; only touch if tests prove nested evidence is hidden. |

## Interfaces / Contracts

Result shape:

```json
{
  "ok": true,
  "sent": 1,
  "received": 0,
  "replicas": {
    "dictionary-entry": { "attempted": 1, "applied": 1, "endpoint": "/replicas/dictionary-entry" },
    "dictionary-occurrence": { "attempted": 1, "applied": 1, "endpoint": "/replicas/dictionary-occurrence" }
  },
  "evidence": { "path": "syncResult.replicas" }
}
```

Use Android response count when available (`applied`, `count`, or `pushed`); otherwise count a successful PUT as the attempted row count.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Script integration | PUT calls to both dictionary endpoints with expected `fields_jsonb` keys and replica IDs. | Add failing Vitest case in `devSyncHarness.test.ts`; create temp `Readest/dictionary.db` via `sqlite3`, fake `/books/manifest` and `/replicas/*`. |
| Evidence | Preserve book `sent/received`; expose `replicas.dictionary-entry/occurrence.attempted/applied`. | Assert final stdout JSON. |
| Error handling | Replica PUT 500 causes non-zero exit and clear error/evidence. | Fake server returns 500 for one endpoint; assert failure JSON/stderr behavior through spawned Node. |
| Harness | Real Caso 3 rerun. | After unit tests pass, rerun the existing real-device harness scenario; no build. |

## Migration / Rollout

No migration required. This changes only the dev sync harness execution path.

## Open Questions

None.
