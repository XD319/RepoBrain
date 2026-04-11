---
type: "decision"
title: "Release changes should start with checklist and install smoke validation"
summary: "First-release work should route through the release checklist and packaged install smoke validation before publish."
tags:
  - "npm"
  - "release"
  - "smoke"
importance: "high"
score: 60
hit_count: 1
last_used: "2026-04-11"
created_at: "2026-04-03T09:00:00.000Z"
created: "2026-04-03"
updated: "2026-04-03"
stale: false
supersedes: null
superseded_by: null
version: 1
date: "2026-04-03T09:00:00.000Z"
status: "active"
related: []
path_scope:
  - "docs/release-checklist.md"
  - "docs/release-guide.md"
  - "package.json"
files:
  - "docs/release-checklist.md"
  - "docs/release-guide.md"
  - "package.json"
recommended_skills:
  - "npm-install-smoke"
required_skills:
  - "release-checklist"
suppressed_skills:
  - "imagegen"
skill_trigger_paths:
  - "docs/release-checklist.md"
  - "docs/release-guide.md"
  - "package.json"
skill_trigger_tasks:
  - "prepare first npm release"
  - "publish npm release"
  - "release smoke validation"
valid_from: "2026-04-03"
observed_at: "2026-04-03T09:00:00.000Z"
invocation_mode: "prefer"
risk_level: "medium"
---

## DECISION

When package.json, release docs, or publish workflow files change, start with the release checklist.
Use packaged install smoke validation before publish so the first npm release proves installability instead of assuming it.
