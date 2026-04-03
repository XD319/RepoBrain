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
