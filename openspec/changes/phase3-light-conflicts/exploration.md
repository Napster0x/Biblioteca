# Exploration: phase3-light-conflicts

## Executive outcome

Phase 3 is ready for proposal/spec/design, but it must be framed as a **semantic conflict specification plus bounded harness capability work**, not as product implementation. The existing model already supports per-field HLC merge, tombstones, desktop↔Android replica transport, book tombstone ordering, semantic fixture injection, and basic semantic assertions; the missing work is the Phase 3 matrix: logical identity/dedupe rules, concurrent creation symmetry, range/group semantics, and evidence that proves no accidental collapse or stale resurrection.

## Current State

### Current domain model and invariants

| Area | Current model | Phase 3 implication |
|------|---------------|---------------------|
| Books | EPUB-backed library entries live in `Readest/Books/library.json`, keyed primarily by `hash`; sync compares timestamps and propagates tombstones via `/books/index`. | Case 15-like book concurrency should treat same hash as one logical book and use timestamp/HLC ordering for metadata and tombstones. |
| Dictionary entries | `dictionary_entries` are replicated as `dictionary-entry`; fields include `term`, `displayTerm`, `language`, `definition`, `imagePath`, `curiosity`, `enrichmentStatus`. | Same word concurrency needs explicit normalized identity and field policy. Current semantic-key dedupe exists only for dictionary entries. |
| Dictionary occurrences | `dictionary_occurrences` are immutable occurrence events with `entryId`, `bookHash`, `cfi`, selected/context text, and optional `highlightNoteId`. | Occurrences should generally coexist unless they are the same logical occurrence; entry dedupe must not drop distinct occurrences. |
| Quotes | `quotes` are replicated as `quote`; fields include `bookHash`, `cfi`, `text`, context, and `contentHash`. There is no quote comment/note field in the source definition. | Same quote/range dedupe is currently not equivalent to dictionary semantic-key dedupe and must be specified before implementation. |
| Annotations | `annotations.text` is immutable selected text; `annotations.note` is the editable user note; `style`/`color` also replicate. | Case 18 must only treat `note`/presentation fields as editable; selected text/range should not be silently rewritten. |
| BookNotes/highlights | Highlights are not SQL entities. They are `booknotes[]` inside each book `config.json`; semantic deletes soft-delete the BookNote and associated semantic row. | Range/group cases must include BookNote config evidence, not only SQL replica counts. |
| Replicas | `ReplicaRow` has `kind`, `replica_id`, field envelopes `{v,t,s}`, `deleted_at_ts`, `updated_at_ts`, and optional `reincarnation`. | Per-field HLC merge exists for same `replica_id`; different IDs for same logical data require explicit semantic identity. |
| HLC | Format is fixed-width string `${physicalMs:13-hex}-${counter:8-hex}-${deviceId}`; lexicographic order is used. | Tie/device ordering and causal ordering must be visible in evidence for concurrent edits. |

### Existing invariants from `casos_sync.md`

- Devices converge to the same logical state.
- Repeated sync is idempotent.
- Arrival order must not change final state.
- No logical duplicates unless the spec says they are separate entities.
- User semantic data survives book deletion.
- Tombstones and stale updates are respected.
- Highlights keep the correct semantic group.
- Conflict outcomes remain inspectable.

### Cases 15–20 source mapping

The Phase 3 roadmap summarized cases 15–20 as natural case buckets. The source document is more granular:

| Source section | Relevant cases | Phase 3 meaning |
|----------------|----------------|-----------------|
| §15 Highlights | 15.1 same range/group/data; 15.2 same range/group/different data; 15.3 same range/different groups; 15.4 overlapping ranges; 15.5 edited range; 15.6 group change; 15.7 invalid group pointer | Primary source for range/group semantics. |
| §16 Dictionary | 16.1 capitalization; 16.2 accents; 16.3 definitions; 16.4 same word from different books; 16.5 delete vs new occurrence; 16.6 deleted source book | Primary source for word identity, dedupe, and add/delete policy. |
| §17 Quotes | 17.1 same quote/book/range; 17.2 same text/different book; 17.3 edited quote vs original selected text; 17.4 deleted source book; 17.5 deleted quote vs highlight | Primary source for quote identity and source separation. |
| §18 Annotations | 18.1 creation; 18.2 concurrent note edits; 18.3 edit vs delete; 18.4 empty note; 18.5 deleted source book | Primary source for editable semantic note behavior. |
| §19 Mixed groups | 19.1–19.4 additive mixed groups; 19.5 book delete with mixed data | Primary source for coexistence across semantic groups. |
| §20 Ordering | 20.1–20.6 book/data arrival order, stale updates, tombstone ordering, interrupted sync retry | Primary source for out-of-order and idempotence assertions. |

### Existing harness capabilities

| Capability | Evidence in code/spec | Supports Phase 3? |
|------------|-----------------------|-------------------|
| Safe CLI toolbox | `dev:sync:doctor`, `state`, `cycle`, `fixture`, `assert`, `report` scripts. | Yes, as base workflow. |
| Real book prep and book sync | `dev-sync-prepare.mjs`, `sync-execute.mjs` book push/metadata/tombstone logic. | Yes for same-book and tombstone ordering. |
| Desktop and Android semantic injection | `dev-sync-fixture.mjs` supports `--dict`, `--quote`, `--note`, `--edit`, `--delete`, `--delete-book`, `--semantic-delete`; Android path uses HTTP replicas. | Partially: enough for entity creation/edit/delete, but not yet ergonomic for same-ID/same-logical-ID concurrent setup or BookNote range variants. |
| Replica transport | `sync-execute.mjs` pushes/pulls dictionary-entry, dictionary-occurrence, quote, annotation. | Yes. |
| Per-field merge and tombstones | Store `applyRemote*` functions merge by field HLC and compare `deleted_at_ts`. | Yes for same `replica_id`; insufficient for different IDs with same semantics unless dedupe is defined. |
| Semantic key dedupe | `sync-filter-standalone.mjs` computes `dictionary-entry` semantic key `normalizedTerm|normalizedLanguage`. | Partial: dictionary-entry only; no occurrence/quote/annotation/range semantic key. |
| Assertion engine | `assert-engine.mjs` checks convergence, duplicate logical rows, HLC newer-wins, tombstones, semantic groups, book-delete survival, idempotence. | Partial: logic exists but state snapshots must expose the exact rows, group, range, HLC, and repeated-run info Phase 3 needs. |
| BookNote evidence | State can fetch Android book config for semantic delete; cycle can PUT Android config. | Partial: not generalized into Phase 3 range/group assertions. |

## Affected Areas

- `casos_sync.md` — source of Phase 3 semantics for highlight, dictionary, quote, annotation, mixed-group, and ordering cases.
- `ideal_harness.md` — target harness model: composable CLI, realistic user data, evidence, no monolithic parser.
- `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` — current main spec; already covers Phase 2 transport/idempotence/tombstone capabilities and must receive Phase 3 deltas later.
- `apps/readest-app/scripts/dev-sync-fixture.mjs` — likely place for bounded fixture extensions for concurrent same-logical-data and range/group variants.
- `apps/readest-app/scripts/sync-execute.mjs` — direct sync executor; already handles semantic replica transport, book metadata/tombstones, and desktop apply.
- `apps/readest-app/scripts/sync-filter-standalone.mjs` and `src/services/sync/replicaFilter.ts` — existing dictionary semantic-key dedupe; Phase 3 may extend identity policy here or explicitly avoid broadening it.
- `apps/readest-app/scripts/assert-engine.mjs` — likely assertion extension point for Phase 3 matrix outcomes.
- `apps/readest-app/scripts/sync-dev-state.mjs` — evidence capture must expose enough BookNote/range/group state for Phase 3 PASS/WARN/FAIL.
- `apps/readest-app/src/store/dictionaryStore.ts`, `citasStore.ts`, `annotacionesStore.ts` — current in-app CRDT/HLC merge behavior; useful model for expected semantics but not to change during explore.
- `apps/readest-app/src/types/replica.ts`, `src/libs/replica/hlc.ts`, `src/libs/replica/factory.ts` — HLC/ReplicaRow contract.

## Approaches

1. **Semantic matrix first, then harness slices** — Define Phase 3 identity/merge/range/group semantics and a concurrency matrix before implementation.
   - Pros: prevents coding blind; aligns with roadmap; keeps review slices small; avoids treating accidental duplicates as success.
   - Cons: requires careful spec work before visible implementation progress.
   - Effort: Medium.

2. **Extend existing Phase 2 harness ad hoc per case** — Add direct fixtures/assertions for each case as they are implemented.
   - Pros: faster first test for a single case.
   - Cons: high risk of inconsistent semantics across cases; likely duplicates mirror/concurrency logic; harder to review.
   - Effort: Medium initially, High over the whole phase.

3. **Product merge redesign first** — Redesign identity/merge behavior in product stores and sync filters before harness coverage.
   - Pros: could solve real bugs if semantics were already known.
   - Cons: violates phase intent; no accepted spec; high regression risk across sync; too broad for auto-chain review budget.
   - Effort: High.

## Recommendation

Use **Approach 1: semantic matrix first, then harness slices**.

Proposal scope should be documentation/spec/design first, followed by stacked implementation slices if accepted:

| Slice | Intent | Suggested scope |
|-------|--------|-----------------|
| 1 | Identity exactness | Same book, same dictionary term, same quote/range exact cases. |
| 2 | Editable semantic fields | Dictionary definition and annotation note with fixed highlight/range. |
| 3 | Group/range coexistence | Same range different groups and overlapping ranges; prove no accidental collapse. |
| 4 | Ordering/idempotence | Stale update, tombstone, interrupted/retry, repeated sync. |

### Recommended proposal scope

Include:

- Define logical identity per entity: book hash; dictionary normalized term+language; dictionary occurrence source tuple; quote source tuple; annotation source tuple; BookNote id/reference/range tuple.
- Define when different IDs are deduped versus preserved.
- Define field-level merge policy: immutable fields, editable fields, presentation fields, and tombstone precedence.
- Define Phase 3 matrix: desktop-first, Android-first, concurrent A/B, repeated isolated execution.
- Define PASS/WARN/FAIL evidence minimums, including BookNote config evidence where range/group matters.
- Extend harness only with bounded fixture/assert/state capabilities needed for cases 15–20.

Out of scope:

- Builds, real-device runs, or automatic test execution in this phase.
- Product sync redesign unless later specs prove a product bug.
- Markdown scenario parser or monolithic runner.
- UI automation beyond existing safe fixture/HTTP/SQLite harness paths.
- Broad text-CRDT implementation for annotation notes; spec can mark manual conflict/history as future if needed.

## Risks

- **Dedupe identity risk**: current semantic dedupe exists for dictionary entries only. Quotes, annotations, occurrences, and BookNotes can still duplicate if different IDs represent the same logical data.
- **Semantic merging risk**: per-field HLC merge can overwrite whole semantic meaning if immutable/editable fields are not separated in the spec.
- **Range overlap risk**: same range different groups and overlapping ranges are legitimate coexistence cases; assertions must not collapse them into “duplicates.”
- **Stale/tombstone risk**: live updates can currently clear tombstones if their field HLC is newer; Phase 3 must state where add-wins/reactivation is allowed and where remove-wins/manual conflict is required.
- **BookNote evidence risk**: SQL replicas alone cannot prove highlight group/range correctness because BookNotes live in `config.json`.
- **Mirror coverage risk**: a separate mirror phase would duplicate work. The right shape is a concurrency/symmetry matrix inside each case.
- **HLC evidence risk**: fixture paths sometimes use numeric/`T${now}` timestamp shims; Phase 3 evidence must prove comparable HLC ordering where the verdict depends on HLC.

## Ready for Proposal

Yes. Tell the next phase to create a proposal for `phase3-light-conflicts` that scopes Phase 3 as semantic specs plus bounded harness support for cases 15–20, using a desktop-first / Android-first / concurrent / repeated-isolated matrix. It should explicitly require BookNote/range/group evidence and keep product changes out until a failing, specified case proves they are necessary.
