# Exploration: Fix Android Local Sync Lifecycle

## Current State

Android local sync is an embedded Rust `tiny_http` server started inside the Tauri app process. It binds to `127.0.0.1:{port}` and is intended to be reached from the desktop through `adb forward tcp:7878 tcp:7878`.

The server can start: the recent evidence shows `/health` and `/books/manifest` responded once after `adb shell am start -n io.github.Napster0x.biblioteca/.MainActivity`. The later failure mode is different: `dev:sync:doctor` saw repeated `adbd failed to connect to socket 'tcp:7878': Connection refused`, and `pidof io.github.Napster0x.biblioteca` became empty. That points first to Android app/process lifecycle, then to harness assumptions—not to Phase 2 business logic.

Key findings:

| Area | Finding | Confidence |
|---|---|---|
| Package id | `dev:android` does **not** pass `tauri-dev.conf.json`; generated Android Gradle uses `applicationId = "io.github.Napster0x.biblioteca"`. Current device has only `package:io.github.Napster0x.biblioteca` installed. `.dev` mismatch is unlikely for the active Android run. | High |
| Port binding | Server binds `127.0.0.1:7878`, which is correct for `adb forward`. `Connection refused` means no Android listener at that moment. | High |
| Auto-start | Android auto-start only reads `{app_data_dir}/Readest/settings.json` during app setup and starts only if `localSync.enabled === true`. If settings are missing/stale or app setup is not reached, the server is absent. | High |
| Process lifecycle | The HTTP listener is a background thread owned by the app process. There is no Android foreground service/manifest service keeping local sync alive outside the activity process. If the app exits, is swiped away, or is killed, the server disappears. | High |
| Diagnostics | `dev:sync:doctor` assumes a package, port, active forward, and already-running Android server. It does not clearly separate `process absent`, `toggle disabled`, `server not started`, and `endpoint slow`. | Medium |
| Logs | Captured logcat is too broad and mostly system noise. It does not include `[auto-start]` or `[local-sync]` lines, so the exact start/stop cause is not yet proven. | Medium |

## Affected Areas

- `apps/readest-app/src-tauri/src/lib.rs` — Android auto-start lives in setup lines 966-1033 and starts `SyncServer` from settings only once.
- `apps/readest-app/src-tauri/src/local_sync_server.rs` — owns the HTTP listener, bind address, health route, and server thread lifecycle.
- `apps/readest-app/scripts/sync-dev-env.mjs` — hard-codes default Android package `io.github.Napster0x.biblioteca` and server URL `http://localhost:7878`.
- `apps/readest-app/scripts/dev-sync-doctor.mjs` — checks Android run-as, health, manifest, replicas, forward, and toggle contradiction but lacks explicit process/lifecycle classification.
- `apps/readest-app/package.json` — `dev:android` uses base config, while desktop `dev:tauri` uses `.dev`; this asymmetry should be documented or made explicit.
- `apps/readest-app/docs/sync-dev-harness.md` — recovery docs assume the package id and server lifecycle but do not explain base vs `.dev` Android behavior.

## Approaches

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| A. Harden dev harness preflight | Teach doctor/up scripts to detect installed package, process presence, forward state, toggle/settings state, and classify failures before endpoint checks. | Fast; prevents misleading Phase 2 reruns; no native lifecycle risk. | Does not keep server alive; only improves diagnosis/recovery. | Medium |
| B. Make Android server lifecycle idempotent and observable | Add a small native lifecycle helper: explicit startup logs, idempotent `ensure_local_sync_server`, health verification after start, and clearer errors when settings/toggle prevent startup. | Fixes the likely server-start ambiguity; improves logcat evidence. | Still tied to app process; not durable in background. | Medium |
| C. Foreground service for local sync | Move/anchor the server under an Android foreground service while local sync is enabled. | Most robust if harness requires background stability. | Larger Android/Tauri integration, notification UX, permission behavior, and review scope. | High |
| D. Align dev package configuration | Either pass dev config to Android or document/prove Android dev intentionally uses base package; update env defaults accordingly. | Removes `.dev` confusion and run-as mistakes. | Not sufficient if lifecycle is the root cause. | Low |

## Recommendation

Proceed with a small chained fix, not a broad service rewrite yet:

1. **First slice: diagnostics and configuration clarity** — make the harness report `android.process`, installed package candidates, selected package, forward status, and `server refused` vs `server timeout`. Document that current `dev:android` uses base `io.github.Napster0x.biblioteca` unless Android dev config is explicitly changed.
2. **Second slice: Android lifecycle observability/start robustness** — refactor Android auto-start into an idempotent `ensure` path with structured logs and post-start health verification. Keep binding to `127.0.0.1` and avoid changing sync business routes.
3. **Defer foreground service** unless verification proves the app must remain stable while backgrounded or killed. That is architecturally bigger and should be a separate proposal/slice if required.

This is the right order because the current evidence proves the listener disappears, but not whether it disappears from toggle/settings, app start failure, explicit process exit, or OS kill. We should not pour concrete before surveying the ground.

## Risks

- Captured logcat did not include the app startup window with `[auto-start]`; root cause is likely but not fully proven.
- Android Rust changes are non-hot and require rebuild/redeploy after implementation; do not expect dev-server HMR to validate native fixes.
- A foreground service may be necessary if the test harness intentionally backgrounds Android, but that should not be the first move without proof.
- Doctor endpoint timeouts of 750ms may still produce false negatives on slow devices even after lifecycle fixes.

## Ready for Proposal

Yes. Tell the user the strongest hypothesis is **Android app/process lifecycle around the embedded local sync server**, with a secondary harness clarity issue around package/port assumptions. The proposal should target diagnostics + idempotent Android server startup first, and reserve foreground service work as an escalation if app foreground stability is insufficient.
