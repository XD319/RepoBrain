# Case Study：全栈 Web 仓库

## 仓库形态

- `src/api/payments/refund.ts`
- `src/web/routes/settings.tsx`
- `playwright.config.ts`
- `test/e2e/`

## 问题

全栈 Web 仓库通常会在多层面沉淀 durable knowledge：

- API 事务边界和 rollback gotcha
- 前端路由模块、共享 guard 的项目约定
- CI 与浏览器测试工作流规则

如果没有 repo memory layer，每次新 session 都会重复从代码和 flaky tests 里重新发现这些约束。

## RepoBrain 工作流

1. 修完 refund bug 后，capture 一条 payment rollback gotcha
2. 下一次任务触达 `src/api/payments/` 时，通过 inject 带出这条知识
3. 再 capture 一条 browser-test routing decision，推荐先走 Playwright 调试
4. 当任务上下文明确后，用 `brain suggest-skills --format json` 做路由
5. 工具链迁移后，如果工作流变了，再通过 supersede 替换旧 guidance

## 为什么适合 RepoBrain

- backend、frontend、CI 三层都会沉淀 durable repo knowledge
- 不是每条高价值规则都适合写进静态文档，也不该塞进 agent 专属 middleware
- 因为 workflow guidance 会演化，所以 review / supersede 路径很关键

## 适合作为起点的 Memory

- `decision`：refund 写入在 ledger sync 前必须包在 transaction wrapper 内
- `gotcha`：浏览器测试 flake 时，先看 Playwright trace，再决定是否重跑
- `convention`：settings 页面统一走共享 auth guard
- `pattern`：API 与 e2e fixture 优先放在 focused fixture 目录，不要堆成大型 demo repo
