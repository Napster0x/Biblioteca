## Exploration: fix-android-clean-reinitialize-harness

### Current State
`dev-sync-reset.mjs` now uses `adb shell pm clear <package>` as the primary Android clean. That correctly removes app-private state, including `Readest/`, `shared_prefs/`, and WebView storage, but it also stops the Android app. `dev-sync-cycle.mjs --clean-android` has a restart path that force-stops, recreates `Readest/`, injects `settings.json`, starts `.MainActivity`, and waits only for `/health`. The blocking command was `dev:sync:reset -- --target all`, which does not reinitialize Android after `pm clear`, so the following Phase 2 preflight sees `/health`/`/books/manifest` unavailable and blocks before case semantics.

`dev-sync-doctor.mjs` already models the right readiness gates: Android package, process, ADB forward, `/health`, `/books/manifest`, and desktop health. It also checks replica endpoints, but `phase2.preflight` currently does not require `android.replicasApi`.

### Affected Areas
- `apps/readest-app/scripts/dev-sync-reset.mjs` — performs `pm clear` for `android-db` and `all`; currently returns immediately after clear.
- `apps/readest-app/scripts/dev-sync-cycle.mjs` — contains the most complete Android reinit sequence, but only for `--clean-android` legacy cycle flow and only waits for `/health`.
- `apps/readest-app/scripts/dev-sync-up.mjs` — starts/toggles Android and waits for `/health`; less strict than Phase 2 needs.
- `apps/readest-app/scripts/dev-sync-doctor.mjs` — owns readiness checks for `/health`, `/books/manifest`, and replica APIs.
- `apps/readest-app/scripts/sync-phase2-preflight.mjs` — blocks case execution unless `phase2.preflight` passes.
- `apps/readest-app/scripts/run-all-cases.mjs` — has a duplicated reset/restart path for older cases and misses `mkdir -p` before Android settings copy.
- `apps/readest-app/scripts/__tests__/dev-sync-doctor.test.mjs` and `phase2-preflight.test.mjs` — closest existing tests for readiness behavior; there is no focused reset/reinit unit test yet.

### Approaches
1. **Add reusable Android reinitializer and call it after reset** — Extract the cycle restart/injection/wait logic into a script-local or shared helper, then use it after `pm clear` for `android-db`/`all`.
   - Pros: fixes the exact blocker; removes reliance on users remembering `dev:sync:up`; testable with mocked command/fetch dependencies.
   - Cons: requires careful CLI output shape to keep reset consumers compatible.
   - Effort: Medium

2. **Teach preflight to auto-recover when Android is stopped** — If doctor/preflight sees absent process or failed health, start app and retry checks.
   - Pros: centralizes recovery near readiness gate.
   - Cons: preflight becomes state-mutating; harder to reason about safe diagnostics; violates the current doctor-as-checker pattern.
   - Effort: Medium

3. **Require callers to run `dev:sync:up` after reset** — Document and/or script the command sequence externally.
   - Pros: minimal code.
   - Cons: does not fix automatic CICLO clean; easy to forget; keeps all Phase 2 cases fragile.
   - Effort: Low

### Recommendation
Use Approach 1. Keep `pm clear` in `dev-sync-reset.mjs`, then re-inject Android `settings.json`, start the app, wait for `/health`, wait for `/books/manifest`, and verify replica endpoints before reporting Android clean ready. This makes the destructive clean command lifecycle-safe and keeps `sync-phase2-preflight.mjs` as a pure gate instead of a mutating recovery mechanism.

### Risks
- Restart can still fail if ADB forwarding is missing; the command should return a clear error rather than masking it.
- `/health` can pass before `/books/manifest` or replicas are ready; readiness must explicitly wait for each required API.
- Duplicated reinit logic across `dev-sync-cycle.mjs`, `dev-sync-up.mjs`, and `run-all-cases.mjs` can drift unless the fix introduces a small shared helper.
- `dev-sync-reset --target all` currently runs targets in parallel; Android reinit must not assume desktop reset has completed unless that dependency is made explicit.

### Ready for Proposal
Yes — propose a minimal harness lifecycle fix: reusable Android clean reinitialization after `pm clear`, stricter API readiness waits, and focused unit tests around command order and readiness failures.
