# RepoBrain Integrations

RepoBrain adapters stay thin on purpose, but they now share a stronger contract with explicit detection triggers instead of soft prompts.

- `.brain/` remains the only durable repo-memory store. No adapter may create a second store.
- `brain start --format json` is the preferred session-start entrypoint; `brain inject` is the fallback.
- `brain suggest-skills --format json` remains the canonical task-known routing payload.
- `brain capture` is the preferred phase-completion detection command. It runs local deterministic rules and defaults to candidate-first output.
- `brain extract` and `brain reinforce` remain the only durable write paths.
- Adapters may translate format, but they must not invent a second schema or local memory store.

## Thin Adapter Contract

The adapter contract is lifecycle-based rather than agent-specific:

1. **Session start**: consume `brain start --format json` and read both `context_markdown` and `skill_plan`. Fall back to `brain inject` when `brain start` is unavailable.
2. **Task known**: consume `brain suggest-skills --format json`, especially `invocation_plan`.
3. **Phase completion**: run `brain capture --task "<task>" --path <path>` when a detection trigger fires. `should_extract=true` saves a candidate; `should_extract=false` means no action.
4. **Session end**: emit an extract candidate in the shared markdown or JSON envelope if detection was not already run.
5. **Failure path**: emit a reinforce event through `brain reinforce`.

This keeps adapters lightweight while giving Core a stable input-output boundary.

## Phase-Completion Detection Triggers

All adapters share the same detection triggers. When any of these occur, the adapter should run `brain capture` instead of relying on subjective judgment:

- Fixed a recurring bug
- Completed a submodule implementation
- Refactored across multiple files
- Tests went from failing to passing
- User signals completion ("done / ship it / looks good / next task")
- Agent just output "fixed / implemented / completed"

### Why candidate-first

- `brain capture` defaults to saving extracted memories as **candidates**, not active.
- This keeps the human in the loop: candidates are reviewed with `brain review` and promoted with `brain approve`.
- Active writes happen only through explicit approval, `extractMode: auto`, or manual `brain extract`.
- This design prevents adapter-generated noise from polluting the durable knowledge store.

### Anti-repetition

- Do not repeat the same capture suggestion in the same conversation turn.
- Only re-run detection if the change scope or task state changed significantly since the last run.

## Responsibility Boundary

Core layer responsibilities:

- define and validate the `.brain/` Markdown plus frontmatter schema
- rank and render durable context for `brain inject`
- derive task-aware routing hints and `invocation_plan` through `brain suggest-skills`
- package context plus routing for session start through `brain start` / `brain route`
- run local detection rules through `brain suggest-extract` and `brain capture`
- review extraction results locally and make the final `accept` / `merge` / `supersede` / `reject` decision
- own compatibility rules, defaults, and error messages when schema or config fields expand

Adapter layer responsibilities:

- place RepoBrain payloads at the right point in the target agent workflow
- translate the same contract into the agent's native instruction format
- decide whether and how to apply RepoBrain routing inside the agent's native skill, subagent, or workflow system
- run `brain capture` at phase-completion triggers instead of subjective extraction proposals
- emit extract candidates or reinforce events without bypassing RepoBrain Core
- provide a markdown fallback when the agent cannot emit the preferred JSON envelope
- never write directly into `.brain/`

Claude Code, Codex, Cursor, and Copilot may already have their own task or action selection behavior. RepoBrain does not replace that native automation. It adds repo-local, deterministic, auditable routing policy on top.

## Canonical Inputs And Outputs

### 1. Session Start: `inject`

- Input command: `brain inject --task "<task>" --path <path>`
- Canonical shape: markdown block
- Contract example: [`contracts/session-start.inject.md`](./contracts/session-start.inject.md)
- Adapter rule: consume as opaque context, not as a new parser-owned schema

### 2. Task Known: `suggest-skills` + `invocation_plan`

- Input command: `brain suggest-skills --format json --task "<task>" --path <path>`
- Canonical shape: JSON object with `decision`, matched memories, and `invocation_plan`
- Contract example: [`contracts/task-known.invocation-plan.json`](./contracts/task-known.invocation-plan.json)
- Adapter rule: route on `invocation_plan`; do not reinterpret prose into agent-specific memory
- Manual inspection example: `brain suggest-skills --task "debug flaky browser tests in CI"`

### Preferred Session Start: `start` / `route`

- Input command: `brain start --format json --task "<task>"`
- Canonical shape: JSON bundle with `context_markdown`, `skill_plan`, and the same task/path metadata used by `suggest-skills`
- Adapter rule: prefer this when bootstrapping a session so context and routing stay in one auditable payload
- Adapter example: `brain start --format json --task "debug flaky browser tests in CI"`

### 3. Phase Completion: `capture`

- Input command: `brain capture --task "<task>" --path <path>`
- Canonical shape: local detection result with `should_extract`, `reason`, and optional candidate output
- Adapter rule: run at detection triggers; when `should_extract=true`, the candidate is saved automatically; when `should_extract=false`, take no action and do not prompt the user

### 4. Session End: extract candidate

- Preferred output: JSON envelope
- Markdown fallback: summary block that can be piped to `brain extract`
- Contract examples:
  - [`contracts/session-end.extract-candidate.json`](./contracts/session-end.extract-candidate.json)
  - [`contracts/session-end.extract-candidate.md`](./contracts/session-end.extract-candidate.md)

### 5. Failure Path: reinforce event

- Preferred output: JSON envelope for a violated memory or repeated failure
- Fallback: markdown incident summary piped to `brain reinforce`
- Contract example: [`contracts/failure.reinforce-event.json`](./contracts/failure.reinforce-event.json)

## Failure Fallback Strategy

Adapters should follow the same fallback ladder:

1. If structured JSON is supported, emit the canonical contract envelope.
2. If only markdown is practical, emit the markdown fallback with the same semantic fields.
3. If the agent cannot emit either automatically, save a raw session summary and run `brain extract` or `brain reinforce` from a shell or hook step.
4. Never write directly into `.brain/` from the adapter.

## Adapter Matrix

| Adapter | Session start | Task known | Phase completion | Failure handling |
| --- | --- | --- | --- | --- |
| Claude Code | Hook or operator starts from `brain start --format json`; falls back to inject markdown | Skill or hook reads `invocation_plan` JSON | `brain capture` at detection triggers; candidate-first | Hook emits reinforce event or calls `brain reinforce` |
| Codex | Steering rule instructs agent to run `brain start --format json` at session start | SKILL routes on `invocation_plan` JSON | `brain capture` at detection triggers; candidate-first | Agent calls `brain reinforce` on failure |
| Cursor | `alwaysApply: true` rule instructs agent to run `brain start --format json` | Rule file instructs agent to route on `invocation_plan` JSON | `brain capture` at detection triggers; candidate-first | Markdown fallback plus manual CLI |
| Copilot | Custom instructions consume `brain start --format json`; markdown fallback via `brain inject` | Custom instructions point to `invocation_plan` JSON | `brain capture` at detection triggers; candidate-first; markdown fallback if shell unavailable | Shell or CI-driven reinforce |

## Included Adapters

- [`claude/`](./claude/): Claude Code workflow, template, and limits
- [`codex/`](./codex/): Codex workflow, template, and limits
- [`cursor/`](./cursor/): Cursor rule-based adapter
- [`copilot/`](./copilot/): GitHub Copilot custom instructions adapter

Start from the relevant adapter template, keep the wording local to your team, and preserve the shared contract files above as the source of truth.
