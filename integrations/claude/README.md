# Claude Adapter

Claude Code is the richest thin adapter because it can combine a skill file with session hooks, but it still consumes and emits the same RepoBrain contract as every other adapter. Claude may already have its own task or action selection behavior; RepoBrain does not replace that. It adds repo-local, deterministic, auditable routing policy on top.

## Workflow

```text
session start hook
  -> brain start --format json
  -> Claude reads context_markdown and skill_plan
task becomes clear
  -> brain suggest-skills --format json (optional direct routing payload)
  -> Claude routes on invocation_plan when needed
session end
  -> emit extract candidate
failure detected
  -> emit reinforce event
```

## Minimal Integration

1. Copy [`SKILL.md`](./SKILL.md) into your Claude skill location.
2. Prefer `brain start --format json --task "<task>"` before non-trivial work.
3. Use `brain suggest-skills --task "<task>"` when you want to inspect the raw routing payload manually.
4. Pipe a short markdown summary to `brain extract` when the session ends.

## Recommended Integration

1. Keep the skill file as the human-readable contract adapter.
2. Use the existing RepoBrain session-start hook to fetch `brain start --format json` automatically.
3. Use the existing session-end hook to save extract candidates in `suggest` mode.
4. When only routing is needed after the task becomes clearer, consume `brain suggest-skills --format json` and route on `invocation_plan`.
5. When a failure violates an existing memory, send the failure event to `brain reinforce`.

## Limitations

- Claude-specific hooks can improve ergonomics, but they are optional wrappers around the same Core commands.
- Adapters should not treat Claude tool calls as a separate durable schema.
- Adapters must not write directly into `.brain/`; durable writes still go through `brain extract` or `brain reinforce`.
- If hooks are unavailable, Claude falls back cleanly to markdown summaries and manual CLI steps.
