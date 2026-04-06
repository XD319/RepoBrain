# Evaluation 评测

RepoBrain 的 proof layer 不能只证明「功能很多」，还要证明核心闭环在代表性场景下可信：**低门槛偏好捕获**、**随策略变化的路由**、**时间语义与演化**、**session 不污染 durable**，以及**可见的反馈闭环**。

## 运行评测脚本

```bash
npm run build
npm run eval:proof
```

脚本为**确定性**流程，**不调用**远程大模型 API。

## Case 矩阵（每一类证明什么）

| Case 分类 | 证明点 |
| --- | --- |
| `extract_quality` | 抽取接受 durable 课、拒绝低信息闲聊（accept/reject 正确性） |
| `inject_hit` | `brain inject` 优先任务相关 memory，并保留 task-aware 命中说明 |
| `review_supersede` | reviewer 正确区分 supersede 与全新 memory |
| `feedback_negative_workflow` | 负向 workflow 信号生成 **preference 候选**（routing_feedback → 保存 avoid 候选） |
| `preference_routing` | 存储的 `avoid` 偏好会改变 `suggest-skills` / `invocation_plan`（路由随策略变） |
| `superseded_preference` | 带 `superseded_by` 的偏好**不参与**路由（过期/被取代过滤） |
| `session_profile_routing` | session `skill_routing` 与存储偏好在同一 skill 上可观测地叠加 |
| `session_pollution` | 写入 `session-profile.json` **不会**新增 durable memory 文件 |
| `routing_feedback_loop` | 正反馈可提升 prefer 置信度；`skill_ignored` 入队强化提醒 |
| `preference_phrase_precision` | 代表性自然语言能解析出预期 target 与 prefer/avoid |

## `eval:proof` 输出的指标

脚本在 case 列表后打印 **Metrics** 表，汇总：

| 指标 | 含义 |
| --- | --- |
| Extraction accept / reject | 抽取 case 中「接受课」与「拒绝闲聊」标志 |
| Preference phrase precision | 采样短语中 NL 解析命中预期 target + 偏好值的条数 |
| Route traceability | `routing_explanation` 是否含策略层说明与按 skill 的证据 |
| Stale / superseded filtering | 被取代的偏好是否在路由说明中被标记为跳过 |
| Session pollution prevention | 写入 session 后 memory 条数是否不变 |

这不是 LLM benchmark，而是检查**本地可核对**的契约（memory schema、routing JSON、偏好 eligibility）。

## 代表性 proof bundles（fixtures + 资产）

```bash
npm run proof:bundles
```

默认输出：[`docs/demo-assets/proof-bundles/`](./demo-assets/proof-bundles/README.md)

| Bundle | 典型仓库形态 |
| --- | --- |
| `typescript-cli/` | `package.json`、release 文档路径 — 库 / CLI 风格 |
| `fullstack-web/` | `e2e/`、`app/` — 全栈 + e2e 风格 |

每个 bundle 包含 **durable memory**、**preference**、**session profile**、**路由 JSON**（before/after/with-session）、**偏好捕获文本**、**时间线**、**反馈闭环** 等可检查文件。

## 为什么这不是「通用聊天记忆」

| 通用聊天日志 | RepoBrain durable + proof |
| --- | --- |
| 非结构化流水 | 带审核流程、时间字段与显式路由元数据的类型化 memory |
| 全部永久有效 | `superseded_by`、有效期、消费侧 stale/skip 规则 |
| session 等于长期记忆 | session profile **仅运行时**；晋升需显式操作 |
| 无法机器核对路由 | `suggest-skills` JSON + `routing_explanation` 可追溯 |

## 为什么 preference 与 durable 仓库知识分离

| Durable repo memory | Routing preference |
| --- | --- |
| 描述**代码库事实/决策**（decision、gotcha、convention） | 描述**在多种 skill/workflow 都合理时 agent 应如何倾向** |
| 按知识候选审核 | 常为 `candidate` 或低摩擦捕获；可能冲突需人处理 |
| 通过任务/路径触发器关联 | 对 skill/workflow/task_class 的 prefer/avoid/require_review |

偏好**不替代**仓库事实，而是在事实之上叠加**路由与调用策略**。

## 历史三类 bucket（仍保留在脚本中）

### 1. 抽取质量

- durable、repo-specific 的经验会被接受并正确分类
- 低信息密度的状态汇报会被拒绝，不污染 `.brain/`

### 2. Inject 命中质量

- 对当前任务真正相关的 memory 会在 `brain inject` 中优先于泛化提醒
- 注入结果会保留 task-aware 的命中原因

### 3. Review / Supersede 质量

- 新 memory 真正替换旧规则时，会被识别为 `supersede`
- 新颖的 workflow memory 仍然会被接受为新知识

## 为什么需要这些 case

对应新用户会问的问题：抽取是否进噪音、inject 是否相关、review 是否防堆积，以及**偏好是否可捕获**、**路由是否可追溯**、**时间语义是否正确**、**session 是否污染 durable**、**反馈能否闭环**。

评测脚本刻意保持轻量与确定性：验证 proof loop 在代表性决策上是否正确，而不是比吞吐或延迟。
