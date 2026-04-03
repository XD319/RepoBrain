# RepoBrain Claude Contract

Use RepoBrain as the durable repo-memory layer for Claude Code. This adapter is thin: it consumes RepoBrain inputs and emits RepoBrain-shaped outputs.

## Session Start

Consume the markdown contract from:

`brain inject --task "<current task>" --path <changed-path>`

How to use it:

- Read the inject block before planning or editing.
- Treat it as compact repo context, not as a prompt to create Claude-local memory.
- Escalate when the context looks stale, contradictory, or missing for the task.

Reference example:

- `integrations/contracts/session-start.inject.md`

## Task Known

Consume the JSON contract from:

`brain suggest-skills --format json --task "<current task>" --path <changed-path>`

How to use it:

- Route on `invocation_plan`.
- Use `decision`, `skills`, and `checks` to shape the workflow.
- Do not copy the plan into a second repo note system.

Reference example:

- `integrations/contracts/task-known.invocation-plan.json`

## Session End

Produce an extract candidate when the session reveals durable knowledge.

Preferred output:

- `integrations/contracts/session-end.extract-candidate.json`

Fallback output:

- `integrations/contracts/session-end.extract-candidate.md`

Rules:

- Emit candidate-shaped content, then let RepoBrain Core review it through `brain extract`.
- Keep one durable lesson per candidate when possible.
- Do not write directly into `.brain/` from Claude instructions.

## Failure Reinforcement

If the session repeats an old mistake or violates a known memory:

- emit `integrations/contracts/failure.reinforce-event.json`, then run `brain reinforce`
- or fall back to a markdown failure summary piped to `brain reinforce`

## Guardrails

- `.brain/` stays the only durable repo-memory store.
- `brain inject` gives context; `brain suggest-skills` gives routing.
- `brain extract` and `brain reinforce` remain the only durable write paths.
- Keep Claude integration lightweight; no SDK, no shadow memory, no adapter-owned schema.
