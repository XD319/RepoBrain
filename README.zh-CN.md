[English](./README.md) | [简体中文](./README.zh-CN.md)

# RepoBrain

> 面向 coding agent 的 Git-friendly repo memory。

RepoBrain 的目标很直接：帮 Claude Code、Codex 这类 coding agent 记住这个仓库真正重要的上下文，比如架构决策、已知坑点、项目约定，以及可复用的实现模式，而不是把所有聊天记录都攒下来。

它不是一个通用聊天记忆平台。它不追求“永久保存所有对话”。它解决的是更实际的问题：每次新 session 开始时，AI agent 总会忘记这个仓库最关键的 decision、gotcha 和 convention。

## Hero

- 记住仓库知识，不是记住整段聊天
- 以 Markdown + frontmatter 的形式存进 `.brain/`
- local-first、markdown-first、git-friendly
- Claude Code / Codex 都能用

## Demo GIF

规划中的资源路径：`docs/demo.gif`

在正式录 GIF 之前，可以直接参考 [docs/demo-script.zh-CN.md](./docs/demo-script.zh-CN.md) 作为拍摄脚本。

推荐展示流程：

1. 同一个 repo 问题先修一次。
2. 把经验提取成 repo knowledge。
3. 开一个新的 session。
4. 运行 `brain inject`。
5. 展示 agent 因为看到了这些上下文，而不再重复同样的错误。

## Quick Start

```bash
# 首次公开发布后
npm install -g repobrain

brain init
brain inject
```

如果 npm 包还没发布，先使用本地开发安装方式：

```bash
npm install
npm run build
npm link
```

从 session summary 手动提取：

```bash
cat session-summary.txt | brain extract
```

从最近一次 commit message 提取：

```bash
git log -1 --pretty=format:"%B" | brain extract --source git-commit
```

## How It Works

RepoBrain 刻意把闭环做得很小：

1. 你结束一次开发 session，或者完成一次有意义的 commit。
2. RepoBrain 只提取那些跨 session 仍然有价值的仓库知识。
3. 结果写进 `.brain/`，格式是人能直接读、能 review 的 Markdown。
4. 新 session 开始前，用 `brain inject` 生成一段紧凑的上下文。
5. Claude Code 或 Codex 带着这些 repo knowledge 开始工作。

这样做的好处很现实：少重复解释项目背景，少踩已经踩过的坑，也少看到那些完全无视仓库约定的建议。

## Knowledge History

因为 RepoBrain 把 durable knowledge 存在 `.brain/` 里，这些知识天然就可以进入普通的 Git 版本控制流程。也就是说，repo memory 可以像代码一样被查看、被 review、被回滚，而不是躲在另一个黑盒系统里。

一个把 repo knowledge 当成代码来维护的团队，最终可能会留下这样的历史：

```bash
8f3c9b1 brain: add decision - standardize on Node 20 for hooks and CLI
91a42de brain: add convention - keep repo memory in type-based subdirectories
a7d19f4 brain: add gotcha - Express middleware must call next(err) instead of throw
b14ec0a brain: add convention - prefer API version routing under /v1
c2aa61e brain: add decision - keep migration files append-only to avoid schema drift
d5f0b87 brain: update - raise inject budget after adding architecture notes
e6c3a12 brain: add gotcha - mock Redis in integration tests to avoid flaky CI
f9ab44d brain: remove stale - old lint workaround after TypeScript upgrade
```

几个月之后，这类 commit 会自然形成一条可读的知识时间线：新经验被加入，旧假设被修正，过时 guidance 可以被明确移除，而不是悄悄滞留在聊天记录里。RepoBrain 目前不会自动替你生成这些提交，但它的设计方向就是让提取出来的 repo knowledge 可以和代码一起被 review、被提交。

**仓库知识应该留在代码库时间线里，而不是被困在独立的云端记忆孤岛中。**

## Memory Types

当前 MVP 重点沉淀四类记忆：

- `decision`：架构或实现选择，以及为什么这样做
- `gotcha`：已知坑点、限制、以及“不要做 X，因为 Y”
- `convention`：项目特有的命名、目录结构、代码风格、协作约定
- `pattern`：未来 session 里应该复用的实现模式或工作流模式

这也是 RepoBrain 的核心定位。它保存的是高价值 repo knowledge，不是通用聊天历史。

## Installation

### 环境要求

- Node.js 20+
- npm

### npm 安装

等首次公开版本发布后，可以直接全局安装 RepoBrain：

```bash
npm install -g repobrain
```

如果 npm 包还没有发布，请使用下面的本地开发安装方式。

### 本地开发安装

```bash
npm install
npm run build
```

如果你希望把 `brain` 命令挂到全局：

```bash
npm link
```

如果你不想做全局 link，也可以直接运行 CLI：

```bash
node dist/cli.js init
node dist/cli.js inject
```

### Claude Code

RepoBrain 目前已经支持 Claude Code 的 session-start / session-end hook 集成。

相关文件：

- `.claude-plugin/plugin.json`
- `.claude-plugin/mcp.json`
- `dist/hooks/session-start.js`
- `dist/hooks/session-end.js`

### Codex

Codex 集成故意保持轻量，它只是 workflow 放大器，不会改变产品核心定位。

安装 Git hook：

```bash
sh scripts/setup-git-hooks.sh
```

开始一个新的 Codex session 前，先运行：

```bash
brain inject
```

更具体的说明见 [.codex/INSTALL.md](./.codex/INSTALL.md)。

### MCP Setup

RepoBrain 也可以以一个最小 MCP server 的形式运行，供支持 MCP over stdio 的工具接入。

当前暴露的能力很克制：

- `brain_get_context`：返回和 `brain inject` 一致的 markdown context block
- `brain_add_memory`：向 `.brain/` 写入一条新的 durable memory

本地启动方式：

```bash
brain mcp
```

一个 Claude Desktop 风格的配置示例如下：

```json
{
  "mcpServers": {
    "repobrain": {
      "command": "node",
      "args": ["/absolute/path/to/RepoBrain/dist/mcp/server.js"]
    }
  }
}
```

RepoBrain 会刻意把 MCP 模式保持得很小。CLI 和 markdown-first 工作流仍然是当前产品核心。

## 30 分钟快速上手

如果你想尽快体验完整闭环，这一节是最快路径：初始化 RepoBrain，沉淀一条真正有长期价值的 repo knowledge，然后把它注入到下一次 session。第一次完整走下来，大约需要 25 到 30 分钟。

### 开始之前

环境要求：

- Node.js 20+
- npm

先使用本地开发安装方式，这样即使公开 npm 包还没发布，也可以完整体验 RepoBrain：

```bash
npm install
npm run build
npm link
```

如果你不想全局 link，下面所有 `brain` 命令都可以替换成 `node dist/cli.js`。

### Step 1: Initialize

先在当前仓库里初始化 RepoBrain 工作区：

```bash
brain init
```

初始化完成后，`.brain/` 大致会是这样的结构：

```text
.brain/
├── config.yaml
├── errors.log
├── index.md
├── decisions/
├── gotchas/
├── conventions/
└── patterns/
```

生成出来的 `config.yaml` 刻意保持很小：

- `maxInjectTokens`：`brain inject` 生成上下文时使用的近似 token 预算
- `autoExtract`：为后续自动化工作流预留的开关
- `language`：提取提示词偏好的输出语言

### Step 2: Capture Your First Memory

不要用 toy example，直接用一个真实 repo lesson。这里我们用一个很常见的例子：ESLint 的 `no-unused-vars` 和 TypeScript 的 `noUnusedLocals` 同时开启时，容易产生重复告警。

先创建一份 session summary：

```bash
cat > session-summary.txt <<'EOF'
gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
EOF
```

然后从这段总结里提取 durable repo knowledge：

```bash
cat session-summary.txt | brain extract
brain list
```

这时你应该会在 `.brain/gotchas/` 下看到一条新的 memory。实际文件名会带上当天日期和标题 slug。生成后的文件大致会长这样：

```md
---
type: "gotcha"
title: "ESLint no-unused-vars conflicts with TypeScript noUnusedLocals"
summary: "ESLint no-unused-vars conflicts with TypeScript noUnusedLocals"
tags:
  - eslint
  - no-unused-vars
  - typescript
  - nounusedlocals
importance: "medium"
date: "2026-04-01T12:34:56.000Z"
source: "session"
status: "active"
---

## GOTCHA

gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals

When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.
```

这里最值得关注的 frontmatter 字段有：

- `type`：这条 durable knowledge 属于哪一类
- `importance`：它在注入阶段应该占多高优先级
- `tags`：帮助后续快速扫描和 review 的关键词

### Step 3: Inject And Verify

下一次 session 开始前，把刚刚沉淀的 repo knowledge 注入出来：

```bash
brain inject
brain status
```

生成出来的 block 会按类别分组，并在末尾附带几条简短要求。输出大致如下：

```md
# Project Brain: Repo Knowledge Context

## High-priority decisions
_None._

## Known gotchas and limits
- [medium] ESLint no-unused-vars conflicts with TypeScript noUnusedLocals
  ESLint no-unused-vars conflicts with TypeScript noUnusedLocals
  Scope: gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals When TypeScript is already enforcing unused locals...

## Repo conventions
_None._

## Reusable patterns
_None._
```

把这段输出贴到新的 Claude Code 或 Codex session 开头，或者接到你本地的 session-start 工作流里。目标很简单：让下一次 agent 在提出 lint 配置建议之前，先看到这个仓库已经踩过的坑。

### Step 4: Build The Habit

长期习惯其实很轻：

1. 完成一次有意义的修复，或者发现一条值得复用的 repo lesson。
2. 写一段简短总结，运行 `brain extract`。
3. 下一个 session 开始前，运行 `brain inject`。
4. 像 review 代码一样 review `.brain/` 的变更。

多数时候，你只需要这两个命令：

```bash
cat session-summary.txt | brain extract
brain inject
```

如果沉淀下来的知识确实值得跟着代码走，就把 `.brain/` 的变更和代码改动一起 review、一起提交。

Total: ~25 min. What to try next -> [docs/demo-script.zh-CN.md](./docs/demo-script.zh-CN.md)

## 团队协作工作流

团队使用时，推荐主路径是：

1. 修一个真实问题
2. 运行 `brain extract`
3. review `.brain/` 下新增的 markdown
4. 运行 `brain share <memory-id>` 或 `brain share --all-active`
5. 复制它输出的 `git add` 和 `git commit` 建议命令

`brain share` 的第一版刻意保持保守：它不会直接修改 Git 状态，而是把下一步命令明确打印出来，让团队像 review 代码一样 review memory 变更。

完整说明见 [docs/team-workflow.zh-CN.md](./docs/team-workflow.zh-CN.md)。

## CLI Reference

```bash
brain init
brain extract < session-summary.txt
brain inject
brain list
brain stats
brain status
brain share <memory-id>
brain share --all-active
brain mcp
```

### 命令说明

- `brain init`：初始化当前仓库的 `.brain/`
- `brain extract`：从 `stdin` 提取长期有价值的仓库知识
- `brain inject`：为下一次 session 生成注入上下文
- `brain list`：列出当前仓库里的 memory
- `brain stats`：按类型和重要度查看统计
- `brain status`：查看最近一次注入的 memories，以及最近沉淀的 memories
- `brain share`：为单条 memory 或全部 active memories 输出建议的 `git add` / `git commit` 命令
- `brain mcp`：以最小 MCP stdio server 的形式运行 RepoBrain

## Configuration

RepoBrain 的配置文件位于 `.brain/config.yaml`。

当前配置项：

```yaml
maxInjectTokens: 1200
autoExtract: false
language: zh-CN
```

- `maxInjectTokens`：生成注入上下文时使用的近似 token 预算，针对中英混合内容做了更稳的估算
- `autoExtract`：给自动化工作流预留的开关
- `language`：提取提示词偏好的输出语言

## Memory 生命周期

当前 MVP 的生命周期规则刻意保持很小：

- 新 memory 默认状态是 `active`
- 如果新保存的 memory 与现有 active memory 命中“同类型 + 标题归一化后相同”，旧 memory 会自动标记为 `superseded`
- `brain inject` 生成上下文时会自动排除 `superseded` memories

这就是当前版本面向 solo 开发者和长期维护个人项目的最小失效机制，先解决“新结论覆盖旧结论”的主路径，复杂 review 流程后续再补。

## 外部 Extractor 契约

如果设置了 `BRAIN_EXTRACTOR_COMMAND`，RepoBrain 会优先调用这个命令，而不是使用内置的启发式提取。

接口约定：

- RepoBrain 会把完整提取 prompt 通过 `stdin` 传给命令
- 命令必须通过 `stdout` 输出严格 JSON，格式为 `{ "memories": [...] }`
- 每条 memory 都必须使用受支持的 `type`、`importance`，以及预期的字符串字段
- 非 0 退出码会被视为 extractor 执行失败

错误处理：

- 如果命令执行失败，RepoBrain 会把错误写入 `.brain/errors.log`，然后回退到启发式提取
- 如果命令输出的 JSON 非法，或 memory 条目字段不合法，RepoBrain 也会记录错误并回退到启发式提取
- 如果没有值得保存的内容，命令应返回 `{ "memories": [] }`

## Roadmap

- 更顺手的 Claude Code 安装和说明
- 更稳定的 Codex 轻量工作流
- 更清晰的 memory review / promote 流程
- 更完整的开源演示和真实案例

## Contributing

欢迎提 Issue 和 PR。

当前最有帮助的贡献方向是：

- 来自真实 coding session 的测试样本
- 对提取质量的反馈
- RepoBrain 目前还没覆盖到的 repo context 场景
- 能让新用户 5 分钟内上手的文档改进

如果你准备提 PR，最重要的一条是别把项目带偏：

> RepoBrain 的核心是给 coding agent 沉淀 durable repo knowledge，而不是做一个通用长期聊天记忆系统。
