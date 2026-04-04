[English](./README.md) | [简体中文](./README.zh-CN.md)

# RepoBrain

> Git-friendly repo memory for coding agents.

RepoBrain helps AI coding agents remember the parts of your repository that actually matter later: architecture decisions, known gotchas, repo-specific conventions, and reusable patterns.

It is not a generic chat memory platform. It does not try to save every conversation forever.
It is not model middleware either. It does not sit in front of Claude, Codex, or Cursor to proxy prompts.

The point is much simpler: stop re-explaining the same repo context every time a new coding-agent session starts.

## Hero

- Remember repo knowledge, not the whole chat log
- Store durable memory in `.brain/` as Markdown plus frontmatter
- Keep everything local-first, markdown-first, and Git-friendly
- Work with Claude Code, Codex, Cursor, and Copilot through thin adapters

## What It Already Solves

- repeated "how this repo works" setup at the start of every agent session
- repo-specific gotchas that agents keep rediscovering from code or failed runs
- reviewable long-lived knowledge that belongs next to the code, not in a hidden cloud memory
- task-known routing hints via `brain suggest-skills` and `invocation_plan`

## Proof Layer

- Executable demo proof: [docs/demo-proof.md](./docs/demo-proof.md)
- Generated demo assets: [docs/demo-assets/typescript-cli-proof/transcript.md](./docs/demo-assets/typescript-cli-proof/transcript.md)
- Evaluation cases: [docs/evaluation.md](./docs/evaluation.md)
- TypeScript CLI case study: [docs/case-studies/typescript-cli.md](./docs/case-studies/typescript-cli.md)
- Full-stack web case study: [docs/case-studies/full-stack-web.md](./docs/case-studies/full-stack-web.md)
- Release loop: [docs/release-checklist.md](./docs/release-checklist.md) and [docs/release-guide.md](./docs/release-guide.md)

## Demo GIF

Planned asset: `docs/demo.gif`

Until the GIF is recorded, use the real proof bundle first:

- [docs/demo-proof.md](./docs/demo-proof.md) for the runnable script
- [docs/demo-assets/typescript-cli-proof/transcript.md](./docs/demo-assets/typescript-cli-proof/transcript.md) for the real transcript
- [docs/demo-script.md](./docs/demo-script.md) for the recording storyboard

The recommended flow is simple:

1. Fix a real repo issue once.
2. Save the lesson as a reviewable repo memory.
3. Approve it.
4. Start a new session.
5. Run `brain inject`.
6. Route the task with `brain suggest-skills` if needed.
7. Watch the agent avoid the same mistake because the repo already remembers it.

## Quick Start

```bash
# After the first public npm release
npm install -g repobrain

brain setup
brain inject
```

Until the npm package is live, use the local development install:

```bash
npm install
npm run build
npm link
```

Before a public release, run `npm run smoke:package` and follow [docs/release-checklist.md](./docs/release-checklist.md).

For the proof bundle used in README screenshots and release prep:

```bash
npm run demo:proof
npm run eval:proof
```

Extract memory from a session summary:

```bash
cat session-summary.txt | brain extract
```

Extract memory from the latest commit context:

```bash
brain extract-commit
```

## How It Works

RepoBrain keeps the loop intentionally small:

1. You finish a coding session or make a meaningful commit.
2. RepoBrain extracts only long-lived repo knowledge.
3. Hook-based workflows can save new memories as reviewable candidates first.
4. Approved memories live in `.brain/` as readable Markdown files.
5. Before the next session, a session-start hook or `brain inject` builds a compact context block.

That means less repeated setup, fewer old mistakes, and fewer suggestions that ignore how the repo already works.

## Recommended Flow

The default workflow is intentionally asymmetric:

- `inject` should be automatic because it is read-only and low-risk
- `extract` should be reviewable by default because it writes durable repo knowledge

In practice, that means:

1. A session-start hook or `brain inject` loads active memories into the next session.
2. A session-end hook extracts candidate memories instead of promoting them immediately.
3. You review candidates with `brain review`.
4. You approve good candidates with `brain approve <id>`, `brain approve --safe`, or `brain approve --all`.
5. Only approved memories affect future `brain inject` output.

If you want a fully manual flow, set `extractMode: manual`. If you want immediate writes from hooks, set `extractMode: auto`.

## Workflow Modes

RepoBrain now treats workflow choice as a first-class setup decision instead of making you stitch together low-level flags by hand.

- `ultra-safe manual`
  Best for teams that want every extract, review, approval, and cleanup step to stay manual. RepoBrain still helps with `brain inject`, but setup skips the Git hook by default and uses `extractMode: manual`.
- `recommended semi-auto`
  Best for most repos and now the default for `brain init` and `brain setup`. Session start stays easy with `brain inject`, session end can queue reviewable candidates, and humans keep the final `review` / `approve` control.
- `automation-first`
  Best for teams already comfortable with RepoBrain. Clear low-risk extractions can go active automatically, `brain inject` can run cleanup first, and ambiguous items still stay reviewable instead of becoming a black box.

The practical loop for the default `recommended semi-auto` mode is:

1. Session start: `brain inject`
2. Session end: queue extract candidates
3. Review queue: `brain review`
4. Fast promotion pass: `brain approve --safe`
5. Manual edge cases: `brain approve <id>`
6. Hygiene pass when needed: `brain score` and `brain sweep --dry-run`

`brain status` and `brain next` are now the high-level dashboard commands. `status` shows the current mode plus pending reminders. `next` tells you the most natural next command so you do not have to remember whether review, reinforce, score, or sweep comes first.

## Knowledge History

Because RepoBrain stores durable knowledge in `.brain/`, the project can keep that knowledge under normal Git version control. That makes repo memory inspectable, reviewable, and reversible in the same place the code already lives.

A team that treats durable repo knowledge like code might end up with a history like this:

```bash
8f3c9b1 brain: add decision - standardize on Node 20 for hooks and CLI
91a42de brain: add convention - keep repo memory in type-based subdirectories
a7d19f4 brain: add gotcha - Express middleware must call next(err) instead of throw
b14ec0a brain: add convention - prefer API version routing under /v1
c2aa61e brain: add decision - keep migration files append-only to avoid schema drift
d5f0b87 brain: update - raise inject budget after adding architecture notes
e6c3a12 brain: add gotcha - mock Redis in integration tests to avoid flaky CI
f9ab44d brain: remove stale - old lint workaround after TypeScript upgrade
```

Over a couple of months, those commits create a readable knowledge timeline: new lessons are added, old assumptions are updated, and stale guidance can be removed instead of silently lingering in chat history. RepoBrain does not generate these commits for you today, but it is designed so extracted knowledge can be reviewed and committed with the rest of the repo.

**Repo knowledge stays in the codebase timeline, not trapped in a separate cloud memory silo.**

## Memory Types

RepoBrain focuses on four memory types in the current MVP:

- `decision`: architecture or implementation choices, plus why they were made
- `gotcha`: pitfalls, constraints, and "do not do X because Y"
- `convention`: repo-specific naming, structure, style, and workflow rules
- `pattern`: reusable implementation or workflow patterns that should be repeated in future sessions

This is the heart of the project. RepoBrain is built to preserve high-value repo knowledge, not general conversation history.

## Installation

### Requirements

- Node.js 20+
- npm

### npm install

Once the first public release is published, install RepoBrain globally with:

```bash
npm install -g repobrain
```

If the package is not published yet, use the local development flow below.

### Local development install

```bash
npm install
npm run build
```

If you want the `brain` command available globally:

```bash
npm link
```

If you prefer not to link globally, you can still run the CLI directly:

```bash
node dist/cli.js init
node dist/cli.js inject
```

## Integrations

RepoBrain keeps the product split into a stable core layer and thin agent adapters. All adapters consume the same `.brain` schema plus the same `brain inject` and `brain suggest-skills` outputs.

RepoBrain Core is intentionally local, lightweight, and deterministic. It does not embed any LLM API calls or act as a model middleware layer.

Core layer responsibilities:

- define and validate the `.brain/` Markdown plus frontmatter schema
- store durable repo memories in one Git-friendly location
- run deterministic rule-based review, dedupe, and supersede decisions locally
- own the baseline query and injection surfaces: `brain inject`, `brain review`, and `brain suggest-skills`
- rank and render compact session context through `brain inject`
- derive task-aware routing hints through `brain suggest-skills`

Adapter layer responsibilities:

- translate RepoBrain outputs into the target agent's preferred instruction format
- explain where `brain inject` and `brain suggest-skills` fit into that agent workflow
- extract durable knowledge candidates from richer agent workflows when needed
- provide optional structured review suggestions without replacing Core's local final decision
- stay thin enough that RepoBrain core remains the only durable knowledge model

### Why thin adapters, but stronger contracts

Thin adapters keep RepoBrain portable. Claude Code, Codex, Cursor, and Copilot all expose different instruction surfaces, but none of them should own repo memory, schema evolution, or final review decisions. That stays in Core.

Stronger contracts make those thin adapters reliable. Instead of "copy this template and improvise", RepoBrain now defines shared lifecycle contracts for:

- session start via `brain inject`
- task-known routing via `brain suggest-skills --format json` and `invocation_plan`
- session-end extraction via extract-candidate markdown or JSON
- failure reinforcement via reinforce-event markdown or JSON

This gives each adapter the same consumption and output semantics without turning the adapter layer into a heavy SDK.

Shared adapter docs and examples live in [integrations/README.md](./integrations/README.md).

### Claude Code

Claude support keeps the existing hook and plugin surface, while the adapter contract now documents:

- how Claude consumes inject at session start
- how Claude routes on `invocation_plan`
- how Claude emits extract candidates at session end
- how Claude falls back to `brain reinforce` when failures need reinforcement

Current files:

- `.claude-plugin/plugin.json`
- `.claude-plugin/mcp.json`
- `dist/hooks/session-start.js`
- `dist/hooks/session-end.js`
- `integrations/claude/SKILL.md`

### Codex

Codex support stays lightweight on purpose. It is a workflow amplifier, not a new product mode.

Install the Git hook:

```bash
sh scripts/setup-git-hooks.sh
```

Before a new Codex session:

```bash
brain inject
brain suggest-skills --format json --task "current task" --path src/example.ts
```

Templates and setup notes:

- `integrations/codex/SKILL.md`
- [.codex/INSTALL.md](./.codex/INSTALL.md)

### Cursor

Cursor support remains rules-first. Copy `integrations/cursor/repobrain.mdc` into `.cursor/rules/repobrain.mdc`, then use the shared contract examples for inject, invocation plans, extract candidates, and reinforce events.

### GitHub Copilot

Copilot support remains custom-instructions-first. Copy `integrations/copilot/copilot-instructions.md` into `.github/copilot-instructions.md` and keep RepoBrain as the shared memory core instead of creating Copilot-only repo notes.

### MCP Setup

RepoBrain can also run as a minimal MCP server for tools that support MCP over stdio.

Current scope:

- `brain_get_context`: return the same markdown context block as `brain inject`
- `brain_add_memory`: save a new durable memory into `.brain/`

Start the server locally with:

```bash
brain mcp
```

A Claude Desktop style config looks like this:

```json
{
  "mcpServers": {
    "repobrain": {
      "command": "node",
      "args": ["/absolute/path/to/RepoBrain/dist/mcp/server.js"]
    }
  }
}
```

RepoBrain keeps this MCP mode intentionally small. The CLI and markdown-first workflow are still the core product.

## 30-Minute Quickstart

This walkthrough is the fastest way to see the product loop on a real repo: initialize RepoBrain, capture one durable lesson, and inject it into the next session. Plan for about 25 to 30 minutes the first time through.

### Before You Start

Requirements:

- Node.js 20+
- npm

Use the local development flow so you can try RepoBrain before the public npm package is live:

```bash
npm install
npm run build
npm link
```

If you prefer not to link globally, replace `brain` in the commands below with `node dist/cli.js`.

### Step 1: Initialize

Create the local RepoBrain workspace in the current repository:

```bash
brain setup
```

`brain setup` is the fastest recommended entry point. It now defaults to the `recommended-semi-auto` workflow, writes steering rules for Claude Code and Codex, and when you run it from the Git root it also installs the lightweight `post-commit` hook for richer commit-context extraction.

If you only want the workspace without Git hook automation, `brain init` remains the lightweight entry point. It now uses the same workflow presets and steering-rule generation, but skips Git hook installation:

```text
已初始化 .brain/ 目录。
? 你使用哪个 AI 编码工具？（用于生成 steering rules）
1. Claude Code（生成 .claude/rules/brain-session.md）
2. Codex（补充 .codex/brain-session.md）
3. 两者都用
4. 跳过
```

Those generated Markdown files are plain-text workflow rules for your agent, so future sessions remember to run `brain inject`, extract reviewable candidates at session end, and keep approval in the loop at the right times.

Workflow preset examples:

```bash
brain init --workflow recommended-semi-auto
brain setup --workflow recommended-semi-auto
brain setup --workflow ultra-safe-manual
brain setup --workflow automation-first
```

After setup, `.brain/` should look like this:

```text
.brain/
├── config.yaml
├── errors.log
├── index.md
├── decisions/
├── gotchas/
├── conventions/
└── patterns/
```

The generated `config.yaml` starts small on purpose:

- `maxInjectTokens`: approximate token budget for `brain inject`
- `extractMode`: controls whether hooks stay manual, save candidates, or write active memories
- `workflowMode`: sets the default workflow preset and recommended command cadence
- `language`: preferred output language for extraction prompts

### Step 2: Capture Your First Memory

Use a realistic repo lesson instead of a toy example. In this walkthrough, the lesson is that ESLint's `no-unused-vars` can overlap with TypeScript's `noUnusedLocals` and create duplicate warnings.

Thin one-line notes are intentionally rejected by the deterministic reviewer. Use a concrete lesson with enough repo-specific detail to still help in a later session.

Create a session summary file:

```bash
cat > session-summary.txt <<'EOF'
gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
EOF
```

Extract durable repo knowledge from that summary:

```bash
cat session-summary.txt | brain extract
brain list
```

`brain extract` now runs a deterministic review pass before writing. The CLI prints `decision`, `target_memory_ids`, and `reason` for each extracted memory. `accept` keeps the current write behavior, `merge` and `supersede` are stored conservatively as `candidate` memories for follow-up, and `reject` entries are skipped.

The baseline reviewer is deterministic and explainable on purpose. Instead of a single threshold stack, it now uses a layered pipeline:

- filter non-comparable objects first (`type`, active status, scope comparability)
- build a structured evidence vector for identity, scope, title/summary/detail overlap, replacement wording, recency, and status/lineage
- classify the strongest internal relationship as `duplicate`, `additive_update`, `full_replacement`, `possible_split`, or `ambiguous_overlap`
- map that internal relationship back to the public Core decision: `accept`, `merge`, `supersede`, or `reject`

`same_scope` now means exact normalized scope identity. `overlapping_scope` means parent/child scope overlap after normalization, but not exact equality. `same_identity` is no longer just a title slug shortcut: it is derived from layered identity evidence, so wording changes can still merge while same-title memories in disjoint scopes stay separate. Programmatic integrations may attach optional external review input, but Core still validates that input shape and makes the final local decision itself.

### Built-in Local Extractor

When `BRAIN_EXTRACTOR_COMMAND` is unset, RepoBrain uses a fully local staged extractor:

- `preprocess -> chunk -> candidate detection -> type classification -> field completion -> quality scoring -> prescreen dedupe -> deterministic review`
- input shapes: normal session summaries, bullet-style fix logs, mixed Chinese/English notes, long-form retrospectives, and `brain extract-commit` commit context
- signals: explicit `decision:`-style prefixes plus keywords, rationale words, limitation and risk words, bullet structure, changed files, and repository paths
- metadata derivation: `tags`, `importance`, `area`, `files`, and `path_scope` are inferred from both text and path context
- rejection bias: low-information notes, debug noise, typo-only edits, and one-off action logs are filtered out before write review

Quality boundaries are still intentionally conservative. The local extractor is much better at rescuing useful memories from messy summaries than the old prefix-only heuristic, but it is not a general semantic reasoner. If a summary is ambiguous, omits the "why", or mixes multiple unrelated lessons into one paragraph, adding short causal wording still improves extraction quality.

You should now see a new memory under `.brain/gotchas/`. The exact filename will include the current date and a slugified title. A saved file will look similar to this:

```md
---
type: "gotcha"
title: "ESLint no-unused-vars conflicts with TypeScript noUnusedLocals"
summary: "ESLint no-unused-vars conflicts with TypeScript noUnusedLocals"
tags:
  - eslint
  - no-unused-vars
  - typescript
  - nounusedlocals
importance: "medium"
created: "2026-04-01"
updated: "2026-04-01"
date: "2026-04-01T12:34:56.000Z"
source: "session"
status: "active"
---

## GOTCHA

gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
```

The important frontmatter fields are:

- `type`: what kind of durable repo knowledge this is
- `importance`: how strongly it should compete for injection space
- `tags`: quick keywords that make the memory easier to scan and review later
- `score`: memory quality score from `0` to `100`, defaults to `60`
- `hit_count`: how many times the memory has been injected, defaults to `0`
- `last_used`: ISO timestamp for the latest injection, defaults to `null`
- `created_at`: ISO timestamp for when the memory was first created, defaults to the memory `date`
- `created`: date-only creation marker (`YYYY-MM-DD`), defaults to the date part of `created_at`
- `updated`: date-only freshness marker (`YYYY-MM-DD`), defaults to `created`
- `stale`: whether the memory has been marked stale in metadata, defaults to `false`
- `supersedes`: optional `.brain/`-relative file path for the older memory this entry replaces, defaults to `null`
- `superseded_by`: optional `.brain/`-relative file path for the newer memory that replaces this entry, defaults to `null`
- `version`: version number for the same decision lineage, defaults to `1`
- `related`: optional `.brain/`-relative file path list for related memories that do not replace this one, defaults to `[]`
- `origin`: optional origin marker for special write paths such as failure reinforcement
- `area`: optional functional area tag such as `auth`, `api`, `db`, `infra`, `ui`, `testing`, or `general`
- `files`: optional related file globs such as `src/auth/**`
- `expires`: optional expiry date used by short-lived `working` memories
- `status`: goal state such as `active`, `done`, or `stale`; workflow states like `candidate` and `superseded` still remain backward compatible when needed

### Skill Routing Fields

If you want a memory to help downstream agent or skill routing, add these optional frontmatter fields:

- `path_scope`: repo paths or file patterns that define where the memory is most relevant
- `recommended_skills`: skills that are usually a good fit for this memory
- `required_skills`: skills that must be considered when this memory applies
- `suppressed_skills`: skills that should be avoided for this memory
- `skill_trigger_paths`: repo paths or file patterns that suggest the memory is relevant
- `skill_trigger_tasks`: task phrases that suggest the memory is relevant
- `invocation_mode`: one of `required`, `prefer`, `optional`, or `suppress`
- `risk_level`: one of `high`, `medium`, or `low`

When these fields are omitted, RepoBrain keeps old entries compatible by defaulting each list to `[]`, `invocation_mode` to `optional`, `risk_level` to `low`, `score` to `60`, `hit_count` to `0`, `last_used` to `null`, `created_at` to the memory `date`, `created` to the date part of `created_at`, `updated` to `created`, `stale` to `false`, `supersedes` to `null`, `superseded_by` to `null`, `version` to `1`, `related` to `[]`, `files` to `[]`, `status` to `active` for `goal`, and `origin` to unset.

### Schema Best Practices

Keep most memories light. The common fields are:

- `type`, `title`, `summary`, `detail`, `importance`, `date`
- `tags`: use a short deduplicated keyword list
- `created_at`, `created`, `updated`: keep lifecycle metadata aligned, but let RepoBrain autofill them when possible
- `status`: mainly for `goal`, `candidate`, and lineage workflows

Treat these as advanced fields and only add them when they improve routing or maintenance:

- `path_scope`, `files`: use only when the memory is meaningfully scoped to part of the repo
- `recommended_skills`, `required_skills`, `suppressed_skills`
- `skill_trigger_paths`, `skill_trigger_tasks`, `invocation_mode`, `risk_level`
- `supersedes`, `superseded_by`, `related`, `version`
- `area`, `expires`, `origin`

Good habits:

- Prefer one clear scope over repeating the same paths in both `path_scope` and `files`
- Prefer a few stable tags over large keyword dumps
- Add skill metadata only when you can also explain when it should apply
- Let old memories stay minimal; RepoBrain now lints and normalizes missing modern metadata without forcing a one-time migration

Schema governance commands:

```bash
brain lint-memory
brain normalize-memory
```

`brain lint-memory` reports missing required fields, invalid enums, conflicting metadata, meaningless scope fields, and missing or duplicated skill metadata. `brain normalize-memory` safely autofills and rewrites compatible files by aligning `created` / `updated` / `created_at`, deduplicating and sorting `tags`, normalizing `path_scope` / `files`, and deduplicating skill lists. Files that still need manual fixes are reported but not rewritten.

Before:

```md
---
type: "pattern"
title: "Normalize metadata"
summary: "Keep frontmatter compact and consistent."
tags:
  - "zeta"
  - "alpha"
  - "alpha"
importance: "medium"
date: "2026-04-03T10:30:00.000Z"
created: "2026-04-01"
path_scope:
  - "./src/api//"
  - "."
  - "src/api"
files:
  - "src/api/user.ts"
  - ".\\src\\api\\user.ts"
recommended_skills:
  - "playwright"
  - "playwright"
---
```

After `brain normalize-memory`:

```md
---
type: "pattern"
title: "Normalize metadata"
summary: "Keep frontmatter compact and consistent."
tags:
  - "alpha"
  - "zeta"
importance: "medium"
score: 60
hit_count: 0
last_used: null
created_at: "2026-04-01T00:00:00.000Z"
created: "2026-04-01"
updated: "2026-04-01"
stale: false
supersedes: null
superseded_by: null
version: 1
date: "2026-04-03T10:30:00.000Z"
path_scope:
  - "src/api"
files:
  - "src/api/user.ts"
recommended_skills:
  - "playwright"
invocation_mode: "optional"
risk_level: "low"
---
```

Minimal example:

```md
---
type: "decision"
title: "Route browser test work through Playwright guidance"
summary: "Prefer Playwright-specific guidance for browser test debugging."
tags:
  - "playwright"
importance: "medium"
date: "2026-04-01T12:34:56.000Z"
path_scope:
  - "tests/e2e/"
recommended_skills:
  - "github:gh-fix-ci"
required_skills:
  - "playwright"
suppressed_skills:
skill_trigger_paths:
  - "tests/e2e/"
  - "playwright.config.ts"
skill_trigger_tasks:
  - "debug flaky browser tests"
invocation_mode: "prefer"
risk_level: "medium"
---

## DECISION

Use Playwright-oriented guidance first when the task touches browser test infrastructure.
```

### Suggest A Skill Shortlist

Once some memories carry routing metadata, you can ask RepoBrain to turn the current task and changed paths into a deterministic routing plan. The simplest usage only needs a task:

```bash
brain suggest-skills --task "fix refund bug"
```

When `--path` is omitted, the command auto-collects changed paths from `git diff --name-only HEAD`. If git context is unavailable (not inside a repo, no commits yet, etc.), task-only routing still works. Use explicit `--path` only when you want to override the auto-detected paths:

```bash
brain suggest-skills --task "debug flaky browser tests in CI" --path tests/e2e/login.spec.ts --path playwright.config.ts
```

The command only considers `active` memories. It matches the task against `skill_trigger_tasks`, matches each provided path against `skill_trigger_paths`, then produces:

- `matched_memories`: which memories matched and why
- `resolved_skills`: the per-skill resolution after applying local rules
- `conflicts`: deterministic conflict records, including local strategy outcomes for required-vs-suppressed collisions
- `invocation_plan`: a stable adapter-facing plan with `required`, `prefer_first`, `optional_fallback`, and `suppress` buckets, plus `blocked` and `human_review` when the local rules refuse to auto-resolve
- `path_source`: indicates where the paths came from — `"explicit"` (from `--path`), `"git_diff"` (auto-collected), or `"none"` (task-only routing)

Markdown stays the default human-readable output:

```bash
brain suggest-skills --task "debug flaky browser tests in CI"
```

JSON is available for agent adapters that want a stable machine contract:

```bash
brain suggest-skills --format json --task "debug flaky browser tests in CI"
# or
brain suggest-skills --json --task "debug flaky browser tests in CI"
```

Example JSON shape:

```json
{
  "contract_version": "repobrain.skill-plan.v1",
  "kind": "repobrain.skill_invocation_plan",
  "task": "debug flaky browser tests in CI",
  "paths": ["tests/e2e/login.spec.ts"],
  "path_source": "git_diff",
  "matched_memories": [],
  "resolved_skills": [],
  "conflicts": [],
  "invocation_plan": {
    "required": [],
    "prefer_first": [],
    "optional_fallback": [],
    "suppress": [],
    "blocked": [],
    "human_review": []
  }
}
```

If you already have the task description in a file or another command, you can also pipe it over stdin:

```bash
cat task.txt | brain suggest-skills --path src/cli.ts --path test/store.test.mjs
```

### Start A Session With One Routing Bundle

If your adapter wants one high-level entry point instead of calling `inject` and `suggest-skills` separately, use `brain route` or its alias `brain start`:

```bash
brain route --task "fix refund bug"
# or
brain start --task "fix refund bug"
```

This command:

- auto-collects changed paths from `git diff --name-only HEAD` when `--path` is omitted
- falls back to task-only routing when git context is unavailable
- reuses the existing `brain inject` context builder
- reuses the existing `brain suggest-skills --format json` routing logic
- returns one combined bundle for human readers or thin adapters

Markdown remains the default output. JSON is available for adapters:

```bash
brain route --task "fix refund bug" --format json
```

Example JSON shape:

```json
{
  "contract_version": "repobrain.task-routing-bundle.v1",
  "task": "fix refund bug",
  "paths": ["src/payments/refund.ts"],
  "path_source": "git_diff",
  "context_markdown": "# Project Brain: Repo Knowledge Context\n...",
  "skill_plan": {
    "required": ["refund-handler"],
    "prefer_first": [],
    "optional_fallback": [],
    "suppress": [],
    "blocked": [],
    "human_review": []
  },
  "resolved_skills": [],
  "conflicts": [],
  "warnings": [],
  "display_mode": "silent-ok"
}
```

`display_mode` is:

- `silent-ok` when routing can be consumed silently and the plan only needs normal slots such as `required`, `prefer_first`, or `optional_fallback`
- `needs-review` when RepoBrain finds `blocked`, `human_review`, or any required-vs-suppress conflict that should be surfaced explicitly

`warnings` stays empty for silent cases. When `display_mode` is `needs-review`, RepoBrain adds concise escalation summaries such as:

- `Routing blocked: prod-deploy.`
- `Human review required: migration-runner.`
- `Required/suppress conflict: playwright (required kept).`

### When To Use `inject` Vs `suggest-skills` Vs `invocation_plan`

Use `brain inject` when the agent needs a compact, durable repo context block before it starts coding. Use `brain suggest-skills` when you already know the task and want RepoBrain to narrow the execution workflow or tool choice. Consume the `invocation_plan` when an adapter already has the task context and needs a stable contract it can route on without re-interpreting prose.

- `brain inject`: best for session start, implementation planning, risky edits, and avoiding old repo-specific mistakes
- `brain suggest-skills`: best for turning task text plus changed paths into a local deterministic routing decision
- `invocation_plan`: best for Claude Code, Codex, or other thin adapters that should consume RepoBrain's routing result directly without letting Core execute the skill for them

The boundary stays strict:

- `brain inject` gives context
- `brain suggest-skills` resolves routing metadata into a plan
- the adapter decides whether, when, and how to invoke a skill from that plan

`brain inject` now behaves more like a task-understanding-driven context builder while keeping the same CLI surface. It still skips memories whose frontmatter sets `stale: true` or `superseded_by` to a newer `.brain/` file, prefixes versioned entries with `[Updated vN]` when `version >= 2`, warns on broken supersede back-links during inject, and atomically writes back a higher `hit_count` plus a fresh `last_used` date for injected memories.

The ranking model is split into explainable components instead of one opaque relevance score:

- `task phrase match`: phrase-level hits from `skill_trigger_tasks`
- `task keyword overlap`: overlap between task words and the memory title, summary, tags, and scoped text
- `module overlap`: overlap between `--module` input and the memory's module hints
- `path scope match`: direct matches from `--path` against `path_scope`
- `skill trigger path match`: direct matches from `--path` against `skill_trigger_paths`
- `git changed files match`: worktree-aware matches from `git diff --name-only HEAD` against `files`, `path_scope`, and area path hints
- `branch / tag hint`: branch-name tokens that line up with tags or the memory title
- `importance / risk / recency / hit_count` adjustments: persistent corrections that keep high-signal and risky memories competitive even before task-specific matches

Selection is also diversity-aware under the token budget: RepoBrain avoids letting near-duplicate memories consume the whole budget, prefers to keep different modules and risk surfaces represented, and still keeps active `goal` memories above the normal cutoff.

### Step 3: Inject And Verify

Start the next session with the repo knowledge you just captured:

```bash
brain inject
brain status
```

If you already know the task, you can still pass task context to help explain why a memory appeared:

```bash
brain inject --task "refactor config loading for the CLI" --path src/config.ts --path src/cli.ts --module cli
```

For higher-risk work, pass the risky area explicitly so RepoBrain can surface stricter gotchas and decisions first:

```bash
brain inject --task "fix refund transaction bug before release" --path src/payments/refund.ts --module payments --module ledger
```

Useful flags:

- `--no-context`: disable Git-context scoring and use the legacy ordering
- `--include-working`: include active `working` memories in the injected block
- `--explain`: append a scoring report as an HTML comment, including per-memory score components plus diversity-aware selection utility; `REPOBRAIN_DEBUG=1` or `DEBUG=repobrain:inject` enables the same report in debug mode

Active `goal` memories are always injected ahead of the normal token-budget cutoff.

The injected block remains compact and session-ready. The output will look like this:

```md
# Project Brain: Repo Knowledge Context

- [pattern | medium] Refactor CLI config loading through shared parse helpers
  CLI refactors should preserve parse helpers before touching command wiring.
  Scope: When refactoring config loading, keep parsing and command wiring decoupled. | tags: cli, config, refactor
  Why now: Task Phrase Match: refactor config loading; Module Overlap: cli, config
<!-- brain-inject-report
patterns/2026-04-01-refactor-cli-config-loading-through-shared-parse-090000000.md | total=124.6 | context=88 | priority=36.6 | utility=145.6 | diversity=+21 | redundancy=-0 | task_phrase_match=26 (refactor config loading) ; path_scope_match=24 (src/config/** -> src/config/loader.ts | src/cli.ts -> src/cli.ts) ; task_keyword_overlap=16 (refactor, config, loading, cli) ; module_overlap=12 (cli, config)
-->
```

Before / after selection behavior under the same budget:

```md
Before:
- Auth refactor must preserve token refresh boundary
- Auth refactor must preserve login fallback

After:
- Auth refactor must preserve token refresh boundary
- DB refactor must preserve transaction envelope
```

The new selection keeps broader task coverage instead of letting closely related memories from one module crowd out another risk surface.

Lineage example:

```md
---
type: "decision"
title: "Use the old deploy gate"
summary: "Legacy guidance kept only for history."
importance: "medium"
date: "2026-04-01T08:00:00.000Z"
superseded_by: "decisions/2026-04-01-use-the-new-deploy-gate-090000000.md"
version: 1
---

---
type: "decision"
title: "Use the new deploy gate"
summary: "Current guidance."
importance: "high"
date: "2026-04-01T09:00:00.000Z"
supersedes: "decisions/2026-04-01-use-the-old-deploy-gate-080000000.md"
version: 2
---
```

With that pair, `brain inject` only renders the newer memory, and the title line is prefixed as `[更新 v2] Use the new deploy gate`.

Paste that output at the start of a new Claude Code or Codex session, or wire it into your local session-start workflow. The goal is simple: the next agent run should see this repo-specific lesson before it suggests another duplicate lint configuration.

### Step 4: Build The Habit

The long-term habit is intentionally lightweight:

1. Finish a meaningful fix or discover a reusable repo lesson.
2. Write a short summary and run `brain extract`.
3. If the memory came from hooks, run `brain review` and approve the good candidates.
4. Before the next session, run `brain inject` or rely on the session-start hook.
5. Review `.brain/` changes the same way you review code.

Two commands cover most of the loop:

```bash
cat session-summary.txt | brain extract
brain inject
```

If the captured knowledge is good enough to keep with the codebase, commit the `.brain/` change along with the code change after review.

Total: ~25 min. What to try next -> [docs/demo-script.md](./docs/demo-script.md)

## Team Workflow

For team usage, the happy path is:

1. fix a real issue
2. run `brain extract`
3. review the new markdown under `.brain/`
4. run `brain share <memory-id>` or `brain share --all-active`
5. copy the suggested `git add` and `git commit` commands

The first version of `brain share` is intentionally conservative: it does not change Git state for you. It prints the exact next commands so the team can review memory changes the same way it reviews code.

See [docs/team-workflow.md](./docs/team-workflow.md) for the full workflow and `.brain/` tracking guidance.

For release prep and package validation, use [docs/release-checklist.md](./docs/release-checklist.md).

## CLI Reference

```bash
brain init
brain setup
brain extract < session-summary.txt
brain extract --type working < session-summary.txt
brain extract-commit
brain inject
brain list
brain list --type goal
brain list --goals
brain stats
brain goal done <keyword>
brain status
brain next
brain review
brain approve --safe
brain approve <memory-id>
brain dismiss <memory-id>
brain supersede <new-memory-file> <old-memory-file>
brain lineage
brain lineage <file>
brain audit-memory
brain reinforce --pending
brain reinforce < session-summary.txt
brain suggest-skills --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain suggest-skills --format json --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain share <memory-id>
brain share --all-active
brain mcp
```

### Commands

- `brain init`: create the `.brain/` workspace in the current repo, apply a workflow preset, and generate steering rules by default
- `brain setup`: initialize `.brain/`, apply a workflow preset, generate steering rules, and install the low-risk `post-commit` Git hook when run from the Git root
- `brain extract`: extract long-lived repo knowledge from `stdin`
  The command prints a review decision for each extracted memory before writing it.
  Use `--type working` or `--type goal` when you want to force the extracted memory type.
- `brain extract-commit`: extract from a richer git commit context that includes commit metadata, changed files, and diff stat
- `brain inject`: build a compact memory block for the next session, optionally ranked by `--task`, `--path`, and `--module`
  When candidate memories are waiting for review, the injected footer now reminds you to run `brain review`.
- `brain sweep`: clean stale memory hygiene issues after `brain score` or `brain status` has told you what needs attention; use the default interactive mode to confirm each action, `--dry-run` for a report, or `--auto` to apply safe cleanup rules without prompts
- `brain list`: list stored memories; use `--type <memory-type>` to filter or `--goals` to group goal memories by status
- `brain stats`: show memory counts by type and importance, including `working` and `goal`
- `brain lint-memory`: inspect frontmatter schema health, including fixable vs manual issues
- `brain normalize-memory`: apply safe schema autofill and normalization in place, while leaving incompatible files untouched
- `brain goal done`: mark a matching goal memory as done and refresh its `updated` date
- `brain status`: show the current workflow mode, pending reminders, recent activity, and a schema health summary for the current repo
- `brain next`: suggest the next RepoBrain command so you do not have to remember the review / approve / sweep / score order yourself
- `brain review`: inspect candidate memories waiting for approval
- `brain approve`: promote one candidate, all candidates, or only `--safe` low-risk candidates to active memory
- `brain dismiss`: mark one candidate, or all candidates, as dismissed
- `brain supersede`: manually link a newer memory to an older memory, update `supersedes` / `superseded_by`, carry the old version forward as `old.version + 1`, and mark the older memory as stale
- `brain lineage`: print ASCII lineage trees for all related memories, or for the chain that contains a specific memory file
- `brain score`: review low-quality or outdated memories, sorted by severity, before you decide whether to sweep, mark stale, or delete
- `brain audit-memory`: audit stored memories for stale, conflict, low-signal, and overscoped entries, plus a schema health summary
- `brain reinforce`: apply queued reinforcement suggestions with `--pending`, or manually run failure analysis plus memory reinforcement from `stdin`; use `--yes` to skip confirmation for automation or CI
- `brain suggest-skills`: build a deterministic skill routing plan from task text, changed paths, and matched active memories
- `brain share`: suggest the next `git add` and `git commit` commands for one memory or all active memories
- `brain mcp`: run RepoBrain as a minimal MCP stdio server

## Configuration

RepoBrain stores config in `.brain/config.yaml`.

Current options:

```yaml
workflowMode: recommended-semi-auto
maxInjectTokens: 1200
extractMode: suggest
language: zh-CN
staleDays: 90
sweepOnInject: false
injectDiversity: true
injectExplainMaxItems: 4
```

- `workflowMode`: high-level workflow preset; use `ultra-safe-manual`, `recommended-semi-auto`, or `automation-first`
- `maxInjectTokens`: approximate token budget used when building injected context, with Unicode-aware estimation for mixed English/CJK content
- `extractMode`: controls hook-based extraction behavior
- `manual`: never write from hooks; use `brain extract` yourself
- `suggest`: store hook-extracted memories as `candidate` records for review
- `auto`: let hooks write active memories immediately
- `language`: preferred output language for extraction prompts
- `staleDays`: number of days before a non-goal memory becomes eligible for sweep downgrading
- `sweepOnInject`: when `true`, `brain inject` runs `brain sweep --auto` first and prints sweep logs to `stderr` so the injected markdown stays clean
- `injectDiversity`: when `true`, `brain inject` uses diversity-aware selection so one cluster of similar memories does not consume the entire token budget
- `injectExplainMaxItems`: maximum number of top score components shown per memory in `--explain` / debug scoring reports
- legacy `provider`, `model`, or `apiKey` style review settings are ignored with a deprecation warning; RepoBrain Core does not call remote review services

## Memory Lifecycle

RepoBrain keeps lifecycle rules intentionally small for the current MVP:

- New extracted memories go through a deterministic review pass first: `accept`, `merge`, `supersede`, or `reject`
- Manual `brain extract` still writes `accept` memories immediately as `active`
- Hook-driven extraction in `suggest` mode saves accepted memories as `candidate`
- duplicate or near-duplicate durable knowledge merges into the matched memory id instead of being treated as a remote-review problem
- `merge` and `supersede` results are kept conservative today: the extracted memory is saved as a `candidate`, and RepoBrain prints the target memory ids instead of rewriting old files automatically
- internal reviewer relationships are richer than the public decision: `duplicate`, `additive_update`, `full_replacement`, `possible_split`, and `ambiguous_overlap`
- `merge` is used for `duplicate` and `additive_update`
- `supersede` is used for `full_replacement`
- `reject` is also used for high-risk relationship states such as `possible_split` and `ambiguous_overlap`, so Core never guesses across partial updates or multi-target conflicts
- `reject` results are skipped with explicit reasons such as `temporary_detail` or `insufficient_signal`
- `brain approve` promotes a candidate to `active`
- `brain dismiss` marks a candidate as `stale`
- If a newly activated memory has the same type, normalized title, and normalized scope as an existing active memory, the older one is automatically marked `superseded`
- `brain inject` only loads `active` memories into the generated context block, then additionally filters out entries with `stale: true` or a non-null `superseded_by`, so superseded lineage entries never become the baseline for normal matching or injection again
- if a memory sets `supersedes`, inject checks whether the older file points back with `superseded_by`; if not, RepoBrain prints a warning to stderr so the lineage can be repaired without breaking compatibility
- external review input is optional and advisory only; Core validates the structure, ignores malformed input, and keeps the local final decision
- the session-end workflow can queue reinforce suggestions when it detects violated memories or repeated mistakes; review them later with `brain reinforce --pending`

This keeps the current write path compatible for clear accepts while still allowing higher-level agent workflows to attach structured candidate review suggestions around the same deterministic baseline.

If you are integrating RepoBrain programmatically, the store API also exposes `buildMemoryReviewContext`, `parseExternalReviewInput`, `decideCandidateMemoryReview`, `explainCandidateMemoryReview`, and `renderCandidateMemoryReviewExplanation` so adapters can inspect the evidence vector without moving final review authority out of Core.

### Reviewer Examples

- Old logic: same title plus overlapping scope usually fell back to `accept`, because only exact normalized scope was eligible for merge or supersede. New logic: overlapping scope can still produce `possible_split` or `ambiguous_overlap`, which is rejected with explicit evidence instead of being silently treated as novel.
- Old logic: wording changes like "transaction helper" vs "shared transaction helper" were easy to miss if summary similarity dipped below a hard cutoff. New logic: identity evidence and overlap evidence accumulate separately, so same-scope additive updates still land on `merge`.
- Old logic: replacement cases depended heavily on title and summary thresholds. New logic: explicit replacement wording, recency, and lineage-aware status evidence can promote the same match to `full_replacement`, which maps to `supersede`.
- Old logic: two overlapping older memories could both look weakly relevant and still leave the candidate as `accept`. New logic: if two targets survive with similar ambiguous evidence, Core rejects with `ambiguous_existing_overlap` instead of guessing.

## Memory Audit

Use `brain audit-memory` when the `.brain/` store starts accumulating enough knowledge that you want a hygiene pass before sharing, release prep, or cleanup work.

Typical moments to run it:

- after several `extract` and `approve` cycles
- before committing or sharing a larger `.brain/` change set
- when old guidance feels suspicious, duplicated, or too broad

The command is read-only. It does not rewrite or delete memory files. The first rule-based version audits four issue classes:

- `stale`: old candidate or low-value active memories that likely need review
- `conflict`: same-scope `decision` or `convention` entries that appear to point in opposite directions
- `low_signal`: entries too thin or generic to help future routing
- `overscoped`: entries whose scope or language is broad enough to cause noisy injection

Examples:

```bash
brain audit-memory
brain audit-memory --json
```

The human-readable output includes `memory_id`, issue type, reason, and suggested next action. `--json` returns the same data in a stable machine-friendly shape.

## External Extractor Contract

If `BRAIN_EXTRACTOR_COMMAND` is set, RepoBrain will use that command instead of the built-in local staged extractor.

This is the extension point for external agents, adapters, or skills that want richer semantic candidate extraction. RepoBrain Core still only consumes local process output and never embeds its own model API client. The built-in path remains fully local and does not require any networked LLM.

The same command contract is also reused by the exported `detectFailures(sessionLog, existingMemories)` helper in `src/failure-detector.ts`. That helper sends one small prompt containing the memory index plus the full session log and expects a strict JSON event array back. Failure detection stays best-effort on purpose: command failures or invalid JSON resolve to `[]` instead of interrupting the session flow.

Contract:

- RepoBrain sends the full extraction prompt to the command over `stdin`
- The command must write strict JSON to `stdout` using the shape `{ "memories": [...] }`
- Each memory must use a supported `type`, `importance`, and the expected string fields
- A non-zero exit code is treated as extractor failure

Failure detector contract:

- RepoBrain sends one prompt over `stdin` with the memory title index (`title | type | file`) and the session log
- The command must write strict JSON to `stdout` using the shape `[{ "kind": "...", ... }]`
- Supported event kinds are `violated_memory` and `new_failure`
- Supported actions are `boost_score`, `rewrite_memory`, and `extract_new`
- If no clear failure is found, the command should return `[]`

Error handling:

- If the command fails, RepoBrain logs the error to `.brain/errors.log` and falls back to heuristic extraction
- If the command returns invalid JSON or unsupported memory entries, RepoBrain logs the parse error and falls back to heuristic extraction
- If there is nothing worth saving, the command should return `{ "memories": [] }`

External extractors should preserve the same durability bar as the built-in extractor:

- keep the current memory schema unchanged
- prefer reusable decisions, gotchas, conventions, patterns, working context, and goals over raw change logs
- include stable metadata when possible, especially `files`, `area`, `importance`, and concise summaries
- reject short-lived debug chatter instead of passing it downstream for Core to clean up later

## Roadmap

- Better Claude Code setup and docs
- Lightweight Codex workflows through Git hooks
- Better memory promotion and deterministic review workflows
- More adapter examples for agent-provided candidate extraction and review suggestions
- A stronger open-source README demo story

## Contributing

Issues and pull requests are welcome.

If you want to contribute, the most helpful things right now are:

- real-world test cases from actual coding sessions
- extraction quality feedback
- repo examples where the current memory model still misses useful context
- docs improvements that make the tool easier to adopt in under five minutes
- release-validation feedback from Windows, macOS, and Linux shells

If you open a PR, keep the core idea in mind:

> RepoBrain is about durable repo knowledge for coding agents, not generic long-term chat memory.

It is not another AI app and not a model API middle layer. RepoBrain is agent-agnostic repo knowledge infrastructure.
