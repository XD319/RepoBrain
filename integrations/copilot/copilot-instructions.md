# RepoBrain Instructions For Copilot

Use RepoBrain as the repository's durable memory layer.

Before making significant changes:

1. Read `brain inject --task "<current task>" --path <changed-path>` for compact repo context.
2. Read `brain suggest-skills --task "<current task>" --path <changed-path>` when tool or workflow choice is unclear.

Constraints:

- `.brain/` is the source of truth for durable repo knowledge.
- `brain inject` and `brain suggest-skills` are the only RepoBrain outputs this adapter should consume.
- Do not create Copilot-only memory files that duplicate RepoBrain decisions, gotchas, conventions, or patterns.
- When a new durable lesson is discovered, store it through RepoBrain workflows so every adapter can reuse it.
