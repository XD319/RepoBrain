# Cursor Adapter

Cursor stays rules-first. That means the adapter is mostly workflow guidance plus markdown and JSON contract references, not a deep programmable integration.

## Workflow

1. Open a task and read `brain inject` output before large edits.
2. When the task is specific enough, read `brain suggest-skills --format json` and follow `invocation_plan`.
3. At session end, summarize the durable lesson in the extract-candidate markdown or JSON shape.
4. If the task failed against an existing memory, summarize the failure and route it to `brain reinforce`.

## Minimal Integration

1. Copy [`repobrain.mdc`](./repobrain.mdc) to `.cursor/rules/repobrain.mdc`.
2. Run `brain inject` manually for complex tasks.
3. Run `brain suggest-skills --format json` when tool or workflow choice is unclear.
4. Pipe a markdown summary to `brain extract` or `brain reinforce`.

## Recommended Integration

1. Keep the rules file small and point it at the shared contract examples.
2. Use a task runner, shell alias, or editor action to fetch inject output and invocation plans.
3. Prefer JSON envelopes when you have external automation around Cursor.
4. Fall back to markdown summaries when working only inside the editor.

## Limitations

- Cursor rules do not guarantee structured output emission on their own.
- Most teams will rely on manual or shell-assisted extraction and reinforcement.
- The adapter should not become a Cursor-only memory layer or project-note system.
