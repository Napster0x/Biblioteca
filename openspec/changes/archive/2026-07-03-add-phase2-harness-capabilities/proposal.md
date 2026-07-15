# Proposal: Add Phase 2 Harness Capabilities

## Intent

Unblock the remaining Phase 2 cases by adding missing harness capabilities, then prove they work with bounded real-device reliability (`>=80%` success). The goal is to reveal real PASS/FAIL outcomes, not to change product sync behavior.

## Scope

### In Scope
- Android book metadata edit for `9Ma` through safe HTTP book-index updates.
- Android EPUB/book import and same-hash reimport for `13Ma` using existing book index/assets endpoints.
- Desktop and Android semantic BookNote/highlight delete tooling for `14*` / `14M*`.
- Bounded repeated validation with evidence, success-rate calculation, timeouts, and failure diagnostics.

### Out of Scope
- Product sync redesign or UI automation.
- Automatic builds, redeploys, or unbounded commands.
- Changing CRDT semantics unless implementation proves an unavoidable product bug.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `sync-crdt-hlc-real-device-harness`: add Android metadata edit, Android import/reimport, semantic highlight delete, and reliability measurement requirements.

## Approach

Use HTTP-first harness extensions. Reuse `prepare-engine.mjs` for EPUB hash/metadata, `/books/index` and `/books/:hash/:asset` for Android book operations, and `/replicas/:kind` for semantic row tombstones. Implement semantic delete as one high-level harness action that updates BookNote config and D/C/N rows together with inspectable evidence.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Modified | Route new actions and validate safe fields/targets. |
| `apps/readest-app/scripts/sync-dev-inject-http.mjs` | Modified | Add Android book metadata/import/config helpers. |
| `apps/readest-app/scripts/prepare-engine.mjs` | Modified | Share EPUB import metadata for Android target. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modified | Capture book/config/highlight evidence. |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modified | Add bounded repeated validation/reporting. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| BookNote lookup is ambiguous | Med | Delete by semantic group with before/after evidence. |
| Real-device flakes reduce rate | Med | Count as non-success and classify failure domain. |
| Metadata update resurrects stale data | Low | Require timestamp ordering and preserve fields. |

## Rollback Plan

Revert harness script changes and delta specs. Existing Phase 2 cases return to BLOCKED; product data paths remain unchanged.

## Dependencies

- Running desktop app, Android app, ADB forwarding, and local sync server endpoints.

## Success Criteria

- [ ] `9Ma`, `13Ma`, `14a/b/c`, `14Ma/Mb/Mc` no longer report harness-capability BLOCKED.
- [ ] Repeated validation reports `>=80%` definitive PASS rate or actionable FAIL diagnostics.
- [ ] No command waits indefinitely; every attempt writes evidence.
