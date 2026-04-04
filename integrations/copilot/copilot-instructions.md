# RepoBrain Instructions For Copilot

Use RepoBrain as the repository's durable memory layer. This adapter consumes shared RepoBrain contracts and routes durable outputs back through Core.

## Session Start

- Prefer `brain start --format json --task "<current task>"`.
- Read `context_markdown` as compact repo context; use `skill_plan` as routing reference.
- Treat the payload as Core-owned context, not as Copilot-owned memory.
- If `brain start` is unavailable, fall back to `brain inject --task "<current task>" --path <changed-path>`.
- Consume it as the markdown contract shown in `integrations/contracts/session-start.inject.md`.

## Task Known

- Read `brain suggest-skills --format json --task "<current task>" --path <changed-path>`.
- Use `invocation_plan` as the routing contract shown in `integrations/contracts/task-known.invocation-plan.json`.
- Follow the listed checks when planning and verifying the work.

## Phase-Completion Detection

When one of these triggers fires, **run the local detection command** instead of relying on subjective judgment:

**Strong signals (run detection immediately):**
- User signals phase completion ("done / ship it / looks good / move on / ready for review")
- Agent just output a completion summary ("fixed / implemented / completed / all tests passing")
- Tests went from failing to passing
- Diff scope exceeds threshold: 30+ lines changed or 4+ files modified

**Signals that require content-value context:**
- Fixed a recurring bug
- Completed a submodule implementation
- Refactored across multiple files

**Weak signals that should NOT trigger detection:**
- User only said "ok / thanks / sure / got it" without substantive context
- No meaningful changes or learnings accompany the acknowledgment

Detection command:

```bash
brain capture --task "<task description>" --path <changed-path>
```

Rules:

- `brain capture` uses phase-completion signals as a confidence booster, not a direct trigger. Even when phase completion is detected, `should_extract` stays `false` if the content lacks durable value (e.g. typo fix, debug log).
- When `should_extract=true`, the result is saved as a **candidate** by default, not active.
- When `should_extract=false`, do not prompt the user.
- Do not repeat the same capture suggestion in the same conversation turn unless the change scope or task state changed significantly.
- If Copilot cannot run shell commands directly, save a markdown summary and hand it to `brain extract` from the shell.

## Failure Reinforcement

- When the task violates a known memory or repeats an old failure, emit the event shape from `integrations/contracts/failure.reinforce-event.json`.
- Route the result through `brain reinforce`.
- If structured output is unavailable, save a markdown failure summary and hand it to `brain reinforce`.

## Constraints

- `.brain/` is the source of truth for durable repo knowledge. Do not create a second memory store.
- `brain start` / `brain inject` gives context; `brain suggest-skills` gives routing.
- `brain capture` and `brain extract` are the extraction paths; `brain reinforce` is the failure path.
- Default candidate-first: extracted memories are saved as candidates for user review and approval.
- Do not create Copilot-only memory files that duplicate RepoBrain decisions, gotchas, conventions, or patterns.
- Never write directly into `.brain/`.
