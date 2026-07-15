# Product Failures Analysis: fix-phase4-real-conflicts-reliability

## Executive summary

The repeat report `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783974667193-repeat.json` correctly shows reliability failure at **6/14 PASS = 42.86%** and no longer classifies all non-pass cases as environment. The remaining non-pass cases are actionable, but the JSON evidence does **not** support treating all of them as product sync bugs.

The strongest common root cause is that Phase 4 harness fixtures model "same entity" conflicts by creating separate desktop and Android IDs, then Android HTTP edits are sent as partial replica rows that null unspecified fields. That produces split/partial entities for 21a, 21b, 21d, and prevents 22a/22c assertions from finding the Android counterpart by the desktop local ID. Case 24 is additionally contaminated by stale fixed annotation content/range from prior runs. Cases 25/26 are capped by missing/stale BookNote `config.json` evidence.

## Evidence sources

- Repeat report: `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783974667193-repeat.json`
- Per-case reports: `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783974667230.json` through `/tmp/biblioteca-dev-sync/dev-sync-cycle-1783974740599.json`
- Harness case setup/verdicts: `apps/readest-app/scripts/dev-sync-cycle.mjs`
- Android HTTP fixture injection: `apps/readest-app/scripts/dev-sync-fixture.mjs`, `apps/readest-app/scripts/sync-dev-inject-http.mjs`
- Replica conversion / merge helpers: `apps/readest-app/scripts/sync-execute.mjs`
- Snapshot capture: `apps/readest-app/scripts/sync-dev-state.mjs`

## Findings by case

| Case | Observed verdict | Classification | Actionable root cause | Probable files to touch | RED tests needed |
|---|---:|---|---|---|---|
| 21a | fail | harness assertion/evidence bug | Setup creates desktop and Android dictionary entries with different IDs for a same-field conflict. Android HTTP edit sends only `{id, definition}` through `rowToReplica()`, so term/language/displayTerm become `null`. Post-state shows desktop has two new rows: a complete desktop row with `profound void`, plus a partial Android row with `definition=very deep chasm` and `term=null`; Android has only the partial row. Verdict searches by `term`, so Android winner is invisible. | `dev-sync-cycle.mjs`, `dev-sync-fixture.mjs`, `sync-dev-inject-http.mjs`, possibly `sync-execute.mjs` | A test where Android HTTP `--edit dictionary_entries:<id>:definition=x` preserves existing term/language/displayTerm or emits a field-delta replica; a case 21a verdict fixture proving same logical entity conflict converges without split partial rows. |
| 21b | fail | harness assertion/evidence bug | Same pattern for annotations. Desktop has complete row `text=selected`, `note=revised analysis`; Android edit creates/pushes a partial annotation row with `note=alternative interpretation` but `bookHash/cfi/text=null`. Verdict searches Android by `text=selected`, so the Android winner is invisible. | `dev-sync-cycle.mjs`, `dev-sync-fixture.mjs`, `sync-dev-inject-http.mjs`, possibly `sync-execute.mjs` | A test where Android HTTP `--edit annotations:<id>:note=x` preserves immutable `text`, `bookHash`, and `cfi`; a case 21b verdict fixture scoped by returned IDs/semantic key instead of stale `text=selected` rows. |
| 21d | fail | harness assertion/evidence bug | Same as 21a plus same-HLC tiebreak evidence is not actually measured. Post-state has complete desktop row `definition=fate` and partial Android row `definition=luck`, `term=null`; verdict cannot compare same logical entity or nodeId because the Android row lost identity fields. | `dev-sync-cycle.mjs`, `dev-sync-fixture.mjs`, `sync-dev-inject-http.mjs`, `sync-execute.mjs` | A test that constructs equal physical/counter HLCs with different node IDs and asserts deterministic winner over a single logical entity; a regression that partial HTTP edits do not null identity fields. |
| 24 | fail | harness assertion/evidence bug | The report expected two new annotations but saw only one new desktop annotation and no new Android annotation delta. The fixture reuses fixed `Idea A`/`Idea B` and the same CFI across runs; pre-state already contained older `Idea A`/`Idea B` Android rows. Android PUT/dedup therefore did not create a distinct observable row for this run, and desktop received only one new annotation. This is not enough to prove the product drops concurrent distinct annotations. | `dev-sync-cycle.mjs`, `dev-sync-fixture.mjs`, `sync-dev-inject-http.mjs`, tests in `dev-sync-cycle.test.mjs` | A test making case 24 note text/content unique per `runId` and asserting by the returned `annIds`; a RED report fixture with stale prior `Idea A/B` rows proving the current delta-count assertion falsely fails. |
| 22a | warn | harness assertion/evidence bug | The action expects desktop delete to win and reports the desktop `entityId`. Desktop row is tombstoned correctly, but Android was created with a different ID and the HTTP edit row is partial; `assertEntityState(entityType, desktopEntityId, postAndroid)` returns not-found. The warning is due to identity mismatch/evidence lookup, not proven product divergence. | `dev-sync-cycle.mjs`, `assert-engine.mjs`, `sync-dev-inject-http.mjs` | A RED case proving 22a cannot assert Android by desktop local ID when the setup created a different Android ID; either same replica ID must be seeded on both sides or assertion must use semantic key/returned pair IDs plus HLC evidence. |
| 22c | warn | harness assertion/evidence bug | Same as 22a for annotations. Desktop target annotation is tombstoned; Android counterpart uses a different ID and partial row semantics make lookup by desktop local ID unreliable. | `dev-sync-cycle.mjs`, `assert-engine.mjs`, `sync-dev-inject-http.mjs` | A RED case proving 22c should not pass/fail based on desktop local ID lookup on Android; require semantic-key or shared-ID evidence and preserve annotation identity fields during HTTP edits. |
| 25 | warn | harness assertion/evidence bug | Desktop `bookConfig` is absent. Android `bookConfig` exists but contains stale prior note `annotation-1783969559414-pmtcjt`, not the case 25 `noteId=annotation-1783974738191-e3s6tv`. `injectBookNoteMutation()` treats existing config as authoritative and mutates no matching note, yet returns OK. Current WARN is expected only because evidence is incomplete; the underlying actionable issue is no-op mutation evidence. | `dev-sync-fixture.mjs`, `sync-dev-state.mjs`, `dev-sync-cycle.mjs` | A RED test where `--booknote-mutate` fails or seeds/appends when `noteId` is absent, instead of returning OK; a verdict fixture proving missing desktop config caps at WARN with explicit missing evidence. |
| 26 | warn | harness assertion/evidence bug | Same stale/missing config pattern. Desktop `bookConfig` is absent; Android config still has the old quote note and no BookNote for `dict-entry-1783974743844-9o6thm`. `injectInvalidBookNoteRef()` mutates no matching note and returns OK, so verdict lacks evidence. | `dev-sync-fixture.mjs`, `sync-dev-state.mjs`, `dev-sync-cycle.mjs` | A RED test where `--booknote-invalid-ref` fails or creates targeted evidence when `noteId` is absent; a case 26 verdict fixture with stale Android config proving WARN is evidence-limited. |

## Root causes

1. **Partial Android HTTP edits null identity fields** — `updateReplicaViaHttp()` builds a full `ReplicaRow` from partial update data through `rowToReplica()`. Because `rowToReplica()` maps missing fields to `null`, field-only edits become partial entities with lost identity (`term`, `text`, `bookHash`, `cfi`, etc.). This explains 21a, 21b, 21d and contributes to 22a/22c.
2. **Same-entity conflict cases are seeded as different local IDs** — 21a/21b/21d/22a/22c create separate desktop and Android rows, then assertions often use only the desktop ID. That is not a valid same-entity conflict model unless the harness asserts by stable semantic key and preserves all identity fields.
3. **Case 24 fixture is not run-isolated** — fixed `Idea A`/`Idea B` plus fixed CFI collide with stale rows from earlier runs, so delta-count assertions can fail without proving product data loss.
4. **BookNote mutation fixtures allow no-op success** — 25/26 mutation helpers read an existing Android config, do not ensure the requested `noteId` is present, and return OK even when the mutation did not touch anything.
5. **Desktop BookConfig evidence is missing for injected highlights** — fixture-created annotations/dictionary entries do not reliably create desktop `Books/<hash>/config.json`, so BookNote verdicts are capped at WARN.

## Recommended slices

1. **Slice A — HTTP update semantics and identity preservation**
   - Fix Android HTTP `--edit` to preserve existing fields before converting to `ReplicaRow`, or introduce true field-delta update semantics.
   - Add RED tests for dictionary and annotation partial edits preserving identity fields.

2. **Slice B — Phase 4 same-entity fixture/assertion model**
   - For 21/22, either seed the same replica ID on both devices or assert by stable semantic key/paired IDs with explicit HLC evidence.
   - Add RED tests for 21a, 21b, 21d, 22a, and 22c using the exact real-report failure shape.

3. **Slice C — Case 24 isolation**
   - Make annotation text or CFI unique per run and assert by returned `annIds`, not fixed text/delta counts alone.
   - Add stale-prestate RED coverage to prevent false product FAIL.

4. **Slice D — BookNote config evidence for 25/26**
   - Mutation/invalid-ref helpers must fail, seed the requested note, or append targeted evidence when `noteId` is absent.
   - Capture/report missing desktop config explicitly; keep verdict WARN until both configs are observable.

5. **Slice E — Real-device rerun only after harness evidence is fixed**
   - Rerun Phase 4 and only then decide whether any remaining 21/22/24/25/26 failures are product sync bugs.

## Risks

- Treating 21a/21b/21d as product merge defects now risks fixing the wrong layer; the observed rows are malformed by the harness before product merge can be judged.
- Changing assertions from IDs to semantic keys can mask real duplicate-ID bugs if not paired with duplicate-row checks.
- Case 24 may still reveal a real product dedup bug after run-isolated evidence is added; current data is insufficient.
- Cases 25/26 are DISCOVER-style scenarios; spec language may need to keep WARN as acceptable when config evidence is missing, while failing no-op fixture mutation.
