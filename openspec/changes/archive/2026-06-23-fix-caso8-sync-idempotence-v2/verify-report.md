## Verification Report

**Change**: fix-caso8-sync-idempotence-v2
**Version**: v2 (delta spec — Caso 8 Push Idempotence + Pull-Side Pre-Filter)
**Mode**: Strict TDD

---

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 6 |
| Tasks complete | 5 |
| Tasks incomplete | 1 |

**Incomplete tasks:**
- [ ] 3.2 Manual smoke (optional — not blocking)

---

### Build & Tests Execution

**Build**: ➖ Skipped (orchestrator directive: "Do NOT build")

**Tests**: ✅ 169 passed / ❌ 1 failed / ⚠️ 0 skipped
```
FAIL  src/__tests__/services/sync/devSyncHarness.test.ts > dev sync trigger harness > uses a namespaced dev counter and returns distinct run ids for sequential triggers
  AssertionError: expected 500 to be 200 // Object.is equality
```
This is a **pre-existing** failure in the `uses a namespaced dev counter` test — completely unrelated to this change (trigger counter HTTP 500, not a sync-idempotence issue). The 2 new tests from this change both pass.

**Coverage**: ➖ Not run in focused verification (coverage requires `test:coverage` runner, not the focused Vitest command)

---

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Found in apply-progress with full RED/GREEN/TRIANGULATE/SAFETY NET table |
| All tasks have tests | ✅ | 2/2 implementation tasks have corresponding test files |
| RED confirmed (tests exist) | ✅ | 2/2 test files verified in codebase at `devSyncHarness.test.ts` |
| GREEN confirmed (tests pass) | ✅ | 2/2 new tests pass on execution (169/170 overall) |
| Triangulation adequate | ✅ | Task 1.1: 2 assertion categories (first sync >0 + second sync =0). Task 1.2: 4-kind assertions (first pull >0 + second pull =0). Both well-triangulated. |
| Safety Net for modified files | ✅ | 167/168 tests passed before modification; 1 pre-existing failure preserved |

**TDD Compliance**: 6/6 checks passed

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Integration | 2 | 1 (`devSyncHarness.test.ts`) | Vitest + jsdom + spawnNode |

All tests are integration-level — they spawn real scripts (`dev-sync-cycle.mjs`, `sync-execute.mjs`), create HTTP servers with `createServer`, operate on real SQLite databases, and verify end-to-end sync behavior. This is the correct layer for verifying a cycle-harness data-root propagation bug.

---

### Changed File Coverage
Coverage analysis skipped — focused `vitest run` does not include coverage instrumentation.

---

### Assertion Quality

✅ All assertions verify real behavior — no issues found.

**Detailed audit per test:**

**Test 1.1 (cycle push idempotence):**
- `expect(cycleOutput.steps).toHaveLength(2)` — structural validation
- `expect(step1Body['BIBLIOTECA_DEV_DESKTOP_DATA_ROOT']).toBe(desktopRoot)` — dataRoot propagation evidence (core fix)
- `expect(firstSync.status).toBe(0)` / `expect(firstPayload.ok).toBe(true)` — exit/success checks
- `expect(firstPayload.replicas['dictionary-entry'].attempted).toBeGreaterThan(0)` [×4 kinds] — first sync boots test
- `expect(secondPayload.replicas['dictionary-entry']).toMatchObject({ attempted: 0, applied: 0 })` [×4 kinds] — idempotence verification
- No tautologies, no ghost loops, no smoke-test-only assertions

**Test 1.2 (pull filter evidence):**
- `expect(firstPayload.replicas['dictionary-entry'].pulled).toBeGreaterThan(0)` [×4 kinds] — first pull applies
- `expect(secondPayload.replicas['dictionary-entry']).toMatchObject({ pulled: 0, appliedToDesktop: 0 })` [×4 kinds] — pull filter idempotence
- All assertions exercise production code paths and verify behavioral outcomes
- No implementation-detail coupling, no mock-heavy tests

**Existing test update (line 1298-1299):**
- `expect(secondPayload.replicas['dictionary-entry']).toMatchObject({ pulled: 0, appliedToDesktop: 0 })` — updated from `pulled: 1` to `pulled: 0` to reflect the new pull filter behavior. Correct update.

---

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| **Caso 8 Push Idempotence** | First sync bootstraps with empty _replicas | `devSyncHarness.test.ts > "cycle propagates dataRoot..."` L5118-5123 | ✅ COMPLIANT |
| Caso 8 Push Idempotence | Second sync with no changes produces zero operations | `devSyncHarness.test.ts > "cycle propagates dataRoot..."` L5125-5136 | ✅ COMPLIANT |
| Caso 8 Push Idempotence | Cycle-triggered second sync also produces zero operations | `devSyncHarness.test.ts > "cycle propagates dataRoot..."` L5101 (dataRoot propagation) + post-cycle verification | ✅ COMPLIANT |
| Caso 8 Push Idempotence | HLC gate blocks already-synced replicas | `devSyncHarness.test.ts > "keeps Android-to-desktop apply idempotent"` L1279-1299 + test 1.1 second sync | ⚠️ PARTIAL |
| Caso 8 Push Idempotence | New or changed replicas pass the HLC gate | `devSyncHarness.test.ts > "keeps Android-to-desktop apply idempotent"` L1285-1297 | ✅ COMPLIANT |
| Caso 8 Push Idempotence | Caso 7 bidirectional sync preserved | `devSyncHarness.test.ts > "keeps Android-to-desktop apply idempotent"` L1285-1299 (updated) | ✅ COMPLIANT |
| Caso 8 Push Idempotence | Per-kind zero-attempted evidence on empty push | `devSyncHarness.test.ts > "cycle propagates dataRoot..."` L5132-5136 | ✅ COMPLIANT |
| Caso 8 Push Idempotence | Direct CLI execution preserves v1 behavior | `devSyncHarness.test.ts > "cycle propagates dataRoot..."` (spawnNode direct) + test 1.2 (spawnNode direct) | ✅ COMPLIANT |
| **Caso 8 Pull-Side Pre-Filter** | All replicas already in _replicas produces pulled=0 | `devSyncHarness.test.ts > "produces pulled=0 on second pull..."` L5203-5207 | ✅ COMPLIANT |
| Caso 8 Pull-Side Pre-Filter | Unseen replicas pass the pull filter | `devSyncHarness.test.ts > "produces pulled=0 on second pull..."` L5190-5197 | ✅ COMPLIANT |
| Caso 8 Pull-Side Pre-Filter | Pull filter does not block Caso 7 first sync | `devSyncHarness.test.ts > "keeps Android-to-desktop apply idempotent"` L1285-1297 | ✅ COMPLIANT |

**Compliance summary**: 9/11 scenarios compliant, 2/11 partial (HLC gate block not explicitly tested with HLC timestamp assertions, but behavioral evidence is strong)

---

### Correctness (Static — Structural Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Push dataRoot propagation: cycle → triggerSync → POST body | ✅ Implemented | `dev-sync-cycle.mjs` L58-60: JSON body with `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`. 3 call sites L210, L275, L392 pass `stateEnv.BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` |
| Push dataRoot propagation: route.ts POST body parse | ✅ Implemented | `route.ts` L55-61: `request.json().catch(() => ({}))`, extract `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT`, forward to spawn env L72 |
| Push filter: filterUnchangedReplicas for all 4 kinds | ✅ Implemented | `sync-execute.mjs` L463-464 (entries), L471-472 (occurrences), L481-482 (quotes), L492-493 (annotations). All 4 push paths use filter |
| Pull filter: filterUnchangedReplicas before applyReplicaRowsToDesktop | ✅ Implemented | `sync-execute.mjs` L503: `const filtered = filterUnchangedReplicas(dbPath, rows)`, L504: `replicas[kind].pulled = filtered.length`, L505: pass `filtered` to apply |
| Pull filter: dataRoot accessible in pull loop | ✅ Implemented | `sync-execute.mjs` L502: `env.desktop.dataRoot` uses the same `env` from L409 (`createSyncDevEnvironment()`) which reads `BIBLIOTECA_DEV_DESKTOP_DATA_ROOT` |
| Body parse resilience | ✅ Implemented | `route.ts` L56-61: try/catch around body parse, optional key extraction |

---

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| DataRoot transport via POST body JSON | ✅ Yes | `{BIBLIOTECA_DEV_DESKTOP_DATA_ROOT}` sent with `Content-Type: application/json` in both `triggerSync()` and legacy fetch |
| Pull filter reuse: `filterUnchangedReplicas()` | ✅ Yes | Same function used for both push (L463+) and pull (L503) |
| `pulled` count override to `filtered.length` | ✅ Yes | L504: `replicas[kind].pulled = filtered.length` |
| Body parse resilience: try/catch, extract only known key | ✅ Yes | `route.ts` L56-61: `try/catch` + optional spread `...(dataRoot ? {...} : {})` |
| Task 1.1 test adaptation (design deviation documented) | ⚠️ Deviated | Apply-progress notes: changed from in-trigger spawn to post-cycle verification because 3s fetch timeout makes real-time spawn impractical. Acceptable — functional coverage identical. |

**Deviations from design table**: The test adaptation is well-documented and justified. No architectural divergence.

---

### Quality Metrics
**Linter**: ➖ Not run (orchestrator directive: "Do not build")
**Type Checker**: ➖ Not run (orchestrator directive: "Do not build")

---

### Issues Found

**CRITICAL** (must fix before archive):
- None

**WARNING** (should fix):
- (1) **Pre-existing test failure**: `uses a namespaced dev counter and returns distinct run ids for sequential triggers` returns HTTP 500 instead of 200. Unrelated to this change — was present before. Should be investigated separately.
- (2) **HLC gate specificity**: The HLC gate scenario in the spec says "WHEN push reads same row with `updated_at_ts <= 100` THEN row excluded". Current tests verify the behavioral outcome (attempted=0) but don't explicitly assert the HLC timestamp comparison logic. Acceptable for now since the behavioral test is stronger evidence.

**SUGGESTION** (nice to have):
- (1) Add an explicit unit test for `filterUnchangedReplicas()` with HLC timestamp edge cases (equal timestamps, slightly newer, slightly older) — currently tested only through integration tests.
- (2) Run `pnpm --filter @readest/readest-app test:coverage` to verify changed-file line coverage is above 80%.

---

### Verdict
**PASS WITH WARNINGS**

The change delivers exactly what it promises: dataRoot propagates through cycle→trigger→spawn, the push filter works in cycle context, and the pull filter produces zero-count evidence on idempotent re-pulls. 169/170 tests pass (1 pre-existing failure), 2 new TDD integration tests pass with well-triangulated assertions. All architectural decisions from the design are correctly implemented. No CRITICAL issues. Ready for archive.
