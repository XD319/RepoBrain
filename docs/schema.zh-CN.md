# Schema 文档

本文承接原 `README.md` 迁出的 frontmatter 字段与 schema 规范。

## Memory 类型

- `decision`
- `gotcha`
- `convention`
- `pattern`
- 可选：`working`、`goal`

## 常用 frontmatter 字段

- `type`
- `title`
- `summary`
- `detail`
- `importance`
- `date`
- `tags`

## 生命周期与排序字段

- `score`（默认 `60`）
- `hit_count`（默认 `0`）
- `last_used`（默认 `null`）
- `created_at`（默认从 `date` 推导）
- `created`（日期格式，默认由 `created_at` 推导）
- `updated`（日期格式，默认等于 `created`）
- `stale`（默认 `false`）
- `status`（如 `active`、`done`、`stale`、`candidate`、`superseded`）
- `review_state`（`unset`、`pending_review`、`cleared`）

## 血缘与关系字段

- `supersedes`
- `superseded_by`
- `version`（默认 `1`）
- `related`
- `supersession_reason`

## 作用域与领域字段

- `path_scope`
- `files`
- `area`
- `expires`
- `origin`
- `source_episode`

## 时间有效性字段

- `valid_from`
- `valid_until`
- `observed_at`
- `confidence`（0-1，默认 `1`）

## Skill 路由字段

- `recommended_skills`
- `required_skills`
- `suppressed_skills`
- `skill_trigger_paths`
- `skill_trigger_tasks`
- `invocation_mode`（`required` / `prefer` / `optional` / `suppress`）
- `risk_level`（`high` / `medium` / `low`）

## 向后兼容与默认值

当路由字段缺省时，RepoBrain 会自动补安全默认值：

- 列表字段 -> `[]`
- `invocation_mode` -> `optional`
- `risk_level` -> `low`
- 其他生命周期字段按规则补齐

## 最佳实践

- 保持记忆“短而有因果”
- `tags` 少而稳，避免堆砌
- 避免在 `path_scope` 和 `files` 重复同一路径
- skill metadata 只在触发条件明确时填写
- 尽量用 lint/normalize 自动补齐，不做一次性手工大迁移

## 治理命令

```bash
brain lint-memory
brain normalize-memory
```

`lint-memory` 用于发现 schema 问题；`normalize-memory` 用于兼容范围内的安全归一化。

## 最小示例

```md
---
type: "decision"
title: "将浏览器测试任务路由到 Playwright 经验"
summary: "调试 flaky browser tests 时优先走 Playwright 方案。"
importance: "medium"
date: "2026-04-01T12:34:56.000Z"
path_scope:
  - "tests/e2e/"
required_skills:
  - "playwright"
invocation_mode: "prefer"
risk_level: "medium"
---
```
