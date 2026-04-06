---
type: "decision"
title: "Release must run packaged install smoke before publish"
summary: "Replaces dry-run-only guidance."
tags:
  - "release"
  - "smoke"
importance: "high"
score: 60
hit_count: 0
last_used: null
created_at: "2026-04-01T10:00:00.000Z"
created: "2026-04-01"
updated: "2026-04-01"
stale: false
supersedes: "conventions/2026-03-01-release-validation-used-npm-pack-dry-run-only-100000000.md"
superseded_by: null
version: 2
date: "2026-04-01T10:00:00.000Z"
status: "active"
related:
path_scope:
  - "docs/release-checklist.md"
  - "package.json"
files:
recommended_skills:
  - "npm-install-smoke"
required_skills:
  - "release-checklist"
suppressed_skills:
  - "imagegen"
skill_trigger_paths:
  - "docs/release-checklist.md"
  - "package.json"
skill_trigger_tasks:
  - "publish npm"
  - "prepare release"
valid_from: "2026-04-01"
observed_at: "2026-04-01T10:00:00.000Z"
invocation_mode: "prefer"
risk_level: "medium"
---

## DECISION

Smoke required.
