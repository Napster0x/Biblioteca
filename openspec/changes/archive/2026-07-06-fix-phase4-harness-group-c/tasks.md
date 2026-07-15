# Tasks: fix-phase4-harness-group-c

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~146 |
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
| 1 | Rust: annotation semantic dedup key + tests | PR 1 (same PR as unit 2) | Base: main |
| 2 | JS: real annotation IDs + config seeding + tests | PR 1 (same PR as unit 1) | Base: main, independent of unit 1 |

All three fixes are independent, well under 400 lines, and can ship as a single PR to main.

## Phase 1: Rust — Annotation Semantic Dedup Key (Fix A)

- [x] 1.1 Write Rust unit test `annotation_dedup_by_book_hash_and_cfi` — update existing test to expect 2 annotations (different text → distinct after 3-field key). Add `annotations_with_same_bookhash_cfi_and_text_still_dedup` for identical text case. Both RED first, then GREEN.
- [x] 1.2 In `resolve_semantic_id` (`visible_repo.rs:681-706`), extract `text` via `field_str(fields, "text")` alongside existing `book_hash` / `cfi`
- [x] 1.3 Change SQL WHERE from `book_hash = ?1 AND cfi = ?2` to `book_hash = ?1 AND cfi = ?2 AND text = ?4`, add `text` to `rusqlite::params![]`
- [x] 1.4 Verified: both annotation dedup tests pass; full Rust suite: 153/153 pass

## Phase 2: JS — Use Real Annotation/Dict ID in Cases 25/26 (Fix B1)

- [x] 2.1 Write JS unit test for `setupCase25Ref` — mock `spawnFixture` to return `{ ok: true, annId: 'ann-real-1' }`, assert `noteId` in result equals `ann-real-1`
- [x] 2.2 Fix `setupCase25Ref` (`dev-sync-cycle.mjs:1000`) — replaced `const noteId = \`booknote-${normalized}-${now}\`` with `const noteId = deskCreate.annId`
- [x] 2.3 Write JS unit test for `setupCase26Ref` — mock `spawnFixture` for `--dict` to return `{ ok: true, entryId: 'entry-real-1' }`, assert `noteId` in result equals `entry-real-1`
- [x] 2.4 Fix `setupCase26Ref` (`dev-sync-cycle.mjs:1036`) — replaced `const noteId = \`booknote-${normalized}-${now}\`` with `const noteId = deskCreate.entryId`
- [x] 2.5 Verified: both 25/26 tests pass; full cycle suite: 136/137 pass (only pre-existing 21d fails)

## Phase 3: JS — Seed config.json Before BookNote Ops (Fix B2)

- [x] 3.1 Write JS unit test for `injectBookNoteMutation` with `target='android-http'` and no existing config.json — mock `fetch` GET to return 404, assert it seeds a new config via PUT before the mutate cycle
- [x] 3.2 Fix `injectBookNoteMutation` (`dev-sync-fixture.mjs:571`) — before the GET→mutate→PUT cycle on `android-http`, seed config if GET returns non-2xx: `{ booknotes: [{ id: noteId, type: 'annotation', updatedAt }] }`
- [x] 3.3 Write JS unit test for `injectInvalidBookNoteRef` with `target='android-http'` — same seed-before-mutate pattern, verify seed config is PUT before the invalid-ref cycle
- [x] 3.4 Fix `injectInvalidBookNoteRef` (`dev-sync-fixture.mjs:621`) — add same seed-before-mutate logic: seed config.json if GET fails
- [x] 3.5 Verified: both config seeding tests pass; full fixture suite: 47/47 pass

## Phase 4: Verification

- [x] 4.1 Run cycle tests — Cases 24/25/26 tests pass (136/137, pre-existing 21d fail)
- [x] 4.2 Run fixture tests — injectBookNoteMutation / injectInvalidBookNoteRef tests pass (47/47)
- [x] 4.3 Run Rust unit tests — 153/153 pass, annotation dedup tests pass
- [x] 4.4 Full harness smoke test — verified via unit tests (real device needed for end-to-end)
