# RepoBrain Task Bootstrap

## Purpose

Use RepoBrain as the shared repo-memory layer for Codex sessions.

## Inputs

1. `brain inject --task "<current task>" --path <changed-path>`
2. `brain suggest-skills --task "<current task>" --path <changed-path>`
3. `.brain/` files when the injected summary needs source verification

## Instructions

- Load repo context from `brain inject` before planning or editing.
- Treat `brain suggest-skills` as workflow selection help for the current task.
- Keep `.brain/` as the source of truth for durable repo knowledge.
- Do not create Codex-only memory formats for repo decisions or conventions.
- When you discover a durable lesson, route it back into RepoBrain capture and review flows.

## Output Expectations

- Preserve compatibility with existing RepoBrain CLI behavior.
- Surface when the current task lacks enough repo context and should save a new memory later.
- Prefer thin workflow glue over deep agent-specific branching.
