[English](./README.md) | [简体中文](./README.zh-CN.md)

# RepoBrain

> Git-friendly repo memory for coding agents.

RepoBrain helps AI coding agents remember the parts of your repository that actually matter later: architecture decisions, known gotchas, repo-specific conventions, and reusable patterns.

It is not a generic chat memory platform. It does not try to save every conversation forever. The point is much simpler: stop re-explaining the same repo context every time Claude Code or Codex starts a new session.

## Hero

- Remember repo knowledge, not the whole chat log
- Store memory in `.brain/` as Markdown plus frontmatter
- Keep everything local-first, markdown-first, and Git-friendly
- Work with both Claude Code and Codex

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

### Claude Code

RepoBrain can build session-start context and session-end extraction hooks for Claude Code.

Current integration files:

- `.claude-plugin/plugin.json`
- `.claude-plugin/mcp.json`
- `dist/hooks/session-start.js`
- `dist/hooks/session-end.js`

### Codex

Codex support stays lightweight on purpose. It is a workflow amplifier, not a new product mode.

Install the Git hook:

```bash
sh scripts/setup-git-hooks.sh
```

Before a new Codex session:

```bash
brain inject
```

If you wire in the session-start hook, injection can happen automatically. More setup details live in [.codex/INSTALL.md](./.codex/INSTALL.md).

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
- `autoExtract`: reserved for future automation-friendly workflows
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

When these fields are omitted, RepoBrain keeps old entries compatible by defaulting each list to `[]`, `invocation_mode` to `optional`, and `risk_level` to `low`.

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

Task-aware `inject` stays backward compatible. If you provide no task signals, it falls back to the older importance-and-recency ordering. If you do provide signals, RepoBrain scores memories with an explainable mix of:

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

If you already know the task, you can ask `inject` to rank memories by relevance instead of relying only on importance and time:

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

## Memory Lifecycle

RepoBrain keeps lifecycle rules intentionally small for the current MVP:

- New extracted memories go through a deterministic review pass first: `accept`, `merge`, `supersede`, or `reject`
- Manual `brain extract` still writes `accept` memories immediately as `active`
- Hook-driven extraction in `suggest` mode saves accepted memories as `candidate`
- `merge` and `supersede` results are kept conservative today: the extracted memory is saved as a `candidate`, and RepoBrain prints the target memory ids instead of rewriting old files automatically
- `reject` results are skipped with explicit reasons such as `duplicate`, `temporary_detail`, or `insufficient_signal`
- `brain approve` promotes a candidate to `active`
- `brain dismiss` marks a candidate as `stale`
- If a newly activated memory has the same type, normalized title, and normalized scope as an existing active memory, the older one is automatically marked `superseded`
- `brain inject` only loads `active` memories into the generated context block

This keeps the current write path compatible for clear accepts while giving later LLM-backed reviewers or higher-level workflows a structured place to take over merge and supersede decisions.

## External Extractor Contract

If `BRAIN_EXTRACTOR_COMMAND` is set, RepoBrain will use that command instead of the built-in heuristic extractor.

Contract:

- RepoBrain sends the full extraction prompt to the command over `stdin`
- The command must write strict JSON to `stdout` using the shape `{ "memories": [...] }`
- Each memory must use a supported `type`, `importance`, and the expected string fields
- A non-zero exit code is treated as extractor failure

Error handling:

- If the command fails, RepoBrain logs the error to `.brain/errors.log` and falls back to heuristic extraction
- If the command returns invalid JSON or unsupported memory entries, RepoBrain logs the parse error and falls back to heuristic extraction
- If there is nothing worth saving, the command should return `{ "memories": [] }`

## Roadmap

- Better Claude Code setup and docs
- Lightweight Codex workflows through Git hooks
- Better memory promotion and review workflows
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
