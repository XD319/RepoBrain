[English](./README.md) | [简体中文](./README.zh-CN.md)

# RepoBrain

> Git-friendly repo memory for coding agents.

RepoBrain helps AI coding agents remember the parts of your repository that actually matter later: architecture decisions, known gotchas, repo-specific conventions, and reusable patterns.

It is not a generic chat memory platform. It does not try to save every conversation forever. The point is much simpler: stop re-explaining the same repo context every time Claude Code or Codex starts a new session.

## Hero

- Remember repo knowledge, not the whole chat log
- Store memory in `.brain/` as Markdown plus frontmatter
- Keep everything local-first, markdown-first, and Git-friendly
- Work with Claude Code, Codex, Cursor, and Copilot through thin adapters

## Demo GIF

Planned asset: `docs/demo.gif`

Until the GIF is recorded, use [docs/demo-script.md](./docs/demo-script.md) as the exact storyboard.

The recommended flow is simple:

1. Fix a real repo issue once.
2. Save the lesson as repo knowledge.
3. Start a new session.
4. Run `brain inject`.
5. Watch the agent avoid the same mistake because the repo already remembers it.

## Quick Start

```bash
# After the first public npm release
npm install -g repobrain

brain init
brain inject
```

Until the npm package is live, use the local development install:

```bash
npm install
npm run build
npm link
```

Extract memory from a session summary:

```bash
cat session-summary.txt | brain extract
```

Extract memory from the latest commit message:

```bash
git log -1 --pretty=format:"%B" | brain extract --source git-commit
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
4. You approve good candidates with `brain approve <id>` or `brain approve --all`.
5. Only approved memories affect future `brain inject` output.

If you want a fully manual flow, set `extractMode: manual`. If you want immediate writes from hooks, set `extractMode: auto`.

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

Shared adapter templates live in [integrations/README.md](./integrations/README.md).

### Claude Code

Claude support keeps the existing hook and plugin surface, while the new adapter template documents how Claude should consume RepoBrain outputs.

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
brain suggest-skills --task "current task" --path src/example.ts
```

Templates and setup notes:

- `integrations/codex/SKILL.md`
- [.codex/INSTALL.md](./.codex/INSTALL.md)

### Cursor

Cursor support starts with a rules template instead of a deep integration. Copy `integrations/cursor/repobrain.mdc` into `.cursor/rules/repobrain.mdc` and keep RepoBrain as the only durable repo-memory source.

### GitHub Copilot

Copilot support starts with a custom instructions template. Copy `integrations/copilot/copilot-instructions.md` into `.github/copilot-instructions.md` and keep RepoBrain as the shared memory core instead of creating Copilot-only repo notes.

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
brain init
```

After initialization, `.brain/` should look like this:

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
- `language`: preferred output language for extraction prompts

### Step 2: Capture Your First Memory

Use a realistic repo lesson instead of a toy example. In this walkthrough, the lesson is that ESLint's `no-unused-vars` can overlap with TypeScript's `noUnusedLocals` and create duplicate warnings.

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

The baseline reviewer is deterministic and explainable on purpose. It looks at memory type first, then exact normalized scope, title similarity, summary similarity, target status, and target recency. `merge` and `supersede` only trigger when the candidate and target share the same normalized scope. Scope overlap by itself is treated as context, not enough to rewrite or collapse memories. Programmatic integrations may attach optional external review input, but Core still validates that input shape and makes the final local `accept` / `merge` / `supersede` / `reject` decision itself.

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
- `stale`: whether the memory has been marked stale in metadata, defaults to `false`
- `supersedes`: optional `.brain/`-relative file path for the older memory this entry replaces, defaults to `null`
- `superseded_by`: optional `.brain/`-relative file path for the newer memory that replaces this entry, defaults to `null`
- `version`: version number for the same decision lineage, defaults to `1`
- `related`: optional `.brain/`-relative file path list for related memories that do not replace this one, defaults to `[]`
- `origin`: optional origin marker for special write paths such as failure reinforcement

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

When these fields are omitted, RepoBrain keeps old entries compatible by defaulting each list to `[]`, `invocation_mode` to `optional`, `risk_level` to `low`, `score` to `60`, `hit_count` to `0`, `last_used` to `null`, `created_at` to the memory `date`, `stale` to `false`, `supersedes` to `null`, `superseded_by` to `null`, `version` to `1`, `related` to `[]`, and `origin` to unset.

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

Once some memories carry routing metadata, you can ask RepoBrain to turn the current task and changed paths into a skill shortlist:

```bash
brain suggest-skills --task "debug flaky browser tests in CI" --path tests/e2e/login.spec.ts --path playwright.config.ts
```

The command only considers `active` memories. It matches the task against `skill_trigger_tasks`, matches each provided path against `skill_trigger_paths`, then prints:

- the matched memories and why they matched
- a shortlist of `required`, `recommended`, `suppressed`, or `conflicted` skills

If you already have the task description in a file or another command, you can also pipe it over stdin:

```bash
cat task.txt | brain suggest-skills --path src/cli.ts --path test/store.test.mjs
```

### When To Use `inject` Vs `suggest-skills`

Use `brain inject` when the agent needs a compact, durable repo context block before it starts coding. Use `brain suggest-skills` when you already know the task and want RepoBrain to narrow the execution workflow or tool choice.

- `brain inject`: best for session start, implementation planning, risky edits, and avoiding old repo-specific mistakes
- `brain suggest-skills`: best for deciding which skill or workflow should own the task once you already know the target work

`brain inject` now sorts active memories by computed injection priority, skips memories whose frontmatter sets `stale: true` or `superseded_by` to a newer `.brain/` file, prefixes versioned entries with `[更新 vN]` when `version >= 2`, warns on broken supersede back-links during inject, and atomically writes back a higher `hit_count` plus a fresh `last_used` date for injected memories. When you provide task signals, RepoBrain still shows short rationale hints based on:

- task phrase matches from `skill_trigger_tasks`
- path matches from `path_scope` and `skill_trigger_paths`
- module keyword overlap from the task/module input against titles, summaries, tags, and scoped paths
- small tie-break bonuses from `importance`, `risk_level`, and `invocation_mode`

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

The injected block will group memories by category and end with a short set of requirements. The output will look like this:

```md
# Project Brain: Repo Knowledge Context

## High-priority decisions
_None._

## Known gotchas and limits
- [medium] ESLint no-unused-vars conflicts with TypeScript noUnusedLocals
  ESLint no-unused-vars conflicts with TypeScript noUnusedLocals
  Scope: gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals When TypeScript is already enforcing unused locals...

## Repo conventions
_None._

## Reusable patterns
_None._
```

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

## CLI Reference

```bash
brain init
brain extract < session-summary.txt
brain inject
brain list
brain stats
brain status
brain review
brain approve <memory-id>
brain dismiss <memory-id>
brain supersede <new-memory-file> <old-memory-file>
brain audit-memory
brain reinforce < session-summary.txt
brain suggest-skills --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain share <memory-id>
brain share --all-active
brain mcp
```

### Commands

- `brain init`: create the `.brain/` workspace in the current repo
- `brain extract`: extract long-lived repo knowledge from `stdin`
  The command prints a review decision for each extracted memory before writing it.
- `brain inject`: build a compact memory block for the next session, optionally ranked by `--task`, `--path`, and `--module`
- `brain list`: list stored memories
- `brain stats`: show memory counts by type and importance
- `brain status`: show the most recently injected memories and most recently captured memories for the current repo
- `brain review`: list candidate memories waiting for approval
- `brain approve`: promote one candidate, or all candidates, to active memory
- `brain dismiss`: mark one candidate, or all candidates, as dismissed
- `brain supersede`: manually link a newer memory to an older memory, update `supersedes` / `superseded_by`, carry the old version forward as `old.version + 1`, and mark the older memory as stale
- `brain score`: review low-quality or outdated memories, sorted by severity, and interactively or non-interactively mark stale, delete, keep, or export JSON
- `brain audit-memory`: audit stored memories for stale, conflict, low-signal, and overscoped entries
- `brain reinforce`: manually run failure analysis plus memory reinforcement from `stdin`; use `--yes` to skip confirmation for automation or CI
- `brain suggest-skills`: build a skill shortlist from task text, changed paths, and matched active memories
- `brain share`: suggest the next `git add` and `git commit` commands for one memory or all active memories
- `brain mcp`: run RepoBrain as a minimal MCP stdio server

## Configuration

RepoBrain stores config in `.brain/config.yaml`.

Current options:

```yaml
maxInjectTokens: 1200
extractMode: suggest
language: zh-CN
```

- `maxInjectTokens`: approximate token budget used when building injected context, with Unicode-aware estimation for mixed English/CJK content
- `extractMode`: controls hook-based extraction behavior
- `manual`: never write from hooks; use `brain extract` yourself
- `suggest`: store hook-extracted memories as `candidate` records for review
- `auto`: let hooks write active memories immediately
- `language`: preferred output language for extraction prompts
- legacy `provider`, `model`, or `apiKey` style review settings are ignored with a deprecation warning; RepoBrain Core does not call remote review services

## Memory Lifecycle

RepoBrain keeps lifecycle rules intentionally small for the current MVP:

- New extracted memories go through a deterministic review pass first: `accept`, `merge`, `supersede`, or `reject`
- Manual `brain extract` still writes `accept` memories immediately as `active`
- Hook-driven extraction in `suggest` mode saves accepted memories as `candidate`
- duplicate or near-duplicate durable knowledge merges into the matched memory id instead of being treated as a remote-review problem
- `merge` and `supersede` results are kept conservative today: the extracted memory is saved as a `candidate`, and RepoBrain prints the target memory ids instead of rewriting old files automatically
- The deterministic baseline only considers `merge` and `supersede` against memories with the same type and normalized scope; overlapping scopes are not enough
- `merge` is reserved for additive updates with strong title and summary overlap
- `supersede` is reserved for newer memories with the same identity plus explicit replacement language such as "replace", "deprecated", or "no longer"
- `reject` results are skipped with explicit reasons such as `temporary_detail` or `insufficient_signal`
- `brain approve` promotes a candidate to `active`
- `brain dismiss` marks a candidate as `stale`
- If a newly activated memory has the same type, normalized title, and normalized scope as an existing active memory, the older one is automatically marked `superseded`
- `brain inject` only loads `active` memories into the generated context block, then additionally filters out entries with `stale: true` or a non-null `superseded_by`, so superseded lineage entries never become the baseline for normal matching or injection again
- if a memory sets `supersedes`, inject checks whether the older file points back with `superseded_by`; if not, RepoBrain prints a warning to stderr so the lineage can be repaired without breaking compatibility
- external review input is optional and advisory only; Core validates the structure, ignores malformed input, and keeps the local final decision
- the session-end hook can also reinforce failures: it detects violated memories or repeated mistakes, boosts or rewrites the affected memory, and can save a new `gotcha` with `origin: failure`

This keeps the current write path compatible for clear accepts while still allowing higher-level agent workflows to attach structured candidate review suggestions around the same deterministic baseline.

If you are integrating RepoBrain programmatically, the store API also exposes `buildMemoryReviewContext`, `parseExternalReviewInput`, and `decideCandidateMemoryReview` so adapters can pass validated agent-provided candidate review input without moving final review authority out of Core.

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

If `BRAIN_EXTRACTOR_COMMAND` is set, RepoBrain will use that command instead of the built-in heuristic extractor.

This is the extension point for external agents, adapters, or skills that want richer semantic candidate extraction. RepoBrain Core still only consumes local process output and never embeds its own model API client.

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

If you open a PR, keep the core idea in mind:

> RepoBrain is about durable repo knowledge for coding agents, not generic long-term chat memory.

It is not another AI app and not a model API middle layer. RepoBrain is agent-agnostic repo knowledge infrastructure.
