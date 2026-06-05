# Skill Registry — Biblioteca (based on Readest)

Generated: 2026-05-29

## User Skills

| Skill | Trigger | Source |
|-------|---------|--------|
| branch-pr | Creating pull requests, opening PRs, preparing changes for review | ~/.config/opencode/skills/branch-pr |
| chained-pr | PRs exceeding 400 changed lines, stacked PRs, reviewable slices | ~/.config/opencode/skills/chained-pr |
| cognitive-doc-design | Writing guides, READMEs, RFCs, onboarding docs, architecture docs | ~/.config/opencode/skills/cognitive-doc-design |
| comment-writer | Drafting feedback, review comments, maintainer replies, Slack messages | ~/.config/opencode/skills/comment-writer |
| go-testing | Go tests, teatest, testing coverage | ~/.config/opencode/skills/go-testing |
| issue-creation | Creating GitHub issues, reporting bugs, requesting features | ~/.config/opencode/skills/issue-creation |
| judgment-day | "judgment day", adversarial review, dual review | ~/.config/opencode/skills/judgment-day |
| skill-creator | Creating new skills, adding agent instructions, documenting patterns | ~/.config/opencode/skills/skill-creator |
| work-unit-commits | Implementing changes, preparing commits, splitting PRs | ~/.config/opencode/skills/work-unit-commits |

## Project Conventions

| File | Purpose |
|------|---------|
| CONTRIBUTING.md | Contribution flow, prerequisites, setup commands, and issue-first contribution guidance |
| apps/readest-app/AGENTS.md | Project overview, commands, source layout, git worktrees, implementation scope, design/i18n/e-ink pointers |
| apps/readest-app/DESIGN.md | Design system: Adwaita-aligned, e-ink-first, cross-platform UI vocabulary and anti-patterns |
| apps/readest-app/docs/architecture.md | System architecture, runtime boundaries, server/client/native process split |
| apps/readest-app/docs/code-layout.md | Directory classification and source layout for app, services, routes, tests, and Tauri code |
| apps/readest-app/docs/testing.md | Testing tiers: Vitest unit/browser/Tauri integration and WDIO E2E |
| apps/readest-app/docs/i18n.md | Internationalization conventions and extraction workflow |
| apps/readest-app/docs/safe-area-insets.md | Safe-area inset handling for mobile and edge UI |
| apps/readest-app/docs/view-settings.md | Reader/view settings documentation |
| apps/readest-app/.claude/rules/test-first.md | Test-first development: write failing unit test before implementation |
| apps/readest-app/.claude/rules/typescript.md | TypeScript conventions: strict mode, no `any`, ES2022 target |
| apps/readest-app/.claude/rules/verification.md | Done conditions for tests, lint, Lua, Rust fmt, and clippy checks |
| apps/readest-app/.claude/memory/MEMORY.md | Project memory index for persistent agent context |

## Compact Rules

### branch-pr
- Follow issue-first PR workflow.
- Inspect branch status and full diff before opening a PR.
- Return the PR URL after creation.

### chained-pr
- Split oversized changes into independently reviewable slices.
- Keep review burden within the 400-line cognitive budget.
- Preserve clear base-branch chaining for stacked PRs.

### cognitive-doc-design
- Use progressive disclosure: overview → details → reference.
- Prefer tables, checklists, signposts, and recognition over recall.
- Chunk sections to reduce reader load.

### comment-writer
- Write warm, direct, human comments.
- Be specific and constructive.
- Avoid slang and unnecessary ceremony.

### go-testing
- Use table-driven tests and clear fixtures.
- Apply Bubbletea/teatest patterns when relevant.
- Keep tests focused on behavior.

### issue-creation
- Create issues before implementation where workflow requires it.
- Use clear bug/feature structure with acceptance criteria.
- Include labels/project metadata when available.

### judgment-day
- Run two blind adversarial reviews of the same target.
- Synthesize findings, fix, and re-judge.
- Escalate after two unsuccessful iterations.

### skill-creator
- Create skills following the Agent Skills structure.
- Document triggers, workflow, constraints, and examples.
- Keep reusable guidance concise and discoverable.

### work-unit-commits
- Commit deliverable work units, not file-type batches.
- Keep code, tests, and docs for one behavior together.
- Each commit should be independently reviewable.
