# Proposal: Fix Phase 4 Real Conflicts Reliability

## Intent

Make Phase 4 real-device conflict reliability actionable: stop masking product/harness failures as `environment`, collect enough Android/config evidence for cases 22/24/25/26, and isolate real convergence bugs in 21a–21d with later TDD fixes.

## Scope

### In Scope
- Refine reliability `failure_domain` classification so missing Android `sqlite3` is an unavailable-evidence signal, not a global environment override.
- Improve Android HTTP fallback/entity lookup and `config.json`/BookNote capture for 22a/22c/24/25/26.
- Investigate and fix 21a–21d product or harness convergence causes using strict TDD in later phases.
- Re-run the bounded real-device Phase 4 cycle after fixes and report per-case evidence.

### Out of Scope
- No production code changes in proposal phase.
- No build, commit, redeploy, or automatic device cleanup beyond later explicitly approved verification.
- No redesign of sync architecture or arbitrary Markdown scenario runner.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: tighten Phase 4 reliability diagnosis, Android fallback evidence, BookNote/config evidence, and TDD expectations for 21a–21d fixes.

## Approach

Use stacked slices: (1) diagnostics/classification, (2) evidence completeness for Android row/config capture, (3) focused 21a–21d convergence fixes, then real-device rerun. Treat `sqlite3` absence as degradation per spec, not proof that every non-pass is environmental.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Verdict/failure-domain classification and Phase 4 reporting. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modified | Android fallback rows and desktop/Android `bookConfig` capture. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modified | Possible 21a–21d HLC/LWW merge fixes after tests prove root cause. |
| `apps/readest-app/scripts/__tests__/` | Modified | Strict TDD coverage for classifier, evidence, and merge fixes. |
| `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` | Modified | Delta requirements for classification/evidence reliability. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Android lacks row-level SQLite evidence | High | Require substitute HTTP evidence and explicit unavailable-evidence fields. |
| Case 25 hides real type-integrity bug | Med | Complete config evidence before deciding harness vs product. |
| Harness fixes mask product bugs | Med | Add failing tests first and keep fixture actions realistic. |
| Cleanup/state leakage distorts reliability | Med | Verify isolation evidence before trusting repeat percentages. |

## Rollback Plan

Revert the stacked slice that regresses diagnostics/evidence or sync behavior, restore prior harness scripts, and keep Phase 4 marked non-passing until a clean real-device rerun proves recovery.

## Dependencies

- Real desktop↔Android USB flow remains available; Android `sqlite3` may remain unavailable.
- Existing Phase 4 spec and exploration evidence.

## Success Criteria

- [ ] Non-pass Phase 4 attempts are classified as product, harness, environment, or unknown without global `sqlite3` contamination.
- [ ] Cases 22a/22c/24/25/26 produce enough Android/config evidence for PASS/FAIL/WARN per spec.
- [ ] 21a–21d have failing tests before fixes and pass focused tests after fixes.
- [ ] Repeated Phase 4 real-device run exceeds the reliability threshold or reports actionable per-case blockers.
