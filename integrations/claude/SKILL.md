# RepoBrain Claude Contract

Use RepoBrain as the durable repo-memory layer for Claude Code. This adapter is thin: it consumes RepoBrain inputs and emits RepoBrain-shaped outputs. Claude may already have its own task or action selection behavior; RepoBrain does not replace that. It adds repo-local, deterministic, auditable routing policy on top.

## Command Resolution (Dev Fallback)

All `brain <args>` invocations in this document follow this priority:

1. `brain <args>` — use directly when globally installed
2. `npx brain <args>` — use when the global binary is unavailable
3. `node dist/cli.js <args>` — only when working inside the RepoBrain development repo itself and `dist/cli.js` exists

Resolution: try `brain --version` first; on failure try `npx brain --version`; if both fail, check whether the repo root `package.json` has `"name": "brain"` and `dist/cli.js` exists, then use path 3. Published user repos will almost always hit path 1.

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
