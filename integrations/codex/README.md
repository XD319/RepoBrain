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
phase completion detected (recurring bug fix / submodule done / multi-file refactor / tests pass / user signals done)
  -> brain capture --task "<task>" --path <path>
  -> should_extract=true  → candidate saved for review
  -> should_extract=false → no action, no prompt
task failed or repeated an old mistake
  -> Codex emits reinforce event via brain reinforce
```

## Minimal Integration

1. Copy [`SKILL.md`](./SKILL.md) into your Codex instructions area.
2. Prefer `brain start --format json --task "<task>"` before non-trivial edits.
3. Use `brain suggest-skills --task "<task>"` when you want to inspect the raw routing payload manually.
4. At phase boundaries, run `brain capture --task "<task>" --path <path>` to let local rules decide.
5. Pipe a failure summary to `brain reinforce` when a known memory is violated.

## Recommended Integration

1. Keep the SKILL file as the adapter contract.
2. Use lightweight automation or shell aliases to fetch `brain start --format json` at session start.
3. When only routing is needed later, consume `brain suggest-skills --format json` and route on `invocation_plan`.
4. At phase boundaries, run `brain capture` and let the local detection decide. Default is candidate-first.
5. Emit the reinforce event JSON envelope when the change violated an old memory or repeated a known failure.
6. Do not repeat the same capture suggestion in the same conversation turn.

## Limitations

- Codex instructions do not provide a first-class durable memory store, so RepoBrain remains the only durable source.
- Most Codex setups will use shell-driven extraction and reinforcement instead of deep UI-native hooks.
- Adapters must not write directly into `.brain/`; durable writes still go through RepoBrain Core.
- When structured JSON is awkward, the markdown fallback is the expected path rather than a degraded one.
