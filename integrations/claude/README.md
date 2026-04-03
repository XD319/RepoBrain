# Claude Adapter

Claude Code is the richest thin adapter because it can combine a skill file with session hooks, but it still consumes and emits the same RepoBrain contract as every other adapter.

## Workflow

```text
session start hook
  -> brain inject
  -> Claude reads inject markdown
task becomes clear
  -> brain suggest-skills --format json
  -> Claude routes on invocation_plan
session end
  -> emit extract candidate
failure detected
  -> emit reinforce event
```

## Minimal Integration

1. Copy [`SKILL.md`](./SKILL.md) into your Claude skill location.
2. Run `brain inject` before non-trivial work.
3. Run `brain suggest-skills --format json` once the task is known.
4. Pipe a short markdown summary to `brain extract` when the session ends.

## Recommended Integration

1. Keep the skill file as the human-readable contract adapter.
2. Use the existing RepoBrain session-start hook to inject markdown automatically.
3. Use the existing session-end hook to save extract candidates in `suggest` mode.
4. When a failure violates an existing memory, send the failure event to `brain reinforce`.

## Limitations

- Claude-specific hooks can improve ergonomics, but they are optional wrappers around the same Core commands.
- Adapters should not treat Claude tool calls as a separate durable schema.
- If hooks are unavailable, Claude falls back cleanly to markdown summaries and manual CLI steps.
