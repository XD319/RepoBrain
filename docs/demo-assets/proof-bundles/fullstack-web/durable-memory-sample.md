---
type: "decision"
title: "E2E uses Playwright against staging API"
summary: "Web stack smoke."
tags:
  - "e2e"
  - "web"
importance: "high"
score: 60
hit_count: 0
last_used: null
created_at: "2026-04-03T10:00:00.000Z"
created: "2026-04-03"
updated: "2026-04-03"
stale: false
supersedes: null
superseded_by: null
version: 1
date: "2026-04-03T10:00:00.000Z"
status: "active"
related:
path_scope:
  - "app"
  - "e2e"
files:
recommended_skills:
  - "eslint"
required_skills:
  - "playwright"
suppressed_skills:
  - "cypress"
skill_trigger_paths:
  - "app/checkout/page.tsx"
  - "e2e/checkout.spec.ts"
skill_trigger_tasks:
  - "fix checkout bug"
  - "debug flaky e2e"
valid_from: "2026-04-03"
observed_at: "2026-04-03T10:00:00.000Z"
invocation_mode: "prefer"
risk_level: "medium"
---

## DECISION

Playwright e2e.
