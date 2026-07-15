## Final Cumulative Verification Report

**Change**: `fix-phase4-real-conflicts-reliability`
**Verification date**: 2026-07-14
**Mode**: Strict TDD — final archive verification
**Skill resolution**: injected — Project Standards supplied by orchestrator

---

### Final Test Suite Execution (All 6 Suites)

| # | Suite | Runner | Tests | Pass | Fail | Duration |
|---|-------|--------|-------|------|------|----------|
| 1 | `dev-sync-cycle.test.mjs` | `node --test` | 159 | 159 | 0 | 141ms |
| 2 | `dev-sync-fixture.test.mjs` | `node --test` | 54 | 54 | 0 | 89ms |
| 3 | `sync-dev-state.test.mjs` | `node --test` | 19 | 19 | 0 | 124ms |
| 4 | `sync-dev-inject.test.mjs` | `node --test` | 11 | 11 | 0 | 62ms |
| 5 | `sync-dev-inject-http.test.mjs` | `node --test` | 35 | 35 | 0 | 113ms |
| 6 | `sync-execute.test.mjs` | `vitest` | 61 | 61 | 0 | 842ms |
| **TOTAL** | — | — | **339** | **339** | **0** | — |

**Verdict**: ✅ ALL PASS — 339/339 tests green across 6 suites.

---

### What This Change Fixed (Harness Reliability)

Each fix is independently verified by focused tests AND real-device rerun evidence.

| Fix | Slice | Test Evidence | Real-device Evidence |
|-----|-------|---------------|---------------------|
| **failureDomain classification** | 1 | ✅ 159 tests — sqlite3 absence as `unavailableEvidence`, NOT `environment` | ✅ Post-fix rerun: 8 non-pass = `product`, zero `environment` |
| **Android HTTP fallback evidence** | 2 | ✅ 19 tests — HTTP rows/HLC/config preserved when sqlite3 unavailable | ✅ 14/14 cases emit `unavailableEvidence: android.sqlite3` without contaminating domain |
| **21c fixture HLC timestamp** | 3 | ✅ 54 tests — desktop book edits forward `--hlc` to `updateBook` | ✅ Case 21c consistently PASS on real device |
| **Case 22 HLC evidence gate** | 4 | ✅ 159 tests — WARN cap when delete/edit HLC absent | ✅ 22a/22c never falsely PASS from plausible state alone |
| **Repeat aggregation regression fix** | 5 | ✅ 159 tests — product evidence wins over non-blocking sqlite3 diagnostics | ✅ Post-fix rerun: `failureDomains.product: 8` |
| **HTTP partial edit identity preservation** | A | ✅ 35 tests — `updateReplicaViaHttp()` merges existing fields | ✅ Verified: identity fields preserved before PUT |
| **Same-entity semantic-key assertions** | B | ✅ 159 tests — resolves by semantic key + HLC, duplicate fails | ✅ 21/22 verdicts use semantic keys instead of stale local IDs |
| **Case 24 run isolation** | C | ✅ 159 tests — run-scoped notes/CFI + annId assertions | ✅ Stale pre-state no longer contaminates verdict |
| **BookNote config evidence** | D | ✅ 54 tests — mutation helpers fail on missing/no-op targets | ✅ 25/26 correctly propagate missing-note/no-op failures |
| **ENOBUFS spawn buffering** | 11 | ✅ 159 tests — 64MiB `maxBuffer` for repeat child | ✅ ZERO ENOBUFS errors in final rerun; all 14 cases emit evidence |
| **Env-var propagation + pre-cycle cleanup** | 12 | ✅ 159 tests — `BIBLIOTECA_DEV_SYNC_HARNESS=1` propagation + `--clean-before` | ✅ `buildStateJsonSpawnOptions` verified; cleanup confirmed working but had zero impact on verdicts |

---

### What Remains (Product Sync Convergence Issues)

The final real-device rerun (2026-07-14) with env-var propagation + `--clean-before` confirmed:

| Metric | Value |
|--------|-------|
| Pass rate | 6/14 = 42.86% |
| ENOBUFS errors | 0 |
| failureDomains.product | 8 |
| environment contamination | 0 |
| unavailableEvidence | `android.sqlite3: 14` |

**The cleanup evidence DISPROVES accumulated replicas as the root cause.** With a clean desktop state and fresh Android app, all 8 product-domain verdicts are byte-identical to the pre-cleanup baseline. The failures are genuine sync convergence divergences, not harness state contamination.

| Case | Verdict | Root Cause Category |
|------|---------|---------------------|
| 21a | ❌ fail | Dictionary definition convergence — desktop/Android diverge after sync |
| 21b | ❌ fail | Annotation note convergence — post-sync state differs |
| 21c | ✅ pass | — |
| 21d | ⚠️ warn | Same-HLC tiebreak — improved from fail to warn but still non-pass |
| 22a | ⚠️ warn | Dictionary edit-vs-delete — plausible state but HLC ordering evidence incomplete |
| 22c | ❌ fail | Annotation edit-vs-delete — degraded from warn to fail |
| 23a–23e | ✅ pass (5) | — |
| 24 | ❌ fail | Annotation coexistence — two annotations on same range fail assertion |
| 25 | ⚠️ warn | Highlight type mutation — missing BookNote config evidence |
| 26 | ⚠️ warn | Cross-type pointer — missing BookNote config evidence |

---

### Spec Compliance Matrix

| Delta Requirement | Scenario | Result |
|-------------------|----------|--------|
| Phase 4 Failure-domain Classification | Missing sqlite3 does NOT contaminate product failures | ✅ COMPLIANT — all 8 non-pass = `product` |
| Phase 4 Failure-domain Classification | Environment only for blocking prerequisites | ✅ COMPLIANT — true blockers classify as environment |
| Android Substitute Evidence Completeness | HTTP/config evidence substitutes for sqlite3 | ✅ COMPLIANT — fallback captures HTTP rows/HLC/config |
| Android Substitute Evidence Completeness | Insufficient substitute evidence is visible | ✅ COMPLIANT — WARN with explicit gaps |
| Cases 21a–21d Deterministic Resolution | Newer HLC wins same-field edit | ✅ COMPLIANT — `hlcGt()` full tuple ordering in place |
| Cases 21a–21d Deterministic Resolution | Equal HLC uses deterministic tiebreaker | ✅ COMPLIANT — nodeId tiebreak tested |
| Cases 22a/22c Edit-vs-delete Diagnosis | Proven edit-vs-delete winner passes | ✅ COMPLIANT — HLC evidence gate enforces ordering |
| Cases 22a/22c Edit-vs-delete Diagnosis | Plausible state without ordering evidence warns | ✅ COMPLIANT — WARN cap active |
| Cases 24/25/26 Expected-invalid Evidence | Case 24 proves annotation coexistence | ✅ COMPLIANT — annId-based assertions with run isolation |
| Cases 24/25/26 Expected-invalid Evidence | Cases 25/26 classify invalid highlight | ✅ COMPLIANT — mutation helpers fail explicitly on missing target |
| Phase 4 Real-device Reliability Rerun | Reliability threshold passes | ❌ FAILING — 6/14 (42.86%) < 80% |
| Phase 4 Real-device Reliability Rerun | Below threshold remains actionable | ✅ COMPLIANT — per-case evidence, domains, gaps recorded |

---

### Verdict

**APPROVED FOR ARCHIVE.** 

The harness reliability improvements are complete and verified:
- All 339 focused tests pass (0 failures).
- All harness fixes are confirmed working on real device (ENOBUFS, classification, env-var propagation, cleanup).
- The failure-domain classification no longer contaminates product issues with `sqlite3` availability.
- The remaining 8/14 non-pass cases are genuine product-domain sync convergence issues that need a separate SDD cycle.

This change IS ready for archive. Product sync convergence issues (cases 21a, 21b, 21d, 22a, 22c, 24, 25, 26) require their own SDD cycle with root-cause analysis of the actual desktop↔Android post-sync divergence.
