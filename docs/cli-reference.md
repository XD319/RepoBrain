# CLI Reference

Complete command reference moved from `README.md`.

## Core Setup

- `brain init`: initialize `.brain/` in current repo and generate steering rules
- `brain setup`: initialize `.brain/`, apply workflow preset, optionally install low-risk post-commit hook

## Extraction and Capture

- `brain extract`: extract durable memory from `stdin`
- `brain extract --type working`: force output memory type to `working`
- `brain extract --type goal`: force output memory type to `goal`
- `brain extract-commit`: extract from richer git commit context
- `brain suggest-extract`: local heuristic check for whether extraction is worth doing
- `brain capture`: suggest-extract + extract in one step, candidate-first by default

Examples:

```bash
cat session-summary.txt | brain extract
brain suggest-extract --task "fix refund bug" --path src/payments/handler.ts --json
echo "gotcha: retry loop exits too early" | brain capture --task "fix refund bug" --path src/payments/handler.ts
```

## Context and Routing

- `brain inject`: build compact repo-context block, especially useful for a fresh conversation later in the same session
- `brain suggest-skills`: build deterministic skill routing plan
- `brain route` / `brain start`: return the combined context + routing bundle for session bootstrap

Examples:

```bash
brain inject --task "refactor config loading" --path src/config.ts --path src/cli.ts --module cli
brain suggest-skills --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain start --format json --task "fix refund bug"
```

## Candidate Review and Promotion

- `brain review`: inspect candidate memories
- `brain approve <id>` / `brain approve --safe` / `brain approve --all`
- `brain dismiss <id>` / `brain dismiss --all`
- `brain promote-candidates [--dry-run]`: auto-promote strict safe candidates when enabled

## Memory Management

- `brain list [--type <type>] [--goals]`
- `brain search "<query>" [--type] [--tag] [--status] [--all] [--json]`
- `brain stats`
- `brain goal done <keyword>`
- `brain supersede <new-memory-file> <old-memory-file>`
- `brain lineage [<file>]`
- `brain timeline [<file-or-id>] [--preferences]`
- `brain explain-memory <id>`
- `brain explain-preference <id>`

## Hygiene and Diagnostics

- `brain status`
- `brain next`
- `brain audit-memory [--json]`
- `brain score`
- `brain sweep [--dry-run|--auto]`
- `brain lint-memory`
- `brain normalize-memory`

## Reinforcement and Feedback

- `brain reinforce --pending`
- `brain reinforce < session-summary.txt`
- `brain routing-feedback` (JSON array or NDJSON from stdin)
- `brain routing-feedback --explain <skill>`
- `brain routing-feedback --ack-reminders`

## Team and Integrations

- `brain share <memory-id>`
- `brain share --all-active`
- `brain mcp`

## Global Debugging

- Use `brain --debug ...` or `REPOBRAIN_DEBUG=1` for internal stack traces.
- User-facing usage errors remain concise on `stderr` with exit code `1`.
