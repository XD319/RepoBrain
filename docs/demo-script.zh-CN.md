# RepoBrain 演示脚本

这份脚本用于录制首个公开 demo GIF，现在它会和可执行证明文档 [docs/demo-proof.zh-CN.md](./demo-proof.zh-CN.md) 配合使用，而不是单独充当 storyboard。

## 目标

演示 RepoBrain 如何：

1. 在真实仓库里初始化 durable repo memory
2. capture 第一条 memory
3. 先 review / approve，再写入长期知识
4. 在下一次 session 开始前通过 RepoBrain 的智能 conversation bootstrap 刷新这条知识
5. 对明确任务产出真实的 `suggest-skills` / `invocation_plan`

## 录制准备

- 终端字号足够大，移动端也能看清
- 一个全新的示例仓库，当前还没有 `.brain/`
- Node.js 和 npm 已安装
- RepoBrain 自身已经执行过 `npm install`、`npm run build`、`npm link`

## 场景 1：先展示问题

打开仓库根目录，确认当前还没有 `.brain/`。

旁白建议：

`RepoBrain 把真正会在以后反复用到的仓库知识留在仓库里，而不是埋在历史聊天里。`

## 场景 2：初始化 RepoBrain

执行：

```bash
brain setup
```

停留展示：

- 新建的 `.brain/` 目录
- 生成的配置文件
- 关于可选 Git hook 的提示

旁白建议：

`初始化步骤刻意保持很小：先建立本地知识存储，再按需安装一个低风险的 post-commit hook。`

## 场景 3：Capture 第一条真实经验

准备一段足够具体的 session 总结：

```bash
cat > session-summary.txt <<'EOF'
gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
EOF
```

执行：

```bash
cat session-summary.txt | brain extract --candidate
brain review
brain approve --safe
```

停留展示：

- deterministic extraction review 输出
- candidate review 列表
- approve 步骤
- `.brain/gotchas/` 下新增的 markdown 文件

旁白建议：

`RepoBrain 不会把所有笔记都直接落盘。它会先判断这段输入是否足够具体、足够长期有价值，再通过 review/approve 进入长期知识。`

## 场景 4：下一次 Session 开始前智能刷新记忆

执行：

```bash
brain conversation-start --format json --task "refactor config loading for the CLI" --path src/config.ts --path src/cli.ts --module cli
```

停留展示：

- 返回的刷新决策与 context block
- 末尾的 requirements 提示

旁白建议：

`这样下一次 session 一开始就能按需续上 repo-specific context，不需要再让 agent 重复踩同一个坑。`

## 场景 5：展示任务路由

补一段：

```bash
brain suggest-skills --format json --task "prepare first npm release" --path package.json --path docs/release-checklist.md
brain share --all-active
```

旁白建议：

`写路径保持可 review。团队可以 approve、share、commit `.brain/` 变更，adapter 也可以直接消费真实的 invocation plan。`

## 收尾画面

最后把命令压成一组：

```bash
brain setup
cat session-summary.txt | brain extract --candidate
brain review && brain approve --safe
brain conversation-start --format json --task "refactor config loading for the CLI"
```

收尾台词：

`RepoBrain 给 coding agent 提供了一条 Git-friendly 的仓库记忆闭环：capture 一次，review 一次，之后每个 session 都能复用。`
