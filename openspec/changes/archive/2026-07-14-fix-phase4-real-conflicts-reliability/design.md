# Design: Fix Phase 4 Real Conflicts Reliability

## Technical Approach

Stabilize Phase 4 by separating diagnostic truth from assertion truth. First, classify repeat failures with explicit `failureDomain` and unavailable-evidence metadata in `dev-sync-cycle.mjs`; second, make Android evidence usable without device `sqlite3` via existing HTTP state capture in `sync-dev-state.mjs`; third, fix only proven 21a–21d convergence defects with strict TDD in `sync-execute.mjs` or fixture/assert code.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Model `sqlite3` absence as `evidenceUnavailable`, not `environment` failure | Keep regex classifying every `sqlite3` warning as environment | Missing row evidence is a capture degradation; product convergence can still fail and must remain visible. |
| Use Android HTTP replica/config APIs as fallback evidence | Require adb `sqlite3`; skip Android evidence | `/replicas/:kind`, `/books/index`, and `/books/:hash/config` already exist and are testable without device shell SQLite. |
| Fix 21a–21d only after failing focused tests | Patch HLC paths directly from real-device symptoms | Prevents harness edits from masking actual sync bugs; tests must prove stale LWW, missing field timestamps, or deterministic tiebreak failure first. |
| Treat 22b as BLOCKED and 22/24/25/26 by evidence matrix | Force all WARN to PASS/FAIL | Spec says quotes are immutable and config/HLC absence caps verdict at WARN; reliability denominator still includes non-success. |

## Data Flow

```
repeat run -> child cycle JSON -> normalize attempt
  -> classify failureDomain + unavailableEvidence
  -> reliability report

state capture -> adb sqlite attempt
  -> if sqlite unavailable: HTTP replicas/config/index
  -> case verdict uses evidence completeness gates
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Modify | Refine `classifyReliabilityFailure()` into product/harness/environment/unknown with `failureDomain`, `failureReason`, `unavailableEvidence`; special-case `22b` as `blocked`, not generic warn. |
| `apps/readest-app/scripts/sync-dev-state.mjs` | Modify | Expand Android HTTP fallback rows to include row payloads/HLC/deleted flags where API exposes them; keep `config.json` BookNote capture for desktop and Android. |
| `apps/readest-app/scripts/sync-execute.mjs` | Modify only if tests fail | Investigate 21a–21d HLC/merge paths: `rowToReplica()`, `hlcGt()`, `mergeRemoteBookMetadata()`, replica pull/push filtering. |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Modify | Add RED tests for `sqlite3` degradation not globally classifying attempts as environment, and for 22/24/25/26 verdict caps. |
| `apps/readest-app/scripts/__tests__/sync-dev-state.test.mjs` | Modify | Add RED tests for Android fallback row/config evidence without sqlite3. |
| `apps/readest-app/scripts/__tests__/sync-execute.test.mjs` | Modify | Add 21a–21d failing tests before any merge fix. |

## Interfaces / Contracts

`failureDomain`: `product | harness | environment | unknown`.  
`unavailableEvidence[]`: evidence paths unavailable without converting the whole attempt to environment.  
`caseVerdict`: `pass | fail | warn | blocked | ambiguous`, where `blocked` is explicit for 22b and excluded only when reporting case applicability, not hidden from raw evidence.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Failure classifier and verdict caps | Node tests with nested child JSON including sqlite3 unavailable + product mismatches. |
| Unit | Android fallback evidence | Mock `fetchJson`/`runAdb`: sqlite3 fails, HTTP replicas/config succeed. |
| Unit | 21a–21d convergence | RED tests for dictionary definition, annotation note, book title HLC, same-HLC nodeId tiebreak before code changes. |
| Real device | Reliability recovery | Bounded repeat over Phase 4 case refs, preserving per-case evidence paths and cleanup/preflight evidence. |

## Masking Prevention

Harness fixes MUST NOT change expected product outcomes. A harness change may only improve evidence/classification unless a failing product-level test names the merge defect. WARN cannot become PASS from fallback metadata alone; PASS requires the spec’s minimum evidence.

## Migration / Rollout

No migration required. Deliver stacked slices: diagnostics, fallback evidence, 21a–21d TDD fixes, real-device verification. Roll back the smallest slice that regresses evidence or sync behavior; keep Phase 4 non-passing until rerun proves >80%.

## Open Questions

- [ ] None blocking; real-device rerun may reveal product defects in 25/26 that require a follow-up change.
