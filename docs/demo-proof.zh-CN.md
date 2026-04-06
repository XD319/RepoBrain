# 可执行 Demo 证明

RepoBrain 现在不再只有 storyboard，而是提供了一套真正可执行的 demo 证明资产。

## 它证明什么

默认生成的 demo 会在一个 TypeScript CLI 风格仓库里走完整条最小可信闭环：

1. 初始化 RepoBrain
2. 抓取第一条 memory，并先保存为 candidate
3. review 并 approve
4. 下一次 session 执行 inject
5. 对 release 任务跑出真实的 `suggest-skills` / `invocation_plan`

## 如何运行

```bash
npm run demo:proof
```

如果你想把输出写到其他目录：

```bash
node scripts/generate-demo-proof.mjs --output-dir ./tmp/demo-proof
```

## 产出内容

默认会把真实资产写到 [`docs/demo-assets/typescript-cli-proof/`](./demo-assets/typescript-cli-proof/)：

- `transcript.md`：逐步命令与真实输出
- `session-summary.txt`：实际用于 capture 的输入
- `review-output.txt`：真实 `brain review` 输出
- `inject-output.md`：真实注入结果
- `invocation-plan.json`：适配器可直接消费的 `brain suggest-skills --format json` 结果
- demo 仓库中生成的 `.brain/` memory 文件

这些资产既可以直接被 README 链接，也可以作为录 GIF、做 smoke 演示和开源评估时的真实证据。

## Proof bundles（偏好、session、路由对比、反馈）

若需要在**单条 CLI transcript 之外**再提供一层证据，可运行：

```bash
npm run proof:bundles
```

脚本会生成两套代表性 bundle（TypeScript CLI + 全栈 web），默认输出在 [`docs/demo-assets/proof-bundles/`](./demo-assets/proof-bundles/README.md)，每套包含例如：

| 资产 | 作用 |
| --- | --- |
| `preference-capture-output.txt` | 自然语言偏好抽取样例（确定性启发式） |
| `route-before.json` / `route-after.json` | 同一任务与路径下，策略变更前后的路由快照 |
| `route-with-session.json` | 叠加 `.brain/runtime/session-profile.json` 后的结果 |
| `timeline-output.txt` | 记忆演化（CLI bundle 含 supersede 链） |
| `feedback-loop-output.txt` | `applyRoutingFeedback` 的结果（候选、bump、强化提醒） |
| `durable-memory-sample.md`、`preference-sample.md`、`session-profile.json` | 三层结构的快照 |

可与 [`docs/evaluation.md`](./evaluation.md)（`npm run eval:proof`）对照阅读：自动化 case 覆盖与 Metrics 表。
