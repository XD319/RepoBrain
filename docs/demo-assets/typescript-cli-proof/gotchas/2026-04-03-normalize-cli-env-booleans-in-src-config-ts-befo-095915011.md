---
type: "gotcha"
title: "Normalize CLI env booleans in src/config.ts before Commander validation"
summary: "In this TypeScript CLI repo, src/config.ts reads env defaults before src/cli.ts hands control to Commander."
tags:
  - "gotcha"
  - "infra"
  - "config"
  - "cli"
  - "normalize"
  - "env"
importance: "medium"
score: 60
hit_count: 1
last_used: "2026-04-03"
created_at: "2026-04-03"
created: "2026-04-03"
updated: "2026-04-03"
stale: false
supersedes: null
superseded_by: null
version: 1
date: "2026-04-03T09:59:15.011Z"
source: "session"
status: "active"
related:
path_scope:
  - "src/**"
files:
  - "src/config.ts"
  - "src/cli.ts"
recommended_skills:
required_skills:
suppressed_skills:
skill_trigger_paths:
skill_trigger_tasks:
area: "infra"
invocation_mode: "optional"
risk_level: "low"
---

## GOTCHA

gotcha: Normalize CLI env booleans in src/config.ts before Commander validation
In this TypeScript CLI repo, src/config.ts reads env defaults before src/cli.ts hands control to Commander.
If boolean-like strings are passed through untouched, release smoke validation misreads dry-run flags and package verification becomes noisy.
Normalize boolean env defaults in src/config.ts before wiring them into Commander option parsing.
