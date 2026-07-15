# Delta for sync-crdt-hlc-real-device-harness — fix-phase4-harness-group-c

## MODIFIED Requirements

### Requirement: Annotation Semantic Dedup Uses 3-Field Composite Key

`resolve_semantic_id` in `visible_repo.rs` for `"annotation"` kind MUST match by `book_hash + cfi + text` (3-field composite key), as defined in Phase 3 §1.4 lines 828-836. The SQL WHERE clause MUST include `AND text = ?4` alongside existing `book_hash = ?1 AND cfi = ?2`.
(Previously: 2-field key `book_hash + cfi` without `text`, causing different annotations sharing the same CFI range to be falsely deduped.)

#### Scenario: Distinct annotations on same CFI survive dedup

- GIVEN two annotation replicas with same `book_hash` and `cfi` but different `text` values
- WHEN `resolve_semantic_id` executes for `"annotation"` kind
- THEN the SQL WHERE clause is `book_hash = ?1 AND cfi = ?2 AND text = ?4 AND deleted_at IS NULL AND id != ?3`
- AND the function returns `None` (no match — entities are distinct)
- AND both annotations survive in the app table

#### Scenario: Identical annotations still dedup correctly

- GIVEN two annotation replicas with same `book_hash`, `cfi`, AND `text`
- WHEN `resolve_semantic_id` executes for `"annotation"` kind
- THEN the existing row is found via the 3-field key
- AND the function returns the canonical `replica_id` (correct dedup preserved)

### Requirement: BookNote Fixture Ops Use Real Entity IDs

`--booknote-mutate` and `--booknote-invalid-ref` in `dev-sync-cycle.mjs` MUST receive the real entity/highlight ID returned by the preceding fixture operation, not a fabricated `booknote-` string. For `--note` the real ID is `annId`; for `--dict` it is the entity ID from the fixture result.
(Previously: `setupCase25Ref` and `setupCase26Ref` used `const noteId = \`booknote-${normalized}-${now}\`` — a fabricated ID that never matches any real BookNote in config.json.)

#### Scenario: Case 25 uses real annId from --note fixture

- GIVEN `setupCase25Ref` creates an annotation via `--target desktop --note original`
- WHEN the annotation result is available as `deskCreate`
- THEN `noteId` MUST be `deskCreate.annId` (the real annotation entity ID)
- AND `--booknote-mutate` receives this real ID, not a fabricated string

#### Scenario: Case 26 uses real entity ID from --dict fixture

- GIVEN `setupCase26Ref` creates a dictionary entry via `--target desktop --dict <term>`
- WHEN the dictionary result is available as `deskCreate`
- THEN `noteId` MUST be the real entity/highlight ID from the fixture result
- AND `--booknote-invalid-ref` receives this real ID, not a fabricated string

## ADDED Requirements

### Requirement: Pre-seed Android config.json Before BookNote Fixture Ops

Before GETing config.json for `--booknote-mutate` or `--booknote-invalid-ref` on `android-http` in `dev-sync-fixture.mjs`, the harness MUST seed config.json with a `booknotes[]` entry for the target `noteId` if it does not exist. Missing config.json MUST NOT cause a false-negative failure.

#### Scenario: injectBookNoteMutation seeds missing config

- GIVEN Android has no `config.json` for the target book hash (no BookNotes exist yet)
- WHEN `injectBookNoteMutation` executes with target `android-http`
- THEN the harness PUTs a seeded config with `{ booknotes: [{ id: noteId, ... }] }` before the GET-mutate-PUT cycle
- AND the operation succeeds with `ok: true`

#### Scenario: injectInvalidBookNoteRef seeds missing config

- GIVEN Android has no `config.json` for the target book hash
- WHEN `injectInvalidBookNoteRef` executes with target `android-http`
- THEN the harness seeds config.json with the target BookNote before the GET-mutate-PUT cycle
- AND the operation succeeds with `ok: true`

#### Scenario: Existing config is not overwritten

- GIVEN Android already has `config.json` with existing `booknotes[]` for the book
- WHEN either booknote fixture op runs
- THEN the seed step is a no-op or merges without data loss
- AND existing BookNotes are preserved

## FILES AFFECTED

| File | Impact | Bug |
|------|--------|-----|
| `apps/readest-app/src-tauri/src/visible_repo.rs` | Modify `resolve_semantic_id` annotation SQL query | Bug 1 |
| `apps/readest-app/scripts/dev-sync-cycle.mjs` | Fix `setupCase25Ref` and `setupCase26Ref` to use real entity IDs | Bug 2a |
| `apps/readest-app/scripts/dev-sync-fixture.mjs` | Fix `injectBookNoteMutation` and `injectInvalidBookNoteRef` to seed config.json | Bug 2b |
| `apps/readest-app/scripts/__tests__/dev-sync-cycle.test.mjs` | Unit tests for all three fixes | Verification |
| `apps/readest-app/scripts/__tests__/dev-sync-fixture.test.mjs` | Unit tests for config seeding | Verification |
