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
npm install
npm run build
npm link

brain init
brain inject
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

### Local install

```bash
npm install
npm run build
```

If you want the `brain` command available globally:

```bash
npm link
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
