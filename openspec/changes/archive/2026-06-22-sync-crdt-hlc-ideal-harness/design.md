# Design: Sync CRDT+HLC Ideal Harness

## Technical Approach

Extend the existing `dev:sync:*` Node toolbox in `apps/readest-app/scripts/` incrementally, not as a scenario runner. First stabilize command contracts, then add composable engines for readiness, actions, semantic assertions, reports, and optional dry-run process planning. The source of truth is `ideal_harness.md`; no builds, redeploys, restarts, or destructive cleanup happen without explicit human authorization.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Toolbox shape | Small CLIs (`doctor`, `state`, `prepare`, `action/inject`, `trigger`, `cycle`, `assert`, `report`) backed by reusable `.mjs` engines | Markdown runner, one huge flow | Keeps evidence inspectable and failures diagnosable. |
| First slice | Contract audit before features | Add actions immediately | Current `dev:sync:inject` path, fixture wiring, trigger truthfulness, and ADB direction are not stable enough to build on. |
| Verdict model | `PASS/FAIL/WARN/AMBIGUOUS` plus evidence paths | Boolean `ok` only | Prevents false PASS when Android SQLite, replicas, discovery, or nested sync evidence is missing. |
| Device model | Real USB validation where observable; manual authorization for RSA/build/install/restart/destructive actions | Fully automatic device lifecycle | Matches connected-device constraint without unsafe control. |

## Data Flow

```txt
CLI command -> command-contract wrapper -> domain engine -> desktop/ADB/API adapters
    -> evidence bundle -> semantic assertions -> report verdict + diagnosis
```

`cycle` composes explicit steps only: snapshot, prepare/action, trigger, snapshot, assert, report, optional guarded clean.

## File Changes

| File | Action | Description |
|---|---|---|
| `scripts/dev-sync-*.mjs`, `scripts/sync-dev-*.mjs` | Modify | Stabilize command contracts, JSON output, exit statuses, guards, and shared helpers. |
| `scripts/assert-engine.mjs` | Modify | Replace count-only desktop assertions with semantic desktop↔Android invariants. |
| `scripts/*action*.mjs` or `scripts/dev-sync-fixture.mjs` | Create/Modify | Minimal action tooling for book-backed dictionary, quote, annotation, edits, deletes, tombstones. |
| `scripts/report-engine.mjs` | Create | Build diagnostic reports from snapshots, operations, sync attempts, assertions, cleanup. |
| `src/app/api/sync-trigger/route.ts` | Modify | Propagate nested `sync-execute` failure instead of returning `ok:true`. |
| `src/__tests__/services/sync/devSyncHarness.test.ts` | Modify | Strict TDD tests per slice. |
| `docs/sync-dev-harness.md` | Modify | Document stable contracts and manual-vs-CLI responsibilities. |

## Interfaces / Contracts

Each command emits JSON: `{ ok, status, verdict?, command, inputs, outputs, evidence, warnings, errors, reportPath? }`. Status is command execution (`pass|warn|fail|blocked`); verdict is semantic result (`PASS|FAIL|WARN|AMBIGUOUS`). Evidence includes desktop/Android snapshots, SQLite facts, replica summaries, HLC ranges, tombstones, operation ids, trigger attempts, unavailable evidence, and cleanup verification.

Readiness diagnostics cover ADB serial, `adb forward tcp:7878 tcp:7878`, desktop health, Android health/version, manifest, replicas, sync trigger reachability, settings/toggle state, and contradictions as `WARN/AMBIGUOUS`.

Process orchestration is a planner first: dry-run command list, PID/report files, scoped ports/serials, health polling. Starting/stopping long-lived processes, builds, installs, redeploys, global kills, and destructive cleanup remain manual/authorized.

## Testing Strategy

| Slice | Test-first strategy |
|---|---|
| 1 contract audit | Failing tests enumerate package scripts, entrypoints, guard behavior, fixture dependencies, ADB forward contract, and nested trigger failure. |
| 2 readiness | Mock ADB/fetch tests for device identity, forward missing/wrong, health metadata, discovery/toggle contradictions. |
| 3 trigger/cycle | Route and CLI tests prove nested failures become `FAIL`, partial evidence becomes `WARN/AMBIGUOUS`. |
| 4 state/assert | Snapshot fixtures for desktop+Android SQLite/replicas: duplicates, HLC newer-wins, tombstones, stale resurrection, detached data. |
| 5 actions | Temp SQLite/library fixtures for EPUB import, dictionary, quote, annotation, edits, deletes, tombstones on desktop/Android adapters. |
| 6 report | Golden JSON reports with probable domain, evidence paths, missing evidence, cleanup outcome. |
| 7 orchestration | Dry-run planner tests; no process start without explicit authorization token. |

## Migration / Rollout

No data migration required. Deliver as `auto-chain`, `stacked-to-main`, under reviewable slices: contract audit, readiness, trigger/cycle, state/assert, actions, report, optional orchestration.

## Risks / Tradeoffs / Alternatives

- Semantic assertions may exceed budget: split by invariant/domain.
- Android `run-as`/`sqlite3` may be unavailable: degrade honestly, never false PASS.
- Direct DB injection is faster than UI automation but must mirror real semantic rows; keep it fixture-tested.
- Full process orchestration is convenient but risky; dry-run planner preserves safety.

## Open Questions

None blocking. Human authorization is still required for builds, redeploys, destructive cleanup, process restarts, and device RSA prompts.
