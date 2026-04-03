# RepoBrain Codex Contract

Use RepoBrain as the shared repo-memory layer for Codex sessions.

## Session Start

Run and consume:

`brain inject --task "<current task>" --path <changed-path>`

Contract:

- Input shape is markdown.
- Use it to load durable repo context before planning or editing.
- Treat the payload as Core-owned context, not a Codex-owned schema.

Reference example:

- `integrations/contracts/session-start.inject.md`

## Task Known

Run and consume:

`brain suggest-skills --format json --task "<current task>" --path <changed-path>`

Contract:

- Use `invocation_plan` for workflow routing.
- Use `checks` to keep verification visible.
- Do not convert the plan into Codex-only memory.

Reference example:

- `integrations/contracts/task-known.invocation-plan.json`

## Session End

When the task produced a durable lesson:

- emit the JSON candidate envelope from `integrations/contracts/session-end.extract-candidate.json`
- or emit the markdown fallback from `integrations/contracts/session-end.extract-candidate.md`
- then hand the result to `brain extract`

## Failure Reinforcement

When the session violated a known memory or repeated a failure pattern:

- emit the JSON event from `integrations/contracts/failure.reinforce-event.json`
- then hand it to `brain reinforce`
- if JSON is awkward, summarize the failure in markdown and pipe it to `brain reinforce`

## Guardrails

- `.brain/` is the only durable knowledge store.
- Keep existing CLI behavior compatible unless the task explicitly changes it.
- Prefer thin contract translation over deep Codex-specific integration logic.
