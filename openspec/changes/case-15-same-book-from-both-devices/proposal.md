# Proposal: Case 15 — Same Book From Both Devices

## Intent

Prove same-EPUB import from both devices converges to one logical book — no duplicates, no data loss, no product code changes. Exploration confirmed this already works. This change verifies on real devices and documents the behavior.

## Scope

### In Scope
- 4-variant real-device run: Desktop-first, Android-first, Concurrent, Repeat
- Metadata convergence (both edit title offline → newer `updatedAt` wins)
- Same-hash dedup (same EPUB → 1 book) & same-title-different-hash negative (must NOT merge)
- Assertions via `assertCase15` + evidence capture

### Out of Scope
- Field-level HLC merge for books (aspirational, not needed for PASS)
- Adding `id` field to `Book` type (does not exist)
- Changes to sync/merge logic or Phase 3 delta spec

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: add Case 15-specific test scenarios, evidence assertions, and documentation of book merge behavior (hash-only identity, entity-level `updatedAt` convergence). Phase 3 delta spec already defines the requirements; this change implements the verification layer.

## Approach

| Step | Action |
|------|--------|
| 1 | Run `--case15 <hash>` for all 4 variants |
| 2 | Assert via `assertCase15` + new metadata assertions |
| 3 | Add same-title-different-hash negative test |
| 4 | Document `Book` identity model in evidence |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/assert-engine.mjs` | Modified | Add metadata-convergence and same-title-different-hash assertions |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modified (minor) | Ensure `--case15` covers metadata edit variant |
| `openspec/changes/case-15-same-book-from-both-devices/` | New | Evidence results and documentation |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Device run flakiness | Low | TLS + retry + HLC audit logging |
| Wrong-field assertion | Low | Entity-level `updatedAt`, not field-level |

## Rollback Plan

Revert assert-engine.mjs if assertions are flaky. No product code changed — rollback is safe.

## Dependencies

- Phase 3 harness and delta spec for Case 15
- Real devices with Testnet TLS or USB sync

## Success Criteria

- [ ] All 4 variants produce PASS
- [ ] `assertCase15` passes for same-hash dedup
- [ ] Metadata convergence passes (newer `updatedAt` wins)
- [ ] Same-title-different-hash negative passes (no false merge)
- [ ] Book identity model documented
