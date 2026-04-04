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

## Phase-Completion Detection

When one of the following triggers fires, **run the local detection command** instead of relying on subjective judgment:

- Fixed a recurring bug
- Completed a submodule implementation
- Refactored across multiple files
- Tests went from failing to passing
- User signals completion ("done / ship it / looks good / next task")
- Agent just output "fixed / implemented / completed"

Detection command:

```bash
brain capture --task "<task description>" --path <changed-path>
```

Rules:

- `brain capture` uses local deterministic rules to decide whether extraction is worthwhile.
- When `should_extract=true`, the result is saved as a **candidate** by default, not active.
- When `should_extract=false`, do not prompt the user.
- Do not repeat the same capture suggestion in the same conversation turn unless the change scope or task state changed significantly.

For hooks-based workflows, the session-end hook can also call `brain capture` automatically.

## Failure Reinforcement

If the session repeats an old mistake or violates a known memory:

- emit `integrations/contracts/failure.reinforce-event.json`, then run `brain reinforce`
- or fall back to a markdown failure summary piped to `brain reinforce`

## Guardrails

- `.brain/` stays the only durable repo-memory store. Do not create a second memory store.
- `brain start` / `brain route` is the preferred session-start entrypoint.
- `brain inject` gives context; `brain suggest-skills` gives routing.
- `brain capture` and `brain extract` are the extraction paths; `brain reinforce` is the failure path.
- Default candidate-first: extracted memories are saved as candidates for user review and approval.
- Keep Claude integration lightweight; no SDK, no shadow memory, no adapter-owned schema.
- Never write directly into `.brain/`.
