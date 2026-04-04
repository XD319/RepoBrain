# RepoBrain Codex Contract

Use RepoBrain as the shared repo-memory layer for Codex sessions. Codex may already have its own task or action selection behavior; RepoBrain does not replace that. It adds repo-local, deterministic, auditable routing policy on top.

## Session Start

Prefer the session-start bundle:

`brain start --format json --task "<current task>"`

Contract:

- Read `context_markdown` before planning or editing.
- Use `skill_plan` as RepoBrain's routing policy input, not as a replacement for Codex-native workflow choices.
- Treat the payload as Core-owned context and routing, not a Codex-owned schema.

If only compact context is needed, Codex can still run and consume:

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
- Treat this as the canonical task-known routing payload, not as the default everyday manual entrypoint.
- Do not convert the plan into Codex-only memory.

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

## Failure Reinforcement

When the session violated a known memory or repeated a failure pattern:

- emit the JSON event from `integrations/contracts/failure.reinforce-event.json`
- then hand it to `brain reinforce`
- if JSON is awkward, summarize the failure in markdown and pipe it to `brain reinforce`

## Guardrails

- `.brain/` is the only durable knowledge store. Do not create a second memory store.
- RepoBrain is the routing/memory layer; it does not replace Codex-native action selection.
- `brain start` / `brain inject` gives context; `brain suggest-skills` gives routing.
- `brain capture` and `brain extract` are the extraction paths; `brain reinforce` is the failure path.
- Default candidate-first: extracted memories are saved as candidates for user review and approval.
- Never write directly into `.brain/`.
- Keep existing CLI behavior compatible unless the task explicitly changes it.
- Prefer thin contract translation over deep Codex-specific integration logic.
