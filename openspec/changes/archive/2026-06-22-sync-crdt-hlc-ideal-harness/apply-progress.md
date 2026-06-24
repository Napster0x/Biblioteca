# Apply Progress — sync-crdt-hlc-ideal-harness

## Scope Applied

PR1 / slice 1 only: current harness audit and command contract stabilization, plus verification-failure fixes for PR1 TypeScript strictness.

## Mode

Strict TDD (from user launch prompt and Engram `sdd/biblioteca/testing-capabilities`).

## Completed Tasks

- [x] 1.1 Enumerated `dev:sync:*` package scripts and required every declared Node `.mjs` entrypoint to exist; corrected `dev:sync:inject` to the existing `scripts/sync-dev-inject.mjs` implementation.
- [x] 1.2 Stabilized PR1 blocking contracts: inject CLI failure JSON, serial-scoped ADB forward contract metadata, trigger CLI nested failure propagation, sync-trigger route nested failure propagation, and deterministic reset marker guard coverage.
- [x] PR1 verification fix: removed TypeScript strictness failures from `src/__tests__/services/sync/devSyncHarness.test.ts` and `src/app/api/sync-trigger/route.ts` without broadening behavior or entering future PR slices.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/CLI contract | ⚠️ Baseline targeted file had 1 pre-existing/env-dependent reset marker failure; full app command invocation accidentally ran broader pre-existing suite failures, then focused Vitest file was used | ✅ Added package script entrypoint enumeration and inject JSON failure test before implementation | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 90/90 passed | ✅ Covered package script path existence plus missing-input JSON failure | ✅ Kept fix to package script contract and minimal JSON envelope only |
| 1.2 | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Unit/CLI/route contract | Same safety net as 1.1 | ✅ Added nested trigger failure and ADB forward contract tests before implementation | ✅ `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 90/90 passed | ✅ Covered success route counter with mocked Android manifest, nested failure route/CLI behavior, serial-scoped forward metadata, and reset marker guard determinism | ✅ Avoided realistic actions, orchestration, semantic assertions, and report architecture |
| PR1 verification fix | `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts`; `apps/readest-app/src/app/api/sync-trigger/route.ts` | TypeScript strictness / unit safety net | ✅ Before edits: `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` → 90/90 passed | ✅ Reproduced verify RED with `pnpm exec tsgo --noEmit`: PR1 diagnostics in `devSyncHarness.test.ts` and `route.ts` (unused import/helpers, `ProcessEnv` overrides, index-signature access, possibly undefined indexed values) | ✅ After edits: focused Vitest → 90/90 passed; full `pnpm exec tsgo --noEmit` no longer reports `devSyncHarness.test.ts` or `route.ts` | ✅ Covered both PR1 files: test harness env/indexing/nullability cleanup and route env index-signature cleanup | ✅ Removed unused helpers/imports and used explicit guards/bracket access only; no behavior expansion |

## Test Summary

- **Total tests written/adjusted for PR1**: 6 focused contract assertions/tests from prior apply; this pass adjusted TypeScript-only harness/route code without adding new behavior.
- **Total tests passing**: 90/90 in targeted harness file after verification fixes.
- **Layers used**: Unit/CLI contract, route contract, TypeScript strictness check.
- **Approval tests**: Existing reset/trigger/state harness tests preserved.
- **Pure functions created**: 0; minimal typing/contract cleanup only.

## Verification

- ✅ Safety net before edits: `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 90 passed.
- ✅ After edits: `pnpm exec vitest run src/__tests__/services/sync/devSyncHarness.test.ts` — 90 passed.
- ✅ Focused lint: `pnpm exec biome lint package.json scripts/sync-dev-inject.mjs scripts/sync-dev-env.mjs scripts/dev-sync-trigger.mjs src/app/api/sync-trigger/route.ts src/__tests__/services/sync/devSyncHarness.test.ts` — no errors/warnings for PR1 set.
- ⚠️ `pnpm exec tsgo --noEmit` still fails on broader, out-of-scope workspace files, but it no longer reports `src/__tests__/services/sync/devSyncHarness.test.ts` or `src/app/api/sync-trigger/route.ts`.
- ⚠️ Attempted targeted TypeScript check with explicit file paths, but `tsgo` rejected it because `tsconfig.json` is present and would not be loaded when files are specified: `TS5112`.
- ⚠️ `pnpm test -- src/__tests__/services/sync/devSyncHarness.test.ts --run` and `pnpm test -- --run src/__tests__/services/sync/devSyncHarness.test.ts` previously invoked the broader app suite in this workspace and surfaced unrelated pre-existing failures; not used as PR1 verification.
- No builds run.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `apps/readest-app/package.json` | Modified | Pointed `dev:sync:inject` at `scripts/sync-dev-inject.mjs`, the actual implementation. |
| `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` | Modified | Added PR1 command-contract tests, made reset marker guard coverage deterministic, and fixed strict TypeScript errors through typed env overrides, bracket env/index-signature access, explicit indexed-value guards, and unused helper removal. |
| `apps/readest-app/scripts/sync-dev-inject.mjs` | Modified | Emitted stable JSON `{ ok, status, command, errors }` for missing inputs and CLI results. |
| `apps/readest-app/scripts/sync-dev-env.mjs` | Modified | Exposed serial-scoped `adb forward tcp:7878 tcp:7878` USB tunnel contract metadata. |
| `apps/readest-app/scripts/dev-sync-trigger.mjs` | Modified | Added stable pass/fail JSON envelope, host override for safe tests, fetch timeout, and nested failure detection. |
| `apps/readest-app/src/app/api/sync-trigger/route.ts` | Modified | Propagated nested `sync-execute` failures as HTTP 500 with `ok:false`, without `any`, and fixed strict env index-signature access. |
| `openspec/changes/sync-crdt-hlc-ideal-harness/tasks.md` | Modified | Marked PR1 tasks 1.1 and 1.2 complete. |
| `openspec/changes/sync-crdt-hlc-ideal-harness/apply-progress.md` | Modified | Merged prior apply progress with PR1 verification-fix evidence. |

## Deviations from Design

None — PR1 stayed on contract stabilization and verification cleanup; no future-slice readiness, orchestration, realistic actions, semantic assertions, report architecture, builds, Android deploys, or destructive cleanup were added.

## Issues Found

- The configured package command referenced `scripts/dev-sync-inject.mjs`, but the actual implementation is `scripts/sync-dev-inject.mjs`.
- The route-level sync trigger could previously return `ok:true` even when nested `sync-execute` failed.
- The previous reset marker test depended on whether the local default dev data root already contained `.biblioteca-dev-sync`; PR1 made that coverage deterministic.
- `tsgo --noEmit` cannot be used as a file-targeted checker with explicit file paths in this app because it refuses to ignore the present `tsconfig.json` unless `--ignoreConfig` is used; full-project `tsgo --noEmit` is therefore the meaningful strict check.
- Full TypeScript remains red due unrelated/out-of-scope files already listed by the checker (for example component tests, sync transport tests, `DebugSyncTrigger.tsx`, `Providers.tsx`, and `localSyncUtils.ts`).

## Remaining Tasks

- [ ] 2.1 Real-device readiness and discovery diagnostics.
- [ ] 2.2 Safe dry-run environment planner.
- [ ] Later PR slices for cleanup/state hardening, realistic actions, trigger/cycle/assert/report semantics, docs, and smoke.

## Workload / PR Boundary

- **Mode**: stacked PR slice (`auto-chain`, `stacked-to-main`).
- **Current work unit**: PR1 — Harness Audit + Command Contract Stabilization.
- **Boundary**: Ends at reliable command contracts, PR1 route/test TypeScript cleanup, and focused verification; no realistic user actions, semantic assertions, process orchestration, or report architecture.
- **Estimated review budget impact**: Focused contract slice; the working tree still contains many unrelated modified/untracked files, so PR1 must be isolated by file/hunk selection before review.

## Status

2/12 planned tasks complete. PR1 behavioral verification passes and the two PR1 TypeScript-failure files are now clean under full `tsgo --noEmit`; broader full-project TypeScript failures and working-tree isolation remain out-of-scope risks for PR1 packaging.
