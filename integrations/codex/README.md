# Codex Adapter

Codex is intentionally a thin workflow adapter. The goal is not to build a Codex SDK, but to give Codex a stable contract for consuming context and returning durable lessons.

## Workflow

```text
new session
  -> brain inject
  -> Codex reads inject markdown
task known
  -> brain suggest-skills --format json
  -> Codex follows invocation_plan
task finished
  -> Codex emits extract candidate
task failed or repeated an old mistake
  -> Codex emits reinforce event
```

## Minimal Integration

1. Copy [`SKILL.md`](./SKILL.md) into your Codex instructions area.
2. Run `brain inject` before non-trivial edits.
3. Run `brain suggest-skills --format json` when the task and touched paths are known.
4. Save a short markdown recap and pipe it to `brain extract`.

## Recommended Integration

1. Keep the SKILL file as the adapter contract.
2. Use lightweight automation or shell aliases to fetch inject output and invocation plans.
3. Emit the extract candidate JSON envelope when the session produces a durable repo lesson.
4. Emit the reinforce event JSON envelope when the change violated an old memory or repeated a known failure.

## Limitations

- Codex instructions do not provide a first-class durable memory store, so RepoBrain remains the only durable source.
- Most Codex setups will use shell-driven extraction and reinforcement instead of deep UI-native hooks.
- When structured JSON is awkward, the markdown fallback is the expected path rather than a degraded one.
