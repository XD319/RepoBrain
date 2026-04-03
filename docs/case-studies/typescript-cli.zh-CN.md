# Case Study：TypeScript CLI 仓库

## 仓库形态

- `src/cli.ts`
- `src/config.ts`
- `package.json`
- `docs/release-checklist.md`

## 问题

团队经常需要重复向 coding agent 解释两件事：

- 配置默认值先在 `src/config.ts` 读取，再进入 Commander 解析
- release 类任务应该先走 checklist 和 packaged smoke validation，而不是临时拼 shell 步骤

## RepoBrain 工作流

1. 从一次真实修复里 capture 配置解析 gotcha
2. review 并 approve，沉淀成 durable repo knowledge
3. 下一次 session 只要 `src/config.ts` 或 `src/cli.ts` 在范围内，就通过 inject 带上这条记忆
4. 当任务变成“准备首个 npm release”时，再跑 `brain suggest-skills --format json`

## 为什么适合 RepoBrain

- 这些知识是 repo-specific、durable、可 review 的
- 输出需要 local-first、Git-friendly
- 这个工作流同时受益于 `inject` 和 `invocation_plan`

## 可验证资产

- 可执行 demo：[`docs/demo-proof.zh-CN.md`](../demo-proof.zh-CN.md)
- 真实 transcript：[`docs/demo-assets/typescript-cli-proof/transcript.md`](../demo-assets/typescript-cli-proof/transcript.md)
- 真实 invocation plan：[`docs/demo-assets/typescript-cli-proof/invocation-plan.json`](../demo-assets/typescript-cli-proof/invocation-plan.json)
