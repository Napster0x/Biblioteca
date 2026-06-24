# Proposal: Sync CRDT+HLC Ideal Harness

## Problem Statement

The current dev sync harness has useful pieces, but it can still give false confidence: command contracts are inconsistent, realistic dictionary/quote/annotation actions are incomplete, trigger success can mask nested sync failure, and assertions are not semantic desktop-vs-Android CRDT+HLC checks.

## Goal and Non-Goals

Goal: implement exactly `ideal_harness.md`: a composable CLI toolbox for real-device USB desktop↔Android sync testing with safe automation, evidence, semantic assertions, and reports.

Non-goals: no monolithic scenario runner, Markdown parser, production sync redesign, unrequested UI automation, builds, installs, or global process killing.

## Scope Boundaries

In scope: `doctor`, `state`, guarded `reset/clean`, `prepare`, `action/inject`, `trigger`, `cycle`, `assert`, `report`, and dry-run/supervised orchestration where safe. The human keeps USB devices connected and authorizes RSA, destructive cleanup, build/install/redeploy, and sensitive process control.

## Current Harness Audit Requirement

First slice MUST meticulously audit and stabilize the existing harness contract before adding behavior: package scripts, CLI entrypoints, guard semantics, fixture/inject dependencies, claimed-vs-actual highlights, trigger failure propagation, ADB forward/reverse consistency, and current test coverage.

## Capabilities

### New Capabilities
- `sync-crdt-hlc-real-device-harness`: real-device USB CLI harness behavior, safety model, semantic assertions, and report evidence.

### Modified Capabilities
- None; no existing `openspec/specs/` capabilities exist.

## Approach

Strict TDD per slice: write failing focused Vitest/unit tests first, implement the minimum, refactor only when justified. Delivery: `auto-chain`, `stacked-to-main`, reviewable slices under ~400 changed lines where possible:
1. Audit + command contract stabilization.
2. Doctor/USB readiness and human-vs-CLI guidance.
3. Reliable trigger/cycle failure propagation.
4. Semantic state/assert engine.
5. Realistic action injection for books, dictionary, quote, annotation.
6. Semantic report diagnostics.
7. Optional dry-run process orchestration.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `apps/readest-app/scripts/dev-sync-*.mjs`, `sync-dev-*.mjs` | Modified | CLI toolbox, guards, actions, trigger, state, assert, report. |
| `apps/readest-app/src/app/api/*sync*` | Modified | Health/trigger truthfulness. |
| `apps/readest-app/src-tauri/src/*local_sync*`, `USBHttpTransport` | Observed | Driven/diagnosed, not redesigned. |
| `apps/readest-app/src/__tests__/**` | Modified | Tests-first coverage for every slice. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Semantic/assert work exceeds budget | Med | Split by invariant/domain. |
| Real Android evidence unavailable | Med | Report `WARN/AMBIGUOUS`, not false `PASS`. |
| Unsafe automation | Med | Dry-run defaults, markers, serial/port scoping, explicit authorization. |

## Rollback Plan

Revert the active stacked slice; each slice preserves existing safe commands and has focused tests. Destructive cleanup remains guarded and dry-run-first.

## Dependencies

- Real USB-connected Android + desktop dev apps; user authorization for RSA/destructive/build/install actions only.

## Success Criteria

- [ ] Existing harness contract audited and stabilized first.
- [ ] CLI can prepare real data, trigger sync, capture state, assert convergence/invariants, report diagnostics, and clean safely.
- [ ] Dictionary, quote, annotation, deletion, duplicate, tombstone, HLC, and chained-sync cases from `ideal_harness.md` are constructible.
- [ ] Tests are written before implementation for every slice; no builds run without authorization.
