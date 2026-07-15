## Exploration: add-phase2-harness-capabilities

### Current State
The Phase 2 harness is already a composable real-device toolbox: desktop EPUB import writes `Readest/Books/library.json` and assets, fixtures create dictionary/quote/annotation SQLite rows, Android uses HTTP `PUT /replicas/:kind`, book sync uses `/books/index`, `/books/manifest`, and `/books/:hash/:asset`, and cycle commands use bounded subprocess/fetch timeouts. The remaining blocked Phase 2 cases map to explicit gaps rather than known CRDT failures.

Key findings:

| Gap | Current evidence | Feasibility |
|---|---|---|
| `9Ma` Android book metadata edit | `dev-sync-fixture.mjs` rejects `--target android-http --edit books:*` with “Book edit is only supported for desktop library.json” | High: local sync server already accepts `PUT /books/index`; add safe HTTP metadata update helper that reads/merges existing Android book entry and bumps `updatedAt`. |
| `13Ma` Android EPUB/book import/reimport | `dev-sync-prepare.mjs` imports desktop only; Android server already supports `PUT /books/index` and `PUT /books/:hash/book|cover|config` | High: reuse `prepare-engine.mjs` EPUB hashing/metadata, push Android assets + live library entry through existing endpoints. Same-hash reimport can be timestamp-ordered against tombstones. |
| `14*` / `14M*` semantic highlight delete | Current `--delete table:id` tombstones one replica row; BookNote lives in per-book `config.json` `booknotes[]`, not SQLite | Medium: safest harness tool should delete by semantic group, not raw highlight only: tombstone D/C/N rows plus occurrence/link rows and mark/remove matching BookNote in `config.json` on desktop or via Android book config endpoint. Requires robust lookup/evidence. |
| Reliability metric | Timeouts exist in cycle/state/trigger, but no repeated bounded success-rate runner | High: add a bounded repeat validator around specific cases with per-attempt evidence and success-rate calculation. |

### Affected Areas
- `apps/readest-app/scripts/dev-sync-fixture.mjs` — route new safe book metadata edits, Android book import/reimport, and semantic delete operations.
- `apps/readest-app/scripts/sync-dev-inject-http.mjs` — add HTTP helpers for Android book metadata patch, asset import/reimport, and config/highlight updates.
- `apps/readest-app/scripts/prepare-engine.mjs` — reuse/extend EPUB metadata/hash import logic without desktop-only assumptions.
- `apps/readest-app/scripts/sync-dev-state.mjs` — expose enough book/config/highlight evidence to prove Android and desktop semantic deletes.
- `apps/readest-app/scripts/sync-execute.mjs` — verify existing bidirectional book metadata/tombstone/reimport ordering remains compatible.
- `apps/readest-app/scripts/dev-sync-cycle.mjs` / `run-all-cases.mjs` — add bounded repeated validation and rerun blocked cases.
- `apps/readest-app/src-tauri/src/local_sync_server.rs` — likely no new product behavior needed; existing book index/assets/config endpoints are enough unless config patch semantics require a small dev-harness endpoint.
- `openspec/specs/sync-crdt-hlc-real-device-harness/spec.md` — existing harness capability spec should receive deltas for Android metadata/import, semantic delete, and reliability measurement.

### Approaches
1. **HTTP-first harness extensions** — Build missing Android capabilities on existing local sync server endpoints.
   - Pros: real-device path, no fragile UI automation, bounded HTTP diagnostics, aligns with current harness architecture.
   - Cons: needs careful merge/timestamp logic and config evidence.
   - Effort: Medium

2. **ADB filesystem mutation for Android** — Use `run-as` to edit Android files/DBs directly.
   - Pros: can modify private files even if HTTP lacks a patch endpoint.
   - Cons: less user-realistic, depends on `run-as`/sqlite/device tooling, weaker reliability on real devices.
   - Effort: Medium/High

3. **UI automation** — Drive Android app interactions.
   - Pros: closest to human behavior.
   - Cons: explicitly risky/unbounded for this harness, hard to diagnose, poor repeat reliability.
   - Effort: High

### Recommendation
Use Approach 1. Extend the harness as HTTP-first, bounded, evidence-rich commands: `android-http` book metadata edit via `/books/index`, Android import/reimport via `/books/index` + asset PUTs, and semantic delete as a high-level operation that tombstones the semantic row(s) and updates `config.json` BookNotes together. Fall back to guarded ADB reads only for diagnostics, not primary mutation.

Reliability should be measured as: for each unblocked capability/case, run N bounded attempts (recommend N=5 minimum per target case), count attempts that complete setup/action/sync/assert/cleanup with a definitive PASS, and require success rate `>= 80%`. BLOCKED/AMBIGUOUS/timeout count as non-success and must include failure-domain diagnostics.

### Risks
- BookNote shape may vary by highlight type; deleting by raw ID without semantic lookup could produce false PASS/FAIL.
- Android `/books/index` accepts whole entries; metadata patch must preserve unrelated fields and avoid stale timestamp resurrection.
- Same-hash reimport after tombstone depends on `createdAt`/`updatedAt` ordering; missing fields could make resurrection ambiguous.
- Repeated real-device validation can expose environment flakiness; reports must separate harness flake from product sync divergence.

### Ready for Proposal
Yes — propose harness-only capability work plus a bounded reliability validation layer. Product behavior changes should stay out of scope unless an existing endpoint cannot safely represent BookNote/config mutation.
