# Evaluation 评测

RepoBrain 的 proof layer 不能只证明“功能很多”，还要证明核心闭环在代表性场景下是可信的。

## 运行评测脚本

```bash
npm run eval:proof
```

脚本会跑三类评测：

## 1. 抽取质量

- durable、repo-specific 的经验会被接受并正确分类
- 低信息密度的状态汇报会被拒绝，不污染 `.brain/`

## 2. Inject 命中质量

- 对当前任务真正相关的 memory 会在 `brain inject` 中优先于泛化提醒
- 注入结果会保留 task-aware 的命中原因

## 3. Review / Supersede 质量

- 新 memory 真正替换旧规则时，会被识别为 `supersede`
- 新颖的 workflow memory 仍然会被接受为新知识

## 为什么选这些 case

这些 case 对应了开源用户最先会问的几个问题：

- extract 会不会把噪音一起收进去？
- inject 给我的，是现在真正相关的上下文吗？
- review 层能不能阻止过期或重复 guidance 一直堆积？

这个评测脚本故意保持轻量和确定性。它不是在比吞吐或延迟，而是在验证 proof loop 在代表性 repo-memory 决策上是否正确工作。
