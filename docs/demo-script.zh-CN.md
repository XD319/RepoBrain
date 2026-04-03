# RepoBrain 演示脚本

这份脚本用于首个公开演示 GIF。目标是在 3 分钟内讲清楚最小但可信的产品闭环。

## 目标

演示 RepoBrain 如何：

1. 在真实仓库里初始化 durable repo memory
2. 沉淀一条具体且可复用的经验
3. 在下一个 coding session 开始前把这条经验重新注入
4. 保持整个流程可 review、可走 Git

## 录制准备

- 终端字号足够大，移动端也能看清
- 使用一个全新的示例仓库，当前还没有 `.brain/`
- 已安装 Node.js 和 npm
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

## 场景 3：沉淀一条真实经验

准备一段足够具体的 session 总结：

```bash
cat > session-summary.txt <<'EOF'
gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
EOF
```

执行：

```bash
cat session-summary.txt | brain extract
brain list
```

停留展示：

- deterministic review 输出
- 被接受的 memory
- `.brain/gotchas/` 下新增的 markdown 文件

旁白建议：

`RepoBrain 不会把所有笔记都直接落盘。它会先判断这段输入是否足够具体、足够长期有价值。`

## 场景 4：在下一个 Session 开始前注入记忆

执行：

```bash
brain inject --task "refactor config loading for the CLI" --path src/config.ts --path src/cli.ts --module cli
```

停留展示：

- 注入出来的 memory block
- 末尾的 requirements 提示

旁白建议：

`这样下一次 session 一开始就能带着 repo-specific context，不需要再让 agent 重复踩同一个坑。`

## 场景 5：补一句团队工作流

快速展示：

```bash
brain review
brain approve --safe
brain share --all-active
```

旁白建议：

`所有写入路径都保持可 review。团队可以审批、分享，再把 `.brain/` 变更和代码一起提交。`

## 收尾画面

最后把三条命令放在一起：

```bash
brain setup
cat session-summary.txt | brain extract
brain inject
```

收尾台词：

`RepoBrain 给 coding agent 提供了一条 Git-friendly 的仓库记忆闭环：沉淀一次，review 一次，之后每个 session 都能复用。`
