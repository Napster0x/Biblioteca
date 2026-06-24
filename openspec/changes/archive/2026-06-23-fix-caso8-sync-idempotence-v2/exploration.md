## Exploration: fix-caso8-sync-idempotence-v2

### Current State

The v1 fix (`fix-caso8-sync-idempotence`, archived) added `filterUnchangedReplicas()` to `sync-execute.mjs` to skip already-pushed replicas. It works correctly when `sync-execute.mjs` receives `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` via its environment — all four replica kinds (dict-entry, dict-occurrence, quote, annotation) show `attempted=0, applied=0` on a second sync. The v1 unit tests (direct `spawnNode` with explicit env vars) pass.

However, two issues remain in the **cycle harness** path (`dev-sync-cycle.mjs` → `POST /api/sync-trigger` → spawns `sync-execute.mjs`):

1. **Push filter fails in cycle context**: When `sync-execute.mjs` is spawned by the Next.js API route, `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` is NOT propagated. The route passes `{ ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' }` but `process.env` in the Next.js server process doesn't carry the cycle's dataRoot. `sync-execute.mjs` falls back to the hardcoded `DEFAULT_DESKTOP_DATA_ROOT`, which may point to a different (empty or stale) `_replicas` table — causing the filter to miss entries and re-push.

2. **Pull echo in evidence**: After push, `getReplicas()` pulls ALL replicas back from Android. `pulled` is always non-zero (Android returns everything). `appliedToDesktop` is non-zero for dict-entry when Android's `resolve_semantic_id` remaps the `replica_id` — the Desktop HLC gate in `upsertReplicaRow` checks by `replica_id`, which doesn't match after remapping. Even for dict-occurrence (no semantic remapping), the pull echo makes evidence noisy.

### Root Cause Analysis

#### Issue 1: dataRoot propagation gap

**Call chain**: `dev-sync-cycle.mjs` → `POST /api/sync-trigger` → `route.ts` spawns `sync-execute.mjs`

- `dev-sync-cycle.mjs` sets `stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` (line 301) but only for its own child processes (`spawnStateJson`, `spawnInject`, etc.).
- `triggerSync()` sends an HTTP POST body-less to the Next.js API route (line 57 in route.ts).
- The API route (`src/app/api/sync-trigger/route.ts`, line 60-61) spawns `sync-execute.mjs` with `env: { ...process.env, BIBLIOTECA_DEV_SYNC_HARNESS: '1' }` — NO `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`.
- `sync-execute.mjs` → `createSyncDevEnvironment()` (sync-dev-env.mjs, line 14-15) falls back: `env.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT || env.BIBLIOTECA_DEV_DESKTOP_DB_DIR || DEFAULT_DESKTOP_DATA_ROOT`.
- `DEFAULT_DESKTOP_DATA_ROOT` = `/home/napster/.local/share/io.github.Napster0x.biblioteca.dev` (line 7).
- `filterUnchangedReplicas` checks `_replicas` at the DEFAULT path. If that DB is empty or has a different set of entries, the filter doesn't work for some or all kinds.

**Why the v1 tests pass but cycle fails**: The v1 tests call `spawnNode(syncExecuteScript, [], { BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: desktopRoot })` — the env var is set explicitly. The cycle tests use `BIBLIOTECA_DEV_DESKTOP_SYNC_TRIGGER_URL: 'http://127.0.0.1:9/api/sync-trigger'` (unreachable port) — they never trigger a real sync, only validate report structure. The gap only manifests in real development when the cycle posts to a live Next.js dev server.

#### Issue 2: Pull echo — evidence counts are misleading

**`pulled` count**: `getReplicas()` (line 98-99) sets `replicas[kind].pulled = rows.length` without filtering. After push, Android returns ALL replicas (including those just pushed). No pull-side filter exists — the evidence always shows non-zero `pulled` even on idempotent syncs.

**`appliedToDesktop` count**: `upsertReplicaRow` has an HLC gate on `replica_id` (line 292). This gate works when the `replica_id` matches between Desktop `_replicas` and Android's returned replicas. However, Android's `push()` method (visible_repo.rs, line 1094-1098) calls `resolve_semantic_id()` which remaps `replica_id`:

- **dictionary-entry** (line 626-637): Matches by normalized(term) + language. If Android already has a dict-entry for the same term+language, the pushed `replica_id = "dictionary-entry:entry-1"` gets remapped to `"dictionary-entry:{existing-android-id}"`. When pulled back, the HLC gate checks for the REMAPPED ID → not found in Desktop `_replicas` (which has `"dictionary-entry:entry-1"`) → gate passes → `appliedToDesktop` increments.
- **dictionary-occurrence** (line 704): Returns `None` — NO semantic remapping. The HLC gate should work. BUT: the `pulled` count is still non-zero because `getReplicas` doesn't filter.
- **quote** (line 649-674): Matches by book_hash + content_hash.
- **annotation** (line 676-701): Matches by book_hash + cfi.

#### `toHlc()` Determinism Check

`toHlc()` (line 319-322): `value → Number → millis → toString(16).padStart(13,'0')-00000001-visible`. The round-trip `toHlc → hlcMillis → toHlc` is **lossless** for valid hex segments. `hlcMillis` calls `parseInt(firstSegment, 16)` which recovers the original millis. `toHlc(hlcMillis(hlc))` produces the identical HLC string. No determinism issue found.

### Affected Areas

| File | Why affected |
|------|-------------|
| `apps/readest-app/scripts/sync-execute.mjs` | **No changes needed** — the filter and pull logic are correct. The issue is in the EXECUTION CONTEXT, not the sync logic itself. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | **Modify**: `triggerSync()` must POST `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` in the request body so the API route can forward it to spawned `sync-execute.mjs`. (~4 lines in `triggerSync` call + `fetch` body). |
| `apps/readest-app/src/app/api/sync-trigger/route.ts` | **Modify**: POST handler must (a) accept `request: Request` parameter, (b) read body for `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`, (c) forward it in the spawn env. (~6 lines). |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | **Modify**: Add integration tests for cycle-triggered idempotence and pull-filter correctness. |
| `apps/readest-app/scripts/sync-dev-env.mjs` | **No changes** — `createSyncDevEnvironment()` already correctly reads `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` from env. |

### Approaches

#### 1. **Surgical: Forward dataRoot from cycle to trigger, filter pull evidence** (RECOMMENDED)

Two surgical changes:
- **dataRoot propagation**: Cycle POSTs `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` in body → route reads and forwards to spawn. Adds ~3-4 lines to cycle's `triggerSync`, ~5-6 lines to route's `POST`.
- **Pull filter**: Apply `filterUnchangedReplicas()` to pulled rows BEFORE `applyReplicaRowsToDesktop()`. Override `replicas[kind].pulled` with filtered count. Adds ~4-5 lines to pull loop in `sync-execute.mjs`. The `filterUnchangedReplicas` helper already exists (line 298-301).
  - **Pros**: Minimal diff (~15 lines total). Reuses existing infrastructure. No new abstractions. Preserves v1 behavior for direct CLI execution.
  - **Cons**: Still relies on `_replicas` being populated. Dict-entry `appliedToDesktop` may still be non-zero if Android remaps `replica_id` (known limitation — data converges over 2 syncs, not 1).
  - **Effort**: Low

#### 2. **Pass dataRoot as CLI argument to sync-execute.mjs**

Add `--data-root` flag to `sync-execute.mjs`, have the route pass it on the command line. The cycle would still need to communicate it to the route somehow (body or query param).
  - **Pros**: More explicit, avoids env var reliance.
  - **Cons**: Changes the script's CLI interface. More code changes. The env var approach already works for direct execution — consistency is better.
  - **Effort**: Medium

#### 3. **Write dataRoot to a well-known file**

The cycle writes `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` to a temp file. `sync-execute.mjs` reads it. The route doesn't need changes.
  - **Pros**: No route changes needed. Fewer touchpoints.
  - **Cons**: Introduces filesystem state. Race condition risk. Harder to test. Not aligned with the env-var-based design.
  - **Effort**: Medium

### Recommendation

**Approach 1** is the right fix. It's surgical, minimal, and reuses existing patterns.

**Details for dataRoot propagation**:

In `dev-sync-cycle.mjs`, modify each `fetch(triggerUrl, ...)` call to include the body:
```js
body: JSON.stringify({ BIBLIOTECA_DEV_DESKTOP_DATA_ROOT: stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT }),
```
This affects: `triggerSync` (line 57, used by multi-step and pipeline paths) and the legacy `fetch` in `main()` (line 387).

In `route.ts`, modify `POST` to read the body and forward:
```ts
export async function POST(request: Request) {
  // ... existing guard ...
  let dataRoot: string | undefined;
  try { const body = await request.json(); dataRoot = body?.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT; } catch {}
  const spawnEnv: Record<string, string> = { BIBLIOTECA_DEV_SYNC_HARNESS: '1' };
  if (dataRoot) spawnEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT = dataRoot;
  // ... spawn with { ...process.env, ...spawnEnv } ...
}
```

**Details for pull filter**:

In `sync-execute.mjs`, modify the pull loop (lines 500-503):
```js
for (const [kind, endpoint] of REPLICA_PULL_ORDER) {
  const dbPath = desktopReplicaDbPath(env.desktop.dataRoot, kind);
  const rows = await getReplicas(baseUrl, kind, endpoint, replicas);
  const newRows = filterUnchangedReplicas(dbPath, rows);
  replicas[kind].pulled = newRows.length;
  replicas[kind].appliedToDesktop = applyReplicaRowsToDesktop(kind, newRows, dbPath);
}
```

### Known Limitations (Out of Scope)

- **Dict-entry `replica_id` remapping**: When Android's `resolve_semantic_id` maps a pushed entry to an existing Android ID, the pulled-back `replica_id` differs from Desktop `_replicas`. The pull filter lets it through (correct — it's a genuinely new replica from Desktop's perspective). The `appliedToDesktop` count will be non-zero for this case on the first sync. After being applied, the new `replica_id` is written to Desktop `_replicas`, and subsequent syncs will filter it out. This is a 2-sync convergence, not a bug. Fixing it would require visible-table-ID-based dedup on Desktop, which is out of scope for this surgical fix.

### Risks

- **Breaking existing trigger clients**: The route currently doesn't read the request body. If other clients POST to `/api/sync-trigger` with a body for other purposes, our change must not break them. **Mitigation**: Read body optionally (catch parse errors), only extract the specific key.
- **Cycle multi-step/pipeline paths**: Both paths call `triggerSync` which needs the body. The legacy path has its own `fetch` call that also needs updating. **Mitigation**: Update all three fetch sites in `dev-sync-cycle.mjs`.
- **Pull filter uses same dbPath**: `filterUnchangedReplicas` checks `_replicas` for the same DB file. Dictionary-entry and dictionary-occurrence share `dictionary.db`. The filter correctly scopes by `replica_id` (prefix: `dictionary-entry:` vs `dictionary-occurrence:`), so no cross-contamination.
- **Caso 7 (bidirectional) regression**: The pull filter only affects evidence counts, not the actual data flow. `applyReplicaRowsToDesktop` still receives only truly new rows. Caso 7 behavior is preserved.

### Ready for Proposal

Yes. The exploration has identified two clear, surgical issues with minimal fix paths. The dataRoot propagation is a missing wire in the cycle→trigger chain. The pull echo is a missing pre-filter that mirrors the existing push filter. Both can be fixed with ~15 lines total across 3 files. The orchestrator should proceed to `sdd-propose` with this exploration as input.
