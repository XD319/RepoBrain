# Codex Adapter

Codex is intentionally a thin workflow adapter. The goal is not to build a Codex SDK, but to give Codex a stable contract for consuming context and returning durable lessons. Codex may already have its own task or action selection behavior; RepoBrain does not replace that. It adds repo-local, deterministic, auditable routing policy on top.

## Workflow

```text
new session
  -> brain start --format json
  -> Codex reads context_markdown and skill_plan
task known
  -> brain suggest-skills --format json (optional direct routing payload)
  -> Codex follows invocation_plan when needed
task finished
  -> Codex emits extract candidate
task failed or repeated an old mistake
  -> Codex emits reinforce event
```

## Minimal Integration

1. Copy [`SKILL.md`](./SKILL.md) into your Codex instructions area.
2. Prefer `brain start --format json --task "<task>"` before non-trivial edits.
3. Use `brain suggest-skills --task "<task>"` when you want to inspect the raw routing payload manually.
4. Save a short markdown recap and pipe it to `brain extract`.

## Recommended Integration

1. Keep the SKILL file as the adapter contract.
2. Use lightweight automation or shell aliases to fetch `brain start --format json` at session start.
3. When only routing is needed later, consume `brain suggest-skills --format json` and route on `invocation_plan`.
4. Emit the extract candidate JSON envelope when the session produces a durable repo lesson.
5. Emit the reinforce event JSON envelope when the change violated an old memory or repeated a known failure.

## Limitations

- Codex instructions do not provide a first-class durable memory store, so RepoBrain remains the only durable source.
- Most Codex setups will use shell-driven extraction and reinforcement instead of deep UI-native hooks.
- Adapters must not write directly into `.brain/`; durable writes still go through RepoBrain Core.
- When structured JSON is awkward, the markdown fallback is the expected path rather than a degraded one.
