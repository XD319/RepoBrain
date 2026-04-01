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
3. It saves the result into `.brain/` as readable Markdown files.
4. Before the next session, `brain inject` builds a compact context block.
5. Claude Code or Codex starts with the repo's real decisions, gotchas, and conventions.

That means less repeated setup, fewer old mistakes, and fewer suggestions that ignore how the repo already works.

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

More setup details live in [.codex/INSTALL.md](./.codex/INSTALL.md).

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

### Step 3: Inject And Verify

Start the next session with the repo knowledge you just captured:

```bash
brain inject
brain status
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
3. Before the next session, run `brain inject`.
4. Review `.brain/` changes the same way you review code.

Two commands cover most of the loop:

```bash
cat session-summary.txt | brain extract
brain inject
```

If the captured knowledge is good enough to keep with the codebase, commit the `.brain/` change along with the code change after review.

Total: ~25 min. What to try next -> [docs/demo-script.md](./docs/demo-script.md)

## CLI Reference

```bash
brain init
brain extract < session-summary.txt
brain inject
brain list
brain stats
brain status
```

### Commands

- `brain init`: create the `.brain/` workspace in the current repo
- `brain extract`: extract long-lived repo knowledge from `stdin`
- `brain inject`: build a compact memory block for the next session
- `brain list`: list stored memories
- `brain stats`: show memory counts by type and importance
- `brain status`: show the most recently injected memories and most recently captured memories for the current repo

## Configuration

RepoBrain stores config in `.brain/config.yaml`.

Current options:

```yaml
maxInjectTokens: 1200
autoExtract: false
language: zh-CN
```

- `maxInjectTokens`: approximate token budget used when building injected context, with Unicode-aware estimation for mixed English/CJK content
- `autoExtract`: reserved flag for automation-friendly workflows
- `language`: preferred output language for extraction prompts

## Memory Lifecycle

RepoBrain keeps lifecycle rules intentionally small for the current MVP:

- New memories start as `active`
- If a newly saved memory has the same type and normalized title as an existing active memory, the older one is automatically marked `superseded`
- `brain inject` excludes `superseded` memories from the generated context block

This is a minimal invalidation mechanism for solo developers and long-lived personal projects. More advanced review workflows can come later.

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
