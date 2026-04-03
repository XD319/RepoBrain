# RepoBrain 团队工作流

这份文档描述的是团队里更实用的使用方式：让 `.brain/` 变更保持可 review、可提交，而不是变成另一种噪音来源。

## 默认团队闭环

1. 修掉一个真实问题，或完成一项有意义的任务。
2. 用 `brain extract`、`brain extract-commit`，或 hook 生成候选记忆。
3. 像 review 代码一样 review `.brain/` 里的变更。
4. 只批准那些仍然正确、具体、值得复用的 memories。
5. 如果这条知识本来就属于这次代码改动，就把 `.brain/` 和代码一起提交。

## 推荐规则

- `inject` 尽量自动化，或者至少保证足够顺手，因为它是只读的。
- `extract` 默认保持可 review，因为它会写 durable repo knowledge。
- 优先保留具体经验，不要保留空泛建议。
- 临时调试笔记如果不会再次出现，就不要写进 `.brain/`。
- 把 `.brain/` 当成项目共享知识，而不是个人草稿本。

## 建议的 PR 流程

1. 运行 `brain review`。
2. 批准那些仍然值得保留的 candidates。
3. 检查 `.brain/` 下新生成的 markdown。
4. 运行 `brain share <memory-id>` 或 `brain share --all-active`。
5. 复制它输出的 `git add` 和 `git commit` 建议命令。
6. 如果这些知识本来就属于本次改动，就和代码一起发 PR。

## 哪些内容适合进入 `.brain/`

适合保留：

- 带原因的架构或实现决策
- 容易重复踩坑的 repo-specific gotcha
- 未来 agent 应该遵守的仓库约定
- 可重复使用的实现模式或工作流模式

不适合保留：

- 一次性的调试过程
- 只对本机临时环境有意义的噪音
- 通用工具文档里已经很清楚的常识
- 范围过大、没有明确 repo 经验的泛化笔记

## 审核清单

在批准一条 memory 之前，至少问自己这五件事：

1. 它是不是这个 repo 或这个团队工作流特有的知识？
2. 它在未来 session 里还会有帮助吗？
3. 它的 scope 是否足够窄，避免制造注入噪音？
4. 它是否和现有 memory 重复或冲突？
5. 你是否愿意让它在下一个 coding session 开始时被自动注入？

## 发布前与清理时机

在准备发布或准备分享一大批 memory 之前，建议运行：

```bash
brain audit-memory
brain sweep --dry-run
brain score
```

准备公开 npm 包或首个 release 时，再配合使用 [release-checklist.zh-CN.md](./release-checklist.zh-CN.md)。
