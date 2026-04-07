# 时间语义（Temporal Semantics）

本文承接原 `README.md` 中关于 validity window 与时间字段的详细说明。

## 设计目标

RepoBrain 将时间状态放在 frontmatter 中维护，不引入外部数据库，同时保持 Git 可审查、可回滚。

## 当前有效性判定

`brain inject` 与 `brain suggest-skills` 默认只消费“当前有效”条目：

- `status` 处于可消费状态（通常为 active）
- 非 `stale`
- 未被 `superseded_by` 标记取代
- 在 `valid_from` / `valid_until` 窗口内（若设置）
- `review_state` 不是 `pending_review`
- 短期 `working` 未超过 `expires`

preferences 同样按有效期、状态和 supersession 规则消费。

## 自动维护触发点

RepoBrain 在常规命令中自动刷新时间语义字段：

- `brain supersede`：建立 supersede 链并更新相关字段
- `brain approve`：刷新批准后的时间戳与 review 状态
- `brain dismiss` / `brain score`：标记 stale 时更新相应字段
- preference 相关 normalize/supersede/dismiss 命令会统一时间元数据
- `brain normalize-memory` 会回填安全默认值（如 `valid_from`、`observed_at`）

## 时间线与解释命令

```bash
brain timeline
brain timeline <file-or-id>
brain timeline --preferences
brain explain-memory <id>
brain explain-preference <id>
```

这些命令用于查看演化链路与“当前是否会被消费”的解释信息。

## 示例：偏好演进

1. 旧偏好 A 为 active
2. 新偏好 B 被记录并 supersede A
3. A 变为非当前有效（带 superseded 与窗口结束语义）
4. 路由只消费当前有效偏好
5. 历史仍完整保留在 Git 中
