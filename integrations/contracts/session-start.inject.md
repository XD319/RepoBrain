# RepoBrain Contract Example: Session Start Inject

Use this markdown block as the canonical session-start payload. Adapters should treat it as opaque context from Core, not re-parse it into a second schema.

```md
<!-- repobrain:inject@v1 -->
# RepoBrain Inject

Task hint: Refactor config loading for CLI startup
Paths: src/config.ts, src/cli.ts
Modules: cli

## Active Memories

### decision: Keep config parsing inside `src/config.ts`
- Why it matters: previous refactors split parsing and validation too early and broke CLI defaults.
- Scope: src/config.ts, src/cli.ts
- Tags: cli, config

### gotcha: `extractMode` must default to `suggest`
- Why it matters: hooks depend on reviewable candidates instead of silent direct writes.
- Scope: .brain/config.yaml, src/config.ts
- Tags: config, hooks, extract

## Session Guidance

- Preserve CLI compatibility unless the task explicitly changes it.
- Prefer narrow edits around config loading and validation.
- Save durable lessons through RepoBrain instead of agent-local notes.
```
