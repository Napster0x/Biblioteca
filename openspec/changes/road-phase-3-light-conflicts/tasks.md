# Tasks: Road Phase 3 Light Conflicts

## Scope guard

Este cambio es solo documentación/planificación. No implementar lógica de producto, no modificar harness y no ejecutar builds.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120-220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single documentation change |
| Delivery strategy | single-pr |
| Chain strategy | N/A |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: N/A
400-line budget risk: Low

## Phase 0: Administrative cleanup

- [ ] 0.1 Reconcile and close/archive the active `fix-phase2-sync-failures` noise before starting Phase 3 implementation.
- [ ] 0.2 Preserve any remaining Phase 2 `WARN` evidence as diagnostics, not success criteria.

## Phase 1: Semantic specification before code

- [ ] 1.1 Create a Phase 3 delta spec for light conflicts/concurrent convergence.
- [ ] 1.2 Define logical identity for same book, same word, same quote/range, groups and overlapping ranges.
- [ ] 1.3 Define case-level `PASS`, `FAIL` and `WARN` criteria before adding harness/product logic.

## Phase 2: Execution matrix design

- [ ] 2.1 Model Phase 3 as symmetry/concurrency variants, not as a separate mirror phase.
- [ ] 2.2 Specify variants for desktop-first, Android-first, concurrent A/B and isolated repeated execution.
- [ ] 2.3 Require each case to run in isolation so state leakage cannot create false success.

## Phase 3: Natural-language cases 15–20

- [ ] 3.1 Case 15: same book from both devices.
- [ ] 3.2 Case 16: same word from both devices.
- [ ] 3.3 Case 17: same quote/same range from both devices.
- [ ] 3.4 Case 18: edit semantic datum with fixed highlight.
- [ ] 3.5 Case 19: same range, different groups.
- [ ] 3.6 Case 20: overlapping ranges.

## Phase 4: Suggested implementation order

- [ ] 4.1 Start with identity-exact cases 15–17.
- [ ] 4.2 Continue with fixed-geometry semantic edit case 18.
- [ ] 4.3 Finish with structural divergence cases 19–20.
- [ ] 4.4 Keep product/harness work out until spec and design are accepted.

## Phase 5: Real-device verification criteria

- [ ] 5.1 Repeat each case with bounded attempts.
- [ ] 5.2 Require `>80%` definitive `PASS` rate for success.
- [ ] 5.3 Count `WARN` as non-success and keep its diagnostic domain visible.
- [ ] 5.4 Verify cases independently, not only as one batch.

## Phase 6: Documentation and archive outputs

- [ ] 6.1 Produce semantic delta spec, design, tasks and real-device verification report.
- [ ] 6.2 Archive Phase 3 decisions into main OpenSpec specs after verification.
- [ ] 6.3 Preserve evidence paths and acceptance rationale for cases 15–20.
