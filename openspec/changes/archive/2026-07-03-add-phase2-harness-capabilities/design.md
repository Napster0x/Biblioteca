# Design: Add Phase 2 Harness Capabilities

## Technical Approach

Extend the existing dev-sync harness, not product sync behavior. Android mutations stay HTTP-first through the current local sync server: `/books/index`, `/books/:hash/book|cover|config`, `/books/manifest`, `/books/delete`, and `/replicas/:kind`. `dev-sync-fixture.mjs` remains the CLI router; `sync-dev-inject-http.mjs` owns Android HTTP helpers; `sync-dev-state.mjs` captures evidence; `dev-sync-cycle.mjs` reports bounded reliability.

## Architecture Decisions

| Decision | Choice | Alternatives / tradeoff | Rationale |
|---|---|---|---|
| Android book metadata edit | Add safe `updateBookViaHttp()` that GETs `/books/index`, merges allowed `books` fields, bumps `updatedAt`, PUTs one preserved entry. | ADB file mutation is direct but less real-device-like; UI automation is slow/flaky. | Matches existing HTTP book-index merge and avoids stale-field loss. |
| Android import/reimport | Reuse `prepare-engine.mjs` hash/metadata extraction, then HTTP PUT book asset + optional `config.json`, then PUT live index entry. | ADB push + manual index mutation bypasses server semantics. | Preserves the real book sync path and existing tombstone/reimport ordering. |
| BookNote/highlight delete | Add high-level semantic delete by `{bookHash, type, id?, cfi?, text?}` that updates `config.json booknotes[]` and tombstones D/C/N replica rows together. | Raw `--delete table:id` is simple but misses BookNote config; product rewrite is out of scope. | Prevents false PASS/FAIL by treating visible note config and semantic rows as one harness action. |
| Reliability runner | Add repeat mode around existing cycle cases with attempt caps, timeout classification, and evidence JSON. | External shell loops are easy but lose structured diagnostics. | Keeps bounded runs reproducible and reviewable. |

## Data Flow

```text
fixture CLI ──→ sync-dev-inject-http ──→ Android local sync server
    │                    │                         │
    │                    └─ book index/assets/config + replicas
    └─ desktop helpers ──→ library.json / SQLite D-C-N

dev-sync-cycle repeat ──→ action + sync + state/assert ──→ evidence report
```

Semantic delete resolves targets before mutation, records before/after state, then applies: BookNote config removal/tombstone plus matching dictionary occurrence, quote, or annotation replica tombstones.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/sync-dev-inject-http.mjs` | Modify | Add `getBooksIndexViaHttp`, `updateBookViaHttp`, `importBookViaHttp`, `get/putBookConfigViaHttp`, semantic config helpers. |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modify | Route `--target android-http --edit books:*`, Android import/reimport, and semantic delete flags; validate safe fields. |
| `apps/readest-app/scripts/prepare-engine.mjs` | Modify | Expose reusable EPUB import descriptor `{hash, fileName, byteSize, metadata, entry}` without desktop write assumptions. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modify | Capture book index entries, per-book `config.json` summaries, and note/highlight semantic evidence. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modify | Add bounded `--repeat N` reliability report with success rate and failure classification. |
| `apps/readest-app/scripts/__tests__/*.test.mjs` | Modify | Add focused harness tests for new helpers and CLI routing. |

## Interfaces / Contracts

```js
updateBookViaHttp(serverUrl, hash, updates, { now })
importBookViaHttp(serverUrl, descriptor, { reimport })
deleteSemanticHighlight({ target, bookHash, type, id, cfi, text, hlcTimestamp })
runRepeat({ caseRef, attempts, minSuccessRate: 0.8, timeoutMs })
```

Book updates accept only existing `EDITABLE_FIELDS.books`. Semantic delete must fail as `ambiguous` when lookup matches zero or multiple semantic groups unless an exact `id` disambiguates.

## Implementation Slices

1. Android book edit helper + tests (`9Ma`).
2. Android import/reimport descriptor + HTTP asset/index helper (`13Ma`).
3. Semantic delete resolver/config mutation/evidence (`14*`, `14M*`).
4. Repeat reliability reporting and case classification.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | HTTP helper merge, timestamp, ambiguity, descriptor generation | Node tests with mocked `fetch` and temp EPUB/config files. |
| CLI integration | `dev-sync-fixture` routes for edit/import/delete | Existing script tests with dependency injection. |
| Real-device harness | `9Ma`, `13Ma`, `14*`, `14M*` definitive outcomes | Bounded repeat (`N>=5`), PASS rate `>=80%`, evidence path per attempt. |

## Migration / Rollout

No migration required. Deliver as stacked work units: book edit, import/reimport, semantic delete, reliability runner.

## Boundaries

- Do not change CRDT/product behavior unless a harness path cannot represent the real state.
- Do not add unbounded waits, builds, or UI automation.
- ADB is diagnostics-only for Android state capture, not the primary mutation path.

## Open Questions

None.
