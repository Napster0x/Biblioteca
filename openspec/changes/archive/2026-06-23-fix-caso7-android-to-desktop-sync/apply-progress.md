# Apply Progress — fix-caso7-android-to-desktop-sync

## Mode

Strict TDD (from launch prompt and Engram `sdd/biblioteca/testing-capabilities`).

## Status

Prerequisite safety-net blocker fixed. Work Unit 1 / Phase 1 RED coverage is complete. Work Unit 2 / Phase 2 minimal script implementation is complete and focused Vitest is green. Phase 3 lint/type verification remains optional/not run in this slice because no TypeScript production code was changed.

## Completed Tasks

- [x] Prerequisite blocker: deterministic doctor fixture isolation restored the focused safety net to green.
- [x] 1.1 Added RED test coverage where Android GETs expose all four ReplicaRow kinds and desktop SQLite visible rows plus `_replicas` metadata must converge.
- [x] 1.2 Added RED dictionary ordering assertion requiring `dictionary-entry` GET/apply before `dictionary-occurrence` convergence.
- [x] 1.3 Added RED idempotence/HLC coverage requiring equal/older Android rows to avoid duplicates and avoid overwriting newer desktop `_replicas` state.
- [x] 1.4 Added RED additive-evidence assertions preserving existing `attempted`/`applied` fields while requiring `pulled` and `appliedToDesktop` counts per kind.
- [x] 2.1 Extended replica evidence with additive `pulled` and `appliedToDesktop` fields.
- [x] 2.2 Added Android replica GET normalization for both `ReplicaRow[]` and `{ rows }` payloads.
- [x] 2.3 Added desktop SQLite helpers for `_replicas`, visible table DDL, HLC gating, and `replica_id` to visible `id` extraction.
- [x] 2.4 Added visible upserts for dictionary entries, dictionary occurrences, quotes, and annotations using existing field maps and `field.v`.
- [x] 2.5 Wired Android pull/apply after existing Desktop→Android PUTs in fixed `dictionary-entry`, `dictionary-occurrence`, `quote`, `annotation` order.
- [x] 3.1 Ran focused Vitest file from `apps/readest-app`.
- [x] 3.3 Confirmed no Android install/redeploy/restart, destructive cleanup, build, or real sync trigger was executed.

## Safety Net

| Command | Working Directory | Result |
|---------|-------------------|--------|
| `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` | `apps/readest-app` | ❌ Pre-existing failure: 1 failed, 160 passed |
| `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` | `apps/readest-app` | ✅ 161 passed after fixture isolation fix |
| `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` | `apps/readest-app` | ✅ RED confirmed for Work Unit 1: 3 expected failures, 161 passed, 164 total |
| `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` | `apps/readest-app` | ✅ GREEN confirmed for Work Unit 2: 164 passed |
| `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts` | `apps/readest-app` | ❌ Package script did not stay focused; it ran the broader suite and failed on unrelated existing tests (19 failed files, 244 passed files). |

Pre-existing failing test:

- `src/__tests__/services/sync/devSyncHarness.test.ts` → `dev sync doctor harness > prints structured JSON checks without mutating state when prerequisites are missing`
- Failure: expected `desktop.devSyncHealth` status `warn`, received `pass` at line 1378.

Blocker fix:

- Root cause: the doctor test isolated `desktop.syncTrigger` but did not override `BIBLIOTECA_DEV_DESKTOP_DEV_SYNC_HEALTH_URL`, so a locally running desktop dev-sync health endpoint on the default `localhost:3000` could correctly make `desktop.devSyncHealth` pass.
- Fix: the test fixture now points `BIBLIOTECA_DEV_DESKTOP_DEV_SYNC_HEALTH_URL` at the same unreachable loopback port used for missing prerequisites.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| Prerequisite blocker | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/script | ❌ Baseline reproduced: 1 failed, 160 passed | Existing red safety-net failure | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 161 passed | ➖ Fixture isolation only | ➖ None needed |
| 1.1 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/script | ✅ 161 passed before RED slice | ✅ Written first: Android GETs for four kinds plus visible table and `_replicas` assertions | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 164 passed after Phase 2 | ✅ Covered four kinds and `{ rows }`/array payload expectations | ➖ None needed |
| 1.2 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/script | ✅ 161 passed before RED slice | ✅ Written first: dictionary GET order and entry-backed occurrence convergence | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 164 passed after Phase 2 | ✅ Separate ordering/convergence path | ➖ None needed |
| 1.3 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/script | ✅ 161 passed before RED slice | ✅ Written first: two sync runs with newer desktop HLC preseed | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 164 passed after Phase 2 | ✅ Exercises duplicate prevention and stale Android skip path | ➖ None needed |
| 1.4 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/script | ✅ 161 passed before RED slice | ✅ Written first: additive `pulled`/`appliedToDesktop` assertions while preserving `attempted`/`applied` | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 164 passed after Phase 2 | ✅ Covered all four replica evidence entries | ➖ None needed |
| 2.1–2.5 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/script | ❌ Expected RED baseline: 3 failed, 161 passed | ✅ Phase 1 RED tests already existed before implementation | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 164 passed | ✅ Payload shape, ordering, all four kinds, idempotence, and stale-HLC paths covered | ➖ Minimal implementation only |

## RED Failures Captured

| Test | RED Failure | Phase 2 Fix |
|------|-------------|-------------|
| `pulls every Android replica kind and applies visible rows plus replica metadata with additive evidence` | `replicaGets` was `[]` instead of all four `/replicas/*` GETs | Added ordered GETs, payload normalization, SQLite visible writes, `_replicas`, and evidence fields. |
| `requests dictionary entries before occurrences and does not converge an occurrence without its entry` | `dictionary-entry` GET was missing (`indexOf` was `-1`) | Added fixed pull/apply order and occurrence apply gate requiring its entry. |
| `keeps Android-to-desktop apply idempotent and refuses older HLC overwrites` | Evidence lacked `pulled`/`appliedToDesktop`; current script only reported push evidence | Added HLC gate so equal/older rows are skipped and newer desktop `_replicas` state is preserved. |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `openspec/changes/fix-caso7-android-to-desktop-sync/apply-progress.md` | Updated | Merged prior blocker progress, Work Unit 1 RED coverage, and Work Unit 2 GREEN implementation evidence. |
| `openspec/changes/fix-caso7-android-to-desktop-sync/tasks.md` | Updated | Marked Phase 2 and focused verification tasks complete. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Existing prior slice RED tests verify Android→Desktop pull/apply/order/idempotence/evidence. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Added minimal Android→Desktop replica pull/apply path with additive evidence and HLC idempotence gates. |

## Deviations from Design

None — implementation stayed in `sync-execute.mjs`, preserved Desktop→Android PUT behavior, used additive evidence fields, and applied dictionary entries before occurrences.

## Issues Found

- Existing Desktop→Android-focused tests use mock servers without `/replicas/*` GET handlers. The new pull step records GET failures but does not fail the generic executor, preserving existing Desktop→Android behavior while allowing Caso 7 tests with usable GET evidence to pass.
- `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts` under the app package expanded beyond the target file in this workspace and surfaced unrelated existing failures. The reliable focused command for this slice is `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts`, which passed 164/164.

## Remaining Tasks

- [ ] 3.2 Run type/lint verification if needed: `pnpm lint`; do not run `pnpm build` or real device sync.

## Workload / PR Boundary

- Mode: stacked PR slice (`auto-chain`, `stacked-to-main`)
- Current work unit: PR 2 minimal Android→Desktop sync-execute implementation
- Boundary: start from Work Unit 1 RED tests; implement only the missing script pull/apply/evidence behavior; end with focused Vitest green and no build/real harness operations.
- Estimated review budget impact: focused script implementation plus SDD artifact updates; no broader sync redesign.

## Test Summary

- **Total tests written**: 3 new RED tests in prior slice covering tasks 1.1–1.4; 0 new tests in implementation slice.
- **Total tests passing**: 164 focused tests passing.
- **Layers used**: Unit/script.
- **Approval tests**: None — no refactoring tasks started.
- **Pure functions created**: 0 exported pure functions; several script-local helpers for payload normalization, HLC gating, and SQLite upserts.
