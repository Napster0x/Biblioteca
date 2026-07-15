## Exploration: fix-phase4-real-conflicts-reliability

### Current State
The real-device Phase 4 repeat run failed reliability at 5/14 passing because `warn` verdicts are counted as non-success and all 9 non-pass attempts were classified as `environment`. The JSON evidence shows two different classes of issues:

- Cases 21a–21d are real convergence failures: the post-sync state does not match the expected winning HLC value on both devices.
- Cases 24–26 are evidence-ceiling warnings caused by missing or incomplete `config.json`/BookNote capture, not definitive product failures.
- Cases 22a/22c look like likely harness evidence lookup limitations: desktop shows the expected tombstone, but Android state is captured through HTTP replica fallback and the verdict cannot find the target entity by local row ID.

Classification by case:

| Case | Verdict | Classification | Evidence-based reason |
|---|---:|---|---|
| 21a | fail | product sync bug candidate | Expected Android-winning definition `very deep chasm`; desktop retained `profound void`, Android replica rows did not expose the target term; desktop also had `deltaDesktopEntries=2`, indicating duplicate/partial entity creation. |
| 21b | fail | product sync bug candidate | Expected Android-winning annotation note `alternative interpretation`; desktop retained `revised analysis`, Android replica rows did not expose the target annotation by `text=selected`; `deltaDesktopAnns=2` indicates duplicate/partial annotation creation. |
| 21c | fail | product sync bug candidate | Expected Android-winning title `Android Title`; both desktop and Android ended at `Desktop Title`. This is a direct product-level LWW/HLC conflict failure unless the fixture injected timestamps incorrectly. |
| 21d | fail | product sync bug candidate + harness evidence gap | Same-HLC tiebreak should converge deterministically; desktop had `fate`, Android target term was not found, and `deltaDesktopEntries=2`. The harness cannot prove full HLC tuple/nodeId because Android sqlite3 is unavailable. |
| 22a | warn | harness limitation/bug | The action says delete wins. Desktop target row is tombstoned (`deleted_at=1783969527373`), but Android target entity is not found through `replica_id.endsWith(entityId)` against HTTP fallback rows. That prevents PASS despite supportive desktop evidence. |
| 22c | warn | harness limitation/bug | Same pattern as 22a: desktop target annotation is tombstoned (`deleted_at=1783969531560`), but Android target entity is not found through HTTP fallback rows. |
| 23a–23e | pass | not actionable | Concurrent creations passed despite repeated Android `bookConfig` 404 warnings, proving the core sync path and HTTP replica fallback were reachable. |
| 24 | warn | expected warn / evidence limitation | Two annotations were created on both sides (`deltaDesktopAnns=2`, `deltaAndroidAnns=2`), but desktop `bookConfig` is absent and Android `/books/<hash>/config` returned 404, so highlight coexistence cannot reach PASS per spec. |
| 25 | warn | expected warn / harness-product boundary | Android `bookConfig` exists but contains the mutated type (`type: quote`) while desktop `bookConfig` is absent. Current verdict returns WARN when either side config is missing, so this may hide a product type-integrity bug. Needs complete desktop config evidence before classification as product bug. |
| 26 | warn | expected warn / harness-product boundary | Android `bookConfig` exists but evidence is stale/incomplete: it still shows the previous case 25 note, not the case 26 `noteId`. Desktop `bookConfig` is absent. The warning is not actionable as product evidence until config capture targets the current note. |

Root-cause candidates:

1. **21a–21d fail** — product sync conflict-resolution candidates: same-field edits create duplicate/partial rows and/or fail to converge to the HLC winner. 21c is the clearest direct failure because both devices converge to the older desktop title instead of the Android title. 21d additionally needs better full-HLC/nodeId evidence because Android sqlite3 is unavailable and HTTP fallback does not expose enough row-level timestamp detail.
2. **22a/22c warn** — harness lookup limitation: desktop tombstones are visible, but Android HTTP fallback rows use replica IDs and/or omit the target local IDs in a way `assertEntityState` cannot match, yielding `not-found` and therefore WARN. This is not currently evidence of a product bug.
3. **24/25/26 warn** — config evidence limitation: Case 24 has entity convergence but no BookNote proof; Cases 25/26 are DISCOVER cases where verdicts intentionally cap at WARN when either side lacks `bookConfig`. Case 25 may still reveal a product bug (`type: quote` after mutation) once desktop config evidence is available. Case 26 evidence appears stale or mis-targeted.
4. **Config 404 recurrente** — Android `/books/32bb20d7452627491831bb64a8d0dd94/config` returns 404 for cases 21a–24 and 23a–23e, while `/books/index` still lists the book. This suggests the Android config endpoint depends on a filesystem `Books/<hash>/config.json` asset that was not present for the imported/synced book, even though book index evidence exists. It is an evidence-source gap, not enough by itself to prove sync failure.
5. **Why global `failure_domain=environment` although 23a–23e pass** — `classifyReliabilityFailure()` marks any non-pass attempt as `environment` when collected evidence text contains `sqlite3: inaccessible` or `sqlite3 ... not found`. Android sqlite3 is unavailable on every run, so all fail/warn attempts get labeled `environment` even when the actual acceptance verdict points to product failure or harness evidence limitation. Passing cases do not get a failure domain.

### Affected Areas
- `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783969505712-repeat.json` — aggregate reliability report; shows 5/14 pass and all non-pass attempts classified as environment.
- `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783969505749.json` through `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783969561003.json` — per-case evidence used for verdict classification.
- `apps/readest-app/scripts/dev-sync-cycle.mjs` — acceptance verdict logic and `classifyReliabilityFailure()`; classification is overly dominated by Android sqlite3 unavailability.
- `apps/readest-app/scripts/sync-dev-state.mjs` — desktop/Android `bookConfig` capture; missing desktop config and Android 404s cap highlight-related cases at WARN.
- `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` — Phase 4 verdict criteria require `_replicas`/HLC evidence for cases 21–22 and `config.json` BookNote evidence for cases 24–26.
- `casos_sync.md`, `ciclo_harness.md`, `ideal_harness.md` — define the expected real-device cycle and require WARN/BLOCKED when the harness cannot execute or observe a realistic action.

### Approaches
1. **Fix diagnostics and evidence classification first** — improve failure-domain classification and per-case evidence reporting before product fixes.
   - Pros: Prevents environment noise from masking product vs harness causes; small and reviewable.
   - Cons: Does not fix 21a–21d convergence itself.
   - Effort: Low

2. **Repair harness evidence gaps for Android row/config capture** — make Android HTTP fallback expose stable entity lookup data and make config seeding/capture deterministic for cases 24–26.
   - Pros: Converts ambiguous WARNs into actionable PASS/FAIL; aligns with `ideal_harness.md`.
   - Cons: Requires careful separation from product sync behavior so the harness does not paper over real bugs.
   - Effort: Medium

3. **Investigate/fix product conflict resolution for cases 21a–21d** — focus on same-field LWW/HLC merge behavior for dictionary entries, annotations, and book metadata.
   - Pros: Targets the actual failing acceptance cases.
   - Cons: Needs strict TDD in apply/verify; full real-device loop required after harness evidence is trustworthy.
   - Effort: Medium/High

### Recommendation
Proceed in stacked slices: first fix/report the harness reliability classification so failure domains reflect acceptance causes; second fix the 22/24/25/26 evidence limitations; third address product sync bugs for 21a–21d with focused tests and real-device reruns. This keeps the investigation honest: **do not call 21a–21d “environment” just because sqlite3 is missing on Android**; the verdict evidence shows concrete convergence failures.

### Risks
- Android sqlite3 unavailability means row-level evidence depends on HTTP replica fallback; missing fields can produce false WARNs.
- Desktop `bookConfig` was absent for BookNote-related cases, so cases 24–26 cannot reach definitive PASS and may hide or exaggerate product issues.
- State appears accumulated across cases despite cycle expectations; delta-based assertions mitigate this, but cleanup should be rechecked before trusting repeated reliability rates.
- Fixing harness seeding/capture can accidentally mask product bugs if it mutates state beyond realistic user actions.

### Ready for Proposal
Yes — propose a reliability-focused change split into: (1) failure-domain diagnostics, (2) harness evidence completeness for edit-vs-delete/config cases, and (3) product conflict-resolution fixes for 21a–21d only after evidence gaps are controlled.
