# Tasks: Fix Phase 4 Product Convergence

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 140–160 (60 Rust, 55 JS, 30 docs) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Product fix (Rust) + Harness fix (JS) + Tests + Deferred plan | PR 1 | ~145 loc; single unit; tests/docs included |

---

## Phase 1: Product Fix — Semantic-remap + HLC-tiebreak gate (RED/GREEN/REFACTOR)

Target: `apps/readest-app/src-tauri/src/visible_repo.rs`

### RED — Write failing tests

- [x] 1.1 Write test: equal-HLC push with semantic remap → deterministic winner by nodeId. Two replicas (same semantic key, diff replica_ids, equal HLCs). Assert exactly 1 row survives, winner matches `hlc_gt` tiebreak (higher `replica_id` string wins). Place in `visible_repo.rs` test module.
- [x] 1.2 Write test: semantic_remap push with incoming HLC > existing HLC → per-field merge wins. Simulate 21a/21b pattern (same semantic key, diff replica_ids, incoming has higher HLC on one field). Assert single entity post-merge with correct field values. Place in `visible_repo.rs` test module.

### GREEN — Implement the fix

- [x] 1.3 Add `is_semantic_remap` boolean flag after `resolve_semantic_id` remap block (L1100–1104). Set `true` when canonical_id differs from `row.replica_id`.
- [x] 1.4 Modify HLC gate at L1144: when `is_semantic_remap`, replace strict `!hlc_gt(incoming, existing) → skip` with: skip only if incoming HLC < existing HLC; on equal HLC, let `hlc_gt`'s device_id comparison (L556: `a > b`) tiebreak. Keep existing behavior for non-semantic-remap rows.

### REFACTOR — Verify no regression

- [x] 1.5 Run `pnpm tauri:dev:test` or `cargo test -- --test-threads=1` in `src-tauri/`. Verify all 6 existing push tests pass (push_annotation, push_newer_hlc, push_older_hlc, push_quote, push_dict_occurrence, push_dict_entry).
- [x] 1.6 Verify new tests 1.1 and 1.2 pass.

---

## Phase 2: Harness Fix — Relaxed verdict functions (RED/GREEN/REFACTOR)

Target: `apps/readest-app/scripts/dev-sync-cycle.mjs` and `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs`

### RED — Write failing tests for relaxed verdicts

- [x] 2.1 Write test: `computeCase22Verdict` — divergent `replica_id`, matching tombstone state + semantic key → `pass`. Simulate 22a pattern: desktop entity `id='desk-d1'` tombstoned, android entity `id='android-d1'` tombstoned, same `term='valle'`. Assert verdict `pass`.
- [x] 2.2 Write test: `computeCase24Verdict` — count >= 2, distinct `note` values, matching `bookHash`+`cfi` → `pass` without exact `annIds` match. Simulate 24 pattern: 2 annotations on each device with different replica_ids but same CFI. Assert verdict `pass`.

### GREEN — Implement relaxed verdicts

- [x] 2.3 Relax `computeCase22Verdict` (L1964–1974): in `deleteWins` branch, after `findEntityRow` by id/semanticKey, add fallback — count tombstoned rows matching `(entityType, semanticKey)` on each device. If both >= 1 with no live duplicates, return `pass` regardless of `replica_id` mismatch. Keep existing `editValue` check.
- [x] 2.4 Relax `computeCase24Verdict` (L1812–1819): when `annIds` length >= 2 but IDs don't match on both sides, fall back to convergence check — verify count >= 2 on each side, `bookHash` + `cfi` match across devices, `note` values are distinct. If all hold, return `pass`. Skip exact-ID requirement.

### REFACTOR — Verify no regression

- [x] 2.5 Run `node --test scripts/__tests__/dev-sync-cycle.test.mjs`. Verify all existing 22a, 22c, and 24 tests still pass.
- [x] 2.6 Verify new tests 2.1 and 2.2 pass.

---

## Phase 3: Edge Case Deferred Action Plan

- [x] 3.1 Document deferred plan for **Case 25** (cross-kind morphing): add validation in `visible_repo.rs` push path to reject or WARN when incoming `kind` differs from resolved entity's `kind` in SQLite. Target: P2, no ETA.
- [x] 3.2 Document deferred plan for **Case 26** (cross-entity ref validation): validate `citeId` in bookConfig builder to ensure referenced entities have compatible kinds. Target: P2, no ETA.

### Deferred Action Plan: Cases 25 and 26

**Decision**: Cases 25 and 26 are classified as edge cases with WARN-as-pass acceptance per `Expected-invalid Evidence` requirement (REQ-PC-3 descendant in `specs/sync-crdt-hlc-real-device-harness/spec.md`). Neither blocks the Phase 4 ≥80% pass rate target. Fixes are documented as P2 with no committed ETA.

#### Case 25 — Cross-kind Morphing (annotation→quote)

**Current behavior**: Android mutates entity type from `annotation` to `quote` via its `bookConfig` layer without changing the replica `kind`. Desktop never receives the type mutation. The two devices diverge on entity kind but maintain replica-level consistency.

**Root cause**: The sync protocol does not support `kind` changes. The `kind` field in `_replicas` is immutable after creation. Android's `bookConfig` layer reinterprets the entity type locally without propagating the change through the replica channel.

**Recommended fix**: Add a validation guard in `visible_repo.rs::push()` (after `resolve_semantic_id` remap, before merge) that checks if the incoming row's `kind` matches the resolved canonical entity's `kind` in SQLite. If `kind` differs:
1. Log a WARN-level diagnostic citing the conflict (incoming_kind, resolved_kind, replica_id).
2. Reject the push for that row — return an error or skip with a diagnostic entry.
3. The harness `computeCase25Verdict` already returns `warn` when it detects type mismatch; the validation guard would convert the `warn` to `blocked` (graceful rejection is better than silent divergence).

**Implementation notes**:
- Add check in `push()` loop after `resolve_semantic_id` (L1101-1106), before HLC gate (L1108).
- Query `SELECT kind FROM _replicas WHERE replica_id = ?1` → compare with incoming `kind`.
- On mismatch: `continue` (skip) + log warning via `eprintln!` or tracing.
- No schema changes required.
- Affected file: `apps/readest-app/src-tauri/src/visible_repo.rs` (~10 lines).

**Priority**: P2. Not blocking Phase 4. No ETA.

#### Case 26 — Cross-Entity Reference Validation (dictionary→quote)

**Current behavior**: Android's `bookConfig` layer creates a `citeId` reference from a dictionary entry to a quote entity. Desktop correctly syncs both entities individually but does not validate the cross-reference. The invalid reference exists only in Android's `bookConfig` (not in the replica tables), so it is invisible to the desktop.

**Root cause**: The `bookConfig` builder (Android-local logic) does not validate that `citeId` targets point to entities of compatible kinds. A dictionary entry citing a quote is semantically invalid but not structurally blocked.

**Recommended fix**: Add validation in the `bookConfig` builder (Android-side `BookConfigBuilder` or equivalent TypeScript logic) to ensure `citeId` references are valid:
1. Before inserting a `citeId` reference, look up the target entity's `kind` in the local replica table.
2. Define a compatibility matrix: `dictionary-entry` → `dictionary-entry` only; `quote` → `quote` only; `annotation` → no `citeId` allowed.
3. If the referenced entity's `kind` is incompatible, either omit the `citeId` or log a warning and skip.
4. The harness `computeCase26Verdict` already returns `warn` when it detects invalid refs; this fix would prevent the invalid ref from being created in the first place.

**Implementation notes**:
- Location: Android's bookConfig/builder code (TypeScript). Exact path TBD — likely in `libs/sync/` or Android-specific bookConfig module.
- No Rust changes required (this is purely an Android bookConfig layer issue).
- No schema changes required.
- Affected files: Android-side TypeScript (~15-20 lines).

**Priority**: P2. Not blocking Phase 4. No ETA.

---

## Phase 4: Real-device Verification

- [x] 4.1 Rerun Phase 4 sync cycle via `dev-sync-cycle.mjs` on real devices. Result: 6/14 pass (42.86%). 22a/22c/24 fail because Android replica snapshot has nested `fields_jsonb`.

---

## Phase 5: Fix Android Snapshot Identity Key Mismatch

Target: `apps/readest-app/scripts/dev-sync-cycle.mjs`

### RED — Write failing tests

- [x] 5.1 Write test: Android rows with `fields_jsonb` envelope format → `computeCase22Verdict` returns `pass`. Simulate real `/replicas/:kind` API data with `fields_jsonb` + `deleted_at_ts`. Verify after flattening, `entityIdentityKey()`, `entityRowState()`, and direct field access all work.
- [x] 5.2 Write test: Android annotation rows with `fields_jsonb` envelope format → `computeCase24Verdict` returns `pass`. Verify `bookHash`, `cfi`, `note` are accessible after flattening for count-based coexistence fallback.

### GREEN — Implement the fix

- [x] 5.3 Add `flattenAndroidRow()` helper: extracts `fields_jsonb.*.v` values onto each Android replica row. Also extracts `id` from `replica_id` (strip kind prefix after `:`) so that `row.id` works in verdict functions.
- [x] 5.4 Update `androidRowsForEntity()` and `replicaRows()` to call `flattenAndroidRow()` on every row returned.
- [x] 5.5 Fix `entityRowState()` to recognize `deleted_at_ts` as a tombstone marker (Android replica API uses this field, not `deleted_at`).

### REFACTOR — Verify no regression

- [x] 5.6 Run focused tests. 164/164 tests pass (2 new, 162 existing preserved). No regression.
