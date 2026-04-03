# RepoBrain Integrations

RepoBrain adapters stay thin on purpose, but they now share a stronger contract.

- `.brain/` remains the only durable repo-memory store.
- `brain inject` remains the canonical session-start context payload.
- `brain suggest-skills --format json` remains the canonical task-known routing payload.
- `brain extract` and `brain reinforce` remain the only durable write paths.
- Adapters may translate format, but they must not invent a second schema or local memory store.

## Thin Adapter Contract

The adapter contract is lifecycle-based rather than agent-specific:

1. Session start consumes the markdown payload from `brain inject`.
2. Once the task is known, the adapter consumes `brain suggest-skills --format json`, especially `invocation_plan`.
3. Session end emits an extract candidate in the shared markdown or JSON envelope.
4. If the session failed, the adapter emits a reinforce event instead of silently discarding the failure.

This keeps adapters lightweight while giving Core a stable input-output boundary.

## Responsibility Boundary

Core layer responsibilities:

- define and validate the `.brain/` Markdown plus frontmatter schema
- rank and render durable context for `brain inject`
- derive task-aware routing hints and `invocation_plan` through `brain suggest-skills`
- review extraction results locally and make the final `accept` / `merge` / `supersede` / `reject` decision
- own compatibility rules, defaults, and error messages when schema or config fields expand

Adapter layer responsibilities:

- place RepoBrain payloads at the right point in the target agent workflow
- translate the same contract into the agent's native instruction format
- emit extract candidates or reinforce events without bypassing RepoBrain Core
- provide a markdown fallback when the agent cannot emit the preferred JSON envelope

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

### 3. Session End: extract candidate

- Preferred output: JSON envelope
- Markdown fallback: summary block that can be piped to `brain extract`
- Contract examples:
  - [`contracts/session-end.extract-candidate.json`](./contracts/session-end.extract-candidate.json)
  - [`contracts/session-end.extract-candidate.md`](./contracts/session-end.extract-candidate.md)

### 4. Failure Path: reinforce event

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

| Adapter | Session start | Task known | Session end | Failure handling |
| --- | --- | --- | --- | --- |
| Claude Code | Skill/hook consumes inject markdown | Skill or hook reads `invocation_plan` JSON | Hook or operator emits extract candidate | Hook can emit reinforce event or call `brain reinforce` |
| Codex | Session instructions consume inject markdown | SKILL routes on `invocation_plan` JSON | Operator or automation emits extract candidate | Operator or automation runs reinforce event |
| Cursor | Rule file points operator to inject markdown | Rule file points operator to `invocation_plan` JSON | Usually markdown fallback | Usually markdown fallback plus manual CLI |
| Copilot | Custom instructions consume inject markdown | Custom instructions point to `invocation_plan` JSON | Usually markdown fallback | Usually shell or CI-driven reinforce |

## Included Adapters

- [`claude/`](./claude/): Claude Code workflow, template, and limits
- [`codex/`](./codex/): Codex workflow, template, and limits
- [`cursor/`](./cursor/): Cursor rule-based adapter
- [`copilot/`](./copilot/): GitHub Copilot custom instructions adapter

Start from the relevant adapter template, keep the wording local to your team, and preserve the shared contract files above as the source of truth.
