---
type: "gotcha"
title: "Normalize CLI env booleans in src/config.ts before Commander validation"
summary: "In this TypeScript CLI repo, src/config.ts reads env defaults before src/cli.ts hands control to Commander."
tags:
  - "cli"
  - "config"
  - "env"
  - "gotcha"
  - "infra"
  - "normalize"
importance: "medium"
score: 60
hit_count: 1
last_used: "2026-04-08"
created_at: "2026-04-08T00:00:00.000Z"
created: "2026-04-08"
updated: "2026-04-08"
stale: false
supersedes: null
superseded_by: null
version: 1
date: "2026-04-08T09:42:13.220Z"
source: "session"
status: "active"
related: []
path_scope:
  - "src/**"
files:
  - "src/cli.ts"
  - "src/config.ts"
recommended_skills: []
required_skills: []
suppressed_skills: []
skill_trigger_paths: []
skill_trigger_tasks: []
area: "infra"
valid_from: "2026-04-08"
observed_at: "2026-04-08T00:00:00.000Z"
invocation_mode: "optional"
risk_level: "low"
---

## GOTCHA

gotcha: Normalize CLI env booleans in src/config.ts before Commander validation
In this TypeScript CLI repo, src/config.ts reads env defaults before src/cli.ts hands control to Commander.
If boolean-like strings are passed through untouched, release smoke validation misreads dry-run flags and package verification becomes noisy.
Normalize boolean env defaults in src/config.ts before wiring them into Commander option parsing.
