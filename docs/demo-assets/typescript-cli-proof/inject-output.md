# Project Brain: Repo Knowledge Context

Before starting the current task, review the project knowledge below. It captures repo decisions, limits, and conventions that should be followed unless you have a clear reason to deviate.

Selection mode: task-aware (task="tighten config parsing for npm release smoke validation" | paths=src/config.ts, src/cli.ts | modules=cli). Memories are ranked by contextual score, then injection priority.

## Injected Memories (Priority Order)
- [decision | high] Release changes should start with checklist and install smoke validation
  First-release work should route through the release checklist and packaged install smoke validation before publish.
  Scope: When package.json, release docs, or publish workflow files change, start with the release checklist. Use packaged install smoke validation before publish so the first npm release p | tags: release, npm, smoke
  Why now: task trigger: publish npm release; task keywords: npm, release, smoke
- [gotcha | medium] Normalize CLI env booleans in src/config.ts before Commander validation
  In this TypeScript CLI repo, src/config.ts reads env defaults before src/cli.ts hands control to Commander.
  Scope: gotcha: Normalize CLI env booleans in src/config.ts before Commander validation In this TypeScript CLI repo, src/config.ts reads env defaults before src/cli.ts hands control to Com | tags: gotcha, infra, config, cli, normalize, env
  Why now: task keywords: config, validation; module scope: cli

---
Source: .brain/ (2 records, last updated: 2026-04-03T09:59:15.011Z)
[RepoBrain] injected 2/2 eligible memories.
Requirements:
- Understand these memories before choosing an implementation plan
- If you need to conflict with a high-priority memory, explain why first
- Do not suggest approaches that have already been ruled out
