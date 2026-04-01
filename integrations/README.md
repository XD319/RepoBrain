# RepoBrain Integrations

RepoBrain keeps its core knowledge model in one place:

- `.brain/` is the only durable repo memory store
- `brain inject` is the compact context output for session start
- `brain suggest-skills` is the task-aware routing output
- local deterministic review stays in Core, not in agent-specific adapters

The files in this directory are thin adapter templates for specific agents. They should not introduce a second schema, a second memory index, or agent-specific durable knowledge files.

## Responsibility Boundary

Core layer responsibilities:

- define and validate the `.brain` Markdown plus frontmatter schema
- run local rule-based review, dedupe, and supersede decisions
- rank and render durable context for `brain inject`
- derive skill routing hints for `brain suggest-skills`
- own compatibility rules when schema fields expand

Adapter layer responsibilities:

- translate RepoBrain outputs into the target agent's preferred instruction format
- show where `brain inject` and `brain suggest-skills` fit into that agent workflow
- optionally produce structured candidate extraction or review suggestions
- stay replaceable and lightweight so the core model remains shared

## Included Templates

- `claude/`: Claude Code skill template
- `codex/`: Codex skill template
- `cursor/`: Cursor rules template
- `copilot/`: GitHub Copilot custom instructions template

Use these as starting points. Copy the relevant file into the agent-specific location in your repo, then customize wording for your team without changing the underlying RepoBrain contract.
