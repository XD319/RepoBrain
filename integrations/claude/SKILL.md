# RepoBrain Session Bootstrap

## Purpose

Use RepoBrain as the durable repo-memory layer for Claude Code sessions.

## Inputs

1. `brain inject --task "<current task>" --path <changed-path>`
2. `brain suggest-skills --task "<current task>" --path <changed-path>`
3. `.brain/` Markdown files only when a deeper source review is needed

## Instructions

- Treat `.brain/` as the only durable knowledge store for repo-specific memory.
- Read `brain inject` first to load compact repo context before making non-trivial changes.
- Use `brain suggest-skills` as routing guidance, not as a second memory database.
- If the task reveals a durable lesson, save it back through RepoBrain rather than storing it in agent-local notes.
- Do not invent a parallel schema for decisions, gotchas, conventions, or patterns.

## Output Expectations

- Follow repo conventions already captured in `.brain/`.
- Call out when RepoBrain context seems missing, stale, or contradictory.
- Prefer updating repo knowledge through RepoBrain workflows instead of editing this adapter template.
