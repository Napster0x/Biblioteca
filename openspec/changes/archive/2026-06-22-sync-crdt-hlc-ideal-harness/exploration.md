# Exploration: sync-crdt-hlc-ideal-harness

## Current State

`ideal_harness.md` defines a composable CLI toolbox for real-device USB CRDT+HLC testing: doctor, state, guarded clean/reset, prepare real books, realistic user actions, trigger, cycle, assert, report, and cleanup. The current project already has a strong partial harness under `apps/readest-app/scripts/dev-sync-*.mjs` and `sync-dev-*.mjs`, plus USB-only local sync code in Tauri/React.

What exists today:
- Non-destructive doctor: checks ADB, Android device/run-as/data dir, Android `/health`, `/books/manifest`, desktop health/trigger endpoints, sqlite3 availability, and Android replica endpoints.
- State capture: desktop and Android library/settings/book counts, DB files, SQLite table metadata, row counts, HLC range, tombstone count, and Android `/replicas/:kind` metadata.
- Guarded cleanup: `dev-sync-reset` and `dev-sync-clean` require `BIBLIOTECA_DEV_SYNC_HARNESS=1` or development mode; destructive cleanup requires `DELETE_DEV_SYNC_STATE`; desktop cleanup requires `.biblioteca-dev-sync` marker.
- Prepare: `dev-sync-prepare` imports a real EPUB into desktop dev library and updates `library.json`.
- Trigger/cycle/report: `dev-sync-trigger` calls desktop `/api/sync-trigger`; `dev-sync-cycle` captures pre/post state, supports `--steps` and `--pipeline`, retries sync, and writes JSON reports.
- USB sync runtime: desktop coordinates ADB `forward tcp:{port} tcp:{port}`; Android serves visible repository endpoints via `local_sync_server.rs`; UI toggle checks ADB/device/tunnel/health and manually runs `runSyncCycle`.
- Tests: extensive Vitest coverage exists for the harness, CRDT/HLC invariants, store replica behavior, local sync, USB transport/book sync, LocalSyncPanel, and Tauri ADB safety.

Gaps versus `ideal_harness.md`:
- The toolbox is not yet coherent at the package-script level: `package.json` maps `dev:sync:inject` to missing `scripts/dev-sync-inject.mjs`, while the real injection module is `scripts/sync-dev-inject.mjs`.
- `dev-sync-fixture.mjs` intends to create dictionary/quote/annotation fixtures but calls `injectRows` without required `dbPath`, `execFileSync`, and `devHarnessEnabled`, so it cannot currently work as a realistic action CLI.
- `dev-sync-fixture.mjs` creates domain rows only; it does not create actual `BookNote`/highlight records in book config, despite comments claiming “entity PLUS highlight.”
- Prepare imports only desktop books; Android preparation is indirectly possible through sync or manual/device files, not as a first-class `prepare --target android` command.
- `sync-execute.mjs` is book-only/minimal and uses endpoint paths that do not fully match `USBHttpTransport`/server routes; `/api/sync-trigger` therefore risks reporting `ok: true` with a nested `syncResult.error` instead of a reliable CRDT+book sync verdict.
- `dev-sync-assert` compares only desktop snapshot counts/settings; it does not assert desktop-vs-Android convergence, semantic groups, HLC policies, tombstones, duplicate absence, detached references, or replica payload equality.
- `dev-sync-cycle` report is useful but not yet the semantic diagnostic report described by `ideal_harness.md`.
- Doctor does not explicitly validate UI toggle/discovery state against endpoint reality, and CLI cannot directly toggle the in-app LocalSyncPanel; it mostly verifies underlying ADB/endpoints.
- CLI process orchestration is incomplete: `dev-sync-up` starts `dev:server` and launches Android, but uses `adb reverse tcp:7878 tcp:7878`, whereas the settled USB design and current UI use `adb forward`. It does not safely orchestrate `dev:tauri` or `dev:android` as supervised long-running processes.

## Affected Areas

- `ideal_harness.md` — primary scope definition; final cycle must implement exactly this, no monolithic scenario runner.
- `apps/readest-app/scripts/dev-sync-doctor.mjs` — base for `doctor`; should grow explicit forward/peer/toggle diagnostics.
- `apps/readest-app/scripts/dev-sync-state.mjs` and `sync-dev-state.mjs` — base for `state`; should expose enough semantic state to assert convergence.
- `apps/readest-app/scripts/dev-sync-reset.mjs`, `dev-sync-clean.mjs`, `clean-engine.mjs` — guarded cleanup; should remain conservative and explicit.
- `apps/readest-app/scripts/dev-sync-prepare.mjs`, `prepare-engine.mjs` — real EPUB import; needs target-aware composition without widening scope unnecessarily.
- `apps/readest-app/scripts/sync-dev-inject.mjs`, `dev-sync-fixture.mjs` — intended action/inject layer; currently the biggest implementation gap.
- `apps/readest-app/scripts/dev-sync-trigger.mjs`, `dev-sync-cycle.mjs`, `sync-execute.mjs`, `assert-engine.mjs` — orchestration/report/assert layer; needs semantic convergence assertions and reliable trigger path.
- `apps/readest-app/src/app/api/dev-sync/health/route.ts` and `src/app/api/sync-trigger/route.ts` — desktop control plane.
- `apps/readest-app/src/components/settings/integrations/LocalSyncPanel.tsx`, `src/store/localSyncStore.ts` — UI toggle/discovery state that doctor should cross-check where feasible.
- `apps/readest-app/src-tauri/src/lib.rs` — ADB device/forward commands; already serial-scoped and non-global-destructive.
- `apps/readest-app/src-tauri/src/local_sync_server.rs`, `visible_repo` — Android visible repository and health/replica/book endpoints.
- `apps/readest-app/src/services/sync/localSyncUtils.ts`, `USBHttpTransport.ts`, `usbBookSync.ts` — runtime sync implementation the harness should drive/observe, not replace.
- `apps/readest-app/src/__tests__/services/sync/devSyncHarness.test.ts` — natural home for harness CLI/unit tests.
- Existing CRDT/local sync tests — `crdtHlcInvariants.test.ts`, `localSyncUtils.test.ts`, `useReplicaSync.test.ts`, store replica tests, `usbBookSync.test.ts`, `LocalSyncPanel.test.tsx`.

## Approaches

1. **Incremental toolbox completion** — Keep the existing CLI commands and fix/extend one capability at a time.
   - Pros: aligns exactly with `ideal_harness.md`; reviewable; preserves guards; supports chained PRs and Strict TDD.
   - Cons: requires disciplined boundaries because many scripts touch the same harness surface.
   - Effort: Medium.

2. **New monolithic harness runner** — Add a single command that reads scenarios and drives everything.
   - Pros: superficially convenient for one demo flow.
   - Cons: explicitly rejected by `ideal_harness.md`; harder to diagnose; high review burden; likely to hide unsafe setup/cleanup.
   - Effort: High and wrong direction.

3. **UI-first/manual testing** — Keep CLI shallow and rely on the operator to use the apps.
   - Pros: least code.
   - Cons: fails the critical goal; not repeatable; weak evidence; too much manual work for CRDT/HLC diagnosis.
   - Effort: Low but insufficient.

## Recommended Slices for Auto-Chain Stacked-to-Main

The requested mode is viable: interactive planning, then automatic execution for each chained PR/slice. The human must keep devices connected and authorize manual/destructive/build/install steps; the agent/CLI can implement and run focused tests per slice without builds. Recommended slices:

1. **Harness command contract cleanup**
   - Scope: make package scripts match real files; add/repair discoverable CLI entrypoints for `inject/action/fixture`; no new domain capability yet.
   - TDD first: failing tests proving `dev:sync:inject` points to an existing script and fixture CLI supplies `dbPath`, `execFileSync`, and harness guard.
   - Budget: low.

2. **Doctor/USB readiness hardening**
   - Scope: add explicit forward-list validation, endpoint consistency, and clearer manual-vs-automated action messages; keep ADB forward serial-scoped.
   - TDD first: failing `devSyncHarness.test.ts` cases for forward present/missing/wrong remote, Android health OK but desktop trigger down, endpoint OK but UI/toggle not known.
   - Budget: low/medium.

3. **Reliable trigger execution**
   - Scope: make CLI trigger call the same sync path/endpoints as the app or report failure honestly; do not fake success when nested sync execution fails.
   - TDD first: failing API/CLI tests where `sync-execute` failure makes `dev-sync-trigger`/cycle verdict fail or warn with diagnosis.
   - Budget: low/medium.

4. **Semantic state and assert engine**
   - Scope: compare desktop-vs-Android logical state for books, dictionary entries/occurrences, quotes, annotations, HLC ranges, tombstones, duplicates.
   - TDD first: snapshot fixture tests for convergence pass, missing occurrence fail with diagnostic, stale tombstone fail, duplicate logical row fail.
   - Budget: medium; likely split if it grows.

5. **Realistic action injection for existing books**
   - Scope: create dictionary/quote/annotation rows plus the corresponding book highlight/config reference for desktop and Android where safely possible.
   - TDD first: fixture tests against temp SQLite + book config JSON proving semantic group creation and reversible cleanup.
   - Budget: medium/high; may split dictionary, quote, annotation.

6. **Cycle/report semantic diagnostics**
   - Scope: compose prepare/action/trigger/state/assert/report with explicit evidence and `PASS|FAIL|WARN|AMBIGUOUS` plus probable diagnosis.
   - TDD first: report tests proving operations, sync order, pre/post snapshots, HLC/tombstone summaries, divergences, cleanup status, and verdict are present.
   - Budget: medium.

7. **Safe process orchestration wrapper**
   - Scope: optional CLI for checking/starting dev server/Tauri/Android as supervised commands, with dry-run and explicit “manual authorization required” for build/install/redeploy/destructive cleanup.
   - TDD first: dry-run planner tests; no long-running servers in tests; asserts no build/install runs without explicit flag.
   - Budget: medium.

## Automation Boundary

Safe for CLI automation:
- Check/start dev server only when explicitly requested or in supervised/dry-run mode.
- Start/launch desktop and Android dev commands only as explicit orchestration, not during tests/explore.
- ADB serial-scoped `forward tcp:{syncPort} tcp:{syncPort}` and health checks.
- Non-destructive doctor/state/report.
- Guarded data injection into dev/test paths and `run-as` app data.
- Trigger sync and capture evidence.
- Dry-run cleanup by default; confirmed cleanup with marker/token.

Must remain manual or explicitly authorized:
- Physically connecting USB devices and accepting Android RSA authorization.
- Build/rebuild/redeploy/install Android or desktop binaries.
- Destructive cleanup (`--confirm DELETE_DEV_SYNC_STATE --no-dry-run`).
- Android install/reinstall, especially if it changes package data or app signing.
- Any operation that kills/restarts user-visible dev processes unless requested.

## Risks

- Current trigger path may produce false confidence because `/api/sync-trigger` returns `ok: true` even when `sync-execute.mjs` fails internally.
- Fixture/action layer is currently not trustworthy; comments promise highlights but implementation only inserts some rows and is missing required injection arguments.
- Real Android SQLite access depends on `run-as` and device `sqlite3`; doctor treats missing sqlite3 as warn, so some evidence may be unavailable on real devices.
- CLI cannot fully know UI toggle state unless the app exposes it; doctor must distinguish endpoint connectivity from UI/discovery readiness.
- Process orchestration can easily become unsafe if it kills forwards/processes globally; keep serial/port-scoped and dry-run-first.
- The semantic assert/report slice may exceed the 400-line review budget unless split by domain/invariant.

## Ready for Proposal

Yes. The proposal should define the change as completing the existing composable CLI harness to match `ideal_harness.md`, explicitly reject a monolithic scenario runner, and plan chained PRs around command contract, doctor/trigger reliability, semantic assertions, realistic actions, reporting, and optional safe process orchestration.
