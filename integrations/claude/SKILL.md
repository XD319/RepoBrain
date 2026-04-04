# RepoBrain Claude Contract

Use RepoBrain as the durable repo-memory layer for Claude Code. This adapter is thin: it consumes RepoBrain inputs and emits RepoBrain-shaped outputs. Claude may already have its own task or action selection behavior; RepoBrain does not replace that. It adds repo-local, deterministic, auditable routing policy on top.

## Session Start

Prefer the session-start bundle from:

`brain start --format json --task "<current task>"`

How to use it:

- Read `context_markdown` before planning or editing.
- Treat `skill_plan` as RepoBrain's routing policy, not as an instruction to bypass Claude's native flow control.
- Escalate when the payload shows conflicts, warnings, or missing context for the task.

If only compact context is needed, Claude can still consume the markdown contract from:

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
- Treat this as the canonical task-known routing payload, not as the default everyday manual entrypoint.
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
- `brain start` / `brain route` is the preferred session-start entrypoint.
- `brain inject` gives context; `brain suggest-skills` gives routing.
- `brain extract` and `brain reinforce` remain the only durable write paths.
- Keep Claude integration lightweight; no SDK, no shadow memory, no adapter-owned schema.
