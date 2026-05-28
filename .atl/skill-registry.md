# Skill Registry — Biblioteca (Readest)

Generated: 2026-05-28

## User Skills

| Skill | Trigger | Source |
|-------|---------|--------|
| go-testing | Go tests, teatest, testing coverage | ~/.config/opencode/skills/go-testing |
| branch-pr | Creating pull requests, opening PRs, preparing changes for review | ~/.config/opencode/skills/branch-pr |
| chained-pr | PRs exceeding 400 changed lines, stacked PRs, reviewable slices | ~/.config/opencode/skills/chained-pr |
| cognitive-doc-design | Writing guides, READMEs, RFCs, onboarding docs, architecture docs | ~/.config/opencode/skills/cognitive-doc-design |
| comment-writer | Drafting feedback, review comments, maintainer replies, Slack messages | ~/.config/opencode/skills/comment-writer |
| issue-creation | Creating GitHub issues, reporting bugs, requesting features | ~/.config/opencode/skills/issue-creation |
| judgment-day | "judgment day", adversarial review, dual review | ~/.config/opencode/skills/judgment-day |
| skill-creator | Creating new skills, adding agent instructions, documenting patterns | ~/.config/opencode/skills/skill-creator |
| work-unit-commits | Implementing changes, preparing commits, splitting PRs | ~/.config/opencode/skills/work-unit-commits |

## Project Conventions

| File | Purpose |
|------|---------|
| apps/readest-app/AGENTS.md | Project overview, commands, source layout, git worktrees, implementation scope rules |
| apps/readest-app/CLAUDE.md | Same content as AGENTS.md — project overview and agent workspace |
| apps/readest-app/DESIGN.md | Design system: Adwaita-aligned, e-ink-first, action vocabulary, surface hierarchy, anti-patterns |
| apps/readest-app/CONTRIBUTING.md | Contribution guidelines: setup, build, pull request workflow |
| apps/readest-app/.agents/rules/test-first.md | Test-first development: always write failing test before implementation |
| apps/readest-app/.agents/rules/typescript.md | TypeScript conventions and patterns |
| apps/readest-app/.agents/rules/verification.md | Verification workflow rules |
| apps/readest-app/.agents/memory/MEMORY.md | Project memory index — persistent agent context |
| apps/readest-app/docs/testing.md | Testing documentation: unit, browser, Tauri integration, E2E tiers |
| apps/readest-app/docs/architecture.md | Architecture documentation |
| apps/readest-app/docs/code-layout.md | Code layout documentation |
| apps/readest-app/docs/i18n.md | Internationalization patterns and conventions |
| apps/readest-app/docs/safe-area-insets.md | Safe area insets handling for mobile |
| apps/readest-app/docs/view-settings.md | View settings documentation |

## Compact Rules

### go-testing
- Go testing patterns for Gentleman.Dots, Bubbletea TUI
- Table-driven tests, teatest for TUI component testing
- Test helper utilities and test fixtures

### branch-pr
- Issue-first enforcement: PRs must reference existing issues
- PR creation workflow with proper branch naming
- Template-driven PR descriptions with changelog format

### chained-pr
- Split PRs exceeding 400 changed lines into ordered chain
- Each PR must be independently reviewable with clear scope
- Base branch chain for stacked PRs

### cognitive-doc-design
- Progressive disclosure: overview → details → reference
- Chunking: max 7±2 items per section
- Recognition over recall: use tables, checklists, signposts

### comment-writer
- Warm, direct, human tone — professional but approachable
- No slang, no emoji overuse
- Constructive feedback with specific references

### issue-creation
- Issue-first enforcement system
- Bug report and feature request templates
- Proper labeling and project assignment

### judgment-day
- Two independent blind judges review same target
- Synthesize findings, apply fixes, re-judge
- Max 2 iterations before escalation

### skill-creator
- Create new AI agent skills following Agent Skills spec
- Document patterns, conventions, workflows
- Frontmatter with name, description, trigger, license

### work-unit-commits
- Commits as deliverable work units, not file-type batches
- Tests and docs kept beside the code they verify
- Each commit is independently reviewable
