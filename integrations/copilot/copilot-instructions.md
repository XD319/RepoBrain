# RepoBrain Instructions For Copilot

Use RepoBrain as the repository's durable memory layer. This adapter consumes shared RepoBrain contracts and routes durable outputs back through Core.

## Session Start

- Read `brain inject --task "<current task>" --path <changed-path>`.
- Consume it as the markdown contract shown in `integrations/contracts/session-start.inject.md`.
- Treat it as compact repo context, not as Copilot-owned memory.

## Task Known

- Read `brain suggest-skills --format json --task "<current task>" --path <changed-path>`.
- Use `invocation_plan` as the routing contract shown in `integrations/contracts/task-known.invocation-plan.json`.
- Follow the listed checks when planning and verifying the work.

## Session End

- When the task yields a durable lesson, emit the candidate shape from `integrations/contracts/session-end.extract-candidate.json`.
- If JSON output is impractical, emit the markdown fallback from `integrations/contracts/session-end.extract-candidate.md`.
- Route the result through `brain extract`.

## Failure Reinforcement

- When the task violates a known memory or repeats an old failure, emit the event shape from `integrations/contracts/failure.reinforce-event.json`.
- Route the result through `brain reinforce`.
- If structured output is unavailable, save a markdown failure summary and hand it to `brain reinforce`.

## Constraints

- `.brain/` is the source of truth for durable repo knowledge.
- `brain inject` gives context and `brain suggest-skills` gives routing.
- `brain extract` and `brain reinforce` remain the only durable write paths.
- Do not create Copilot-only memory files that duplicate RepoBrain decisions, gotchas, conventions, or patterns.
