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
npm install
npm run build
npm link

brain init
brain inject
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

### 本地安装

```bash
npm install
npm run build
```

如果你希望把 `brain` 命令挂到全局：

```bash
npm link
```

### Claude Code

RepoBrain 目前已经支持 Claude Code 的 session-start / session-end hook 集成。

相关文件：

- `.claude-plugin/plugin.json`
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

## CLI Reference

```bash
brain init
brain extract < session-summary.txt
brain inject
brain list
brain stats
brain status
```

### 命令说明

- `brain init`：初始化当前仓库的 `.brain/`
- `brain extract`：从 `stdin` 提取长期有价值的仓库知识
- `brain inject`：为下一次 session 生成注入上下文
- `brain list`：列出当前仓库里的 memory
- `brain stats`：按类型和重要度查看统计
- `brain status`：查看最近一次注入的 memories，以及最近沉淀的 memories

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
