# RepoBrain 架构设计

本文承接原 `README.md` 中迁出的详细内容：Knowledge Layers 设计、Routing Engine、Reviewer Pipeline、集成契约、Extractor 扩展点。

## 1. 三层知识模型

RepoBrain 将长期知识、路由偏好、会话临时约束分层：

| 层级 | 位置 | 作用 |
| --- | --- | --- |
| Durable repo knowledge | `.brain/{decisions,gotchas,conventions,patterns,...}/` | 可审计、可评审、可版本化的长期知识 |
| Routing preference | `.brain/preferences/` | 可复用的 skill/workflow 偏好（prefer/avoid） |
| Session profile | `.brain/runtime/session-profile.json` | 当前会话的本地临时约束 |

Session profile 在路由合并阶段后置，可覆盖普通 preference，但不覆盖硬阻断（blocked/suppress）与静态 required 约束。

## 2. 路由引擎

路由完全本地、确定性执行。核心组合：

`static_memory_policy_input` + `preference_policy_input` + 可选 `session_policy_input` + `task_context_input` -> `routing_engine` -> `invocation_plan`

优先级（高到低）：

1. blocked / 显式 suppress
2. 静态 `required_skills`
3. session profile 路由结果
4. 负向 preference（`avoid`）
5. 正向 preference（`prefer`）
6. 静态推荐技能
7. optional/fallback 软信号

路由输出字段：

- `matched_memories`
- `resolved_skills`
- `conflicts`
- `invocation_plan`（`required`、`prefer_first`、`optional_fallback`、`suppress`、`blocked`、`human_review`）
- 可选 `routing_explanation`
- `path_source`（`explicit` / `git_diff` / `none`）

## 3. Session Bundle（`brain route` / `brain start`）

`brain route` / `brain start` 会打包：

- 来自 `brain inject` 的紧凑上下文
- 来自 `brain suggest-skills --format json` 的任务路由计划
- 适配器可直接消费的 JSON 合同，包含 `display_mode` 与 `warnings`

`display_mode`：

- `silent-ok`：可静默消费
- `needs-review`：存在 blocked/human review/冲突升级

## 4. 集成分层架构

RepoBrain 坚持“稳定核心 + 轻量适配器”：

核心层负责：

- schema 与存储
- 确定性 review/dedupe/supersede 决策
- context 注入与 routing 计算

适配层负责：

- 将 RepoBrain 输出翻译为各 agent 指令格式
- 在阶段完成时触发 `brain capture`
- 保持 candidate-first
- 不绕过核心检查直接写入 `.brain/`

统一生命周期契约：

1. session start（`brain start` 或回退 `brain inject`）
2. task-known routing（`brain suggest-skills`）
3. phase-completion 检测（`brain capture`）
4. session-end 提取候选
5. failure reinforcement 路径

## 5. 阶段完成信号

信号分级：

- 强信号：明确完成语义、测试 fail->pass、较大 diff
- 依赖上下文信号：子模块完成、跨文件重构、重复问题修复（需价值证据）
- 弱信号（排除）：仅“好的/谢谢/ok”等无实质信息确认

这些信号用于提升 capture 置信度，不是强制 `should_extract=true`。

## 6. Reviewer Pipeline

`brain extract` 与候选决策使用分层确定性审核：

1. 可比性过滤（`type`、状态、scope）
2. 证据向量构建（identity/scope/文本重叠/replacement/recency/lineage）
3. 内部关系判定：
   - `duplicate`
   - `additive_update`
   - `full_replacement`
   - `possible_split`
   - `ambiguous_overlap`
4. 映射为公开决策：
   - `accept`
   - `merge`
   - `supersede`
   - `reject`

该设计可避免在多目标模糊重叠时误合并。

## 7. 安全自动提升

启用 `autoApproveSafeCandidates: true` 时，自动提升必须同时满足：

- reviewer 为 `accept` 且 reason=`novel_memory`
- memory 类型不是 `working`
- 内容非临时噪声
- 无 merge/supersede/reject 冲突信号

其余候选继续走人工 `review/approve`。

## 8. 本地抽取器与外部契约

内置抽取器阶段：

`preprocess -> chunk -> candidate detection -> type classification -> field completion -> quality scoring -> prescreen dedupe -> deterministic review`

外部扩展方式：

- 设置 `BRAIN_EXTRACTOR_COMMAND`
- RepoBrain 通过 `stdin` 传 prompt
- 外部命令通过 `stdout` 返回 `{ "memories": [...] }`
- 输出非法或执行失败时自动回退本地管线

`detectFailures` 也使用类似的本地进程契约。

## 9. 路由反馈闭环

RepoBrain 可接收本地路由事件：

- `skill_followed`
- `skill_ignored`
- `skill_rejected_by_user`
- `workflow_too_heavy`
- `workflow_success`
- `workflow_failure`
- `routing_conflict_escalated`

策略保持保守：

- 负反馈默认写 candidate `avoid`
- 强冲突标记为 `pending_review`
- 提醒写入 reinforce pending 队列等待人工处理

## 10. 相关文档

- CLI 参考：[`docs/cli-reference.zh-CN.md`](./cli-reference.zh-CN.md)
- Schema：[`docs/schema.zh-CN.md`](./schema.zh-CN.md)
- Workflow 模式：[`docs/workflow-modes.zh-CN.md`](./workflow-modes.zh-CN.md)
- 时间语义：[`docs/temporal-semantics.zh-CN.md`](./temporal-semantics.zh-CN.md)
