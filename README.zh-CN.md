[English](./README.md) | [简体中文](./README.zh-CN.md)

# RepoBrain

> 面向 coding agent 的 Git-friendly repo memory。

RepoBrain 的目标很直接：帮 Claude Code、Codex 这类 coding agent 记住这个仓库真正重要的上下文，比如架构决策、已知坑点、项目约定，以及可复用的实现模式，而不是把所有聊天记录都攒下来。

它不是一个通用聊天记忆平台。它不追求“永久保存所有对话”。它解决的是更实际的问题：每次新 session 开始时，AI agent 总会忘记这个仓库最关键的 decision、gotcha 和 convention。

## Hero

- 记住仓库知识，不是记住整段聊天
- 以 Markdown + frontmatter 的形式存进 `.brain/`
- local-first、markdown-first、git-friendly
- 通过轻量 adapter 对接 Claude Code、Codex、Cursor 和 Copilot

## 这不是什麽

- 这不是 generic chat memory，不会把所有对话永久存档
- 这不是 model middleware，不会夹在模型前面代理 prompt
- 它要解决的是更直接的问题：让 coding agent 在下一个 session 开始时记得这个 repo 真正在意的知识

## 它已经能解决什么

- 每次新 session 都要重新解释 repo 约定和坑点
- agent 反复从代码和失败日志里重新发现同一类 gotcha
- durable repo knowledge 没地方 review，只能散落在聊天记录里
- 明确任务出现后，缺少一个本地、确定性的 `suggest-skills` / `invocation_plan`

## Proof Layer

- 可执行 demo： [docs/demo-proof.zh-CN.md](./docs/demo-proof.zh-CN.md)
- 真实 demo transcript： [docs/demo-assets/typescript-cli-proof/transcript.md](./docs/demo-assets/typescript-cli-proof/transcript.md)
- 评测案例： [docs/evaluation.zh-CN.md](./docs/evaluation.zh-CN.md)
- TypeScript CLI case study： [docs/case-studies/typescript-cli.zh-CN.md](./docs/case-studies/typescript-cli.zh-CN.md)
- 全栈 Web case study： [docs/case-studies/full-stack-web.zh-CN.md](./docs/case-studies/full-stack-web.zh-CN.md)
- 发布闭环： [docs/release-checklist.zh-CN.md](./docs/release-checklist.zh-CN.md) 和 [docs/release-guide.zh-CN.md](./docs/release-guide.zh-CN.md)

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

brain setup
brain inject
```

如果 npm 包还没发布，先使用本地开发安装方式：

```bash
npm install
npm run build
npm link
```

准备公开发布前，建议先运行 `npm run smoke:package`，再按 [docs/release-checklist.zh-CN.md](./docs/release-checklist.zh-CN.md) 逐项检查。

如果要生成 README、演示或 release 资料里会用到的 proof bundle，再运行：

```bash
npm run demo:proof
npm run eval:proof
```

从 session summary 手动提取：

```bash
cat session-summary.txt | brain extract
```

从最近一次 commit 上下文提取：

```bash
brain extract-commit
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

## Integrations

RepoBrain 把产品拆成稳定的核心层和轻量的 adapter 层。所有 adapter 都消费同一套 `.brain` schema，以及同一个 `brain inject` 和 `brain suggest-skills` 输出。

RepoBrain Core 刻意保持本地、轻量、deterministic。它不内置任何 LLM API 调用，也不是模型中间层。

核心层职责：

- 定义并维护 `.brain/` 的 Markdown + frontmatter schema
- 在一个 Git-friendly 的位置里保存 durable repo memory
- 在本地执行 deterministic 的 rule-based review / dedupe / supersede
- 提供基础查询与注入能力：`brain inject`、`brain review`、`brain suggest-skills`
- 通过 `brain inject` 生成紧凑的 session 上下文
- 通过 `brain suggest-skills` 生成任务感知的路由提示

adapter 层职责：

- 把 RepoBrain 的统一输出翻译成目标 agent 偏好的指令格式
- 说明 `brain inject` 和 `brain suggest-skills` 在该 agent 工作流中的接入位置
- 在需要时帮助提炼 durable knowledge 候选
- 可以提供结构化的 review suggestion，但不能替代 Core 的本地最终判定
- 保持足够轻量，避免在 RepoBrain 核心层之外再发明一套知识模型

### Why thin adapters, but stronger contracts

adapter 保持轻量，是为了让 RepoBrain 可以稳定复用到 Claude Code、Codex、Cursor、Copilot 这类不同 agent 表面，而不会把 repo memory、schema 演进和最终 review 决策分散到各家集成里。

contract 变强，是为了让这些轻 adapter 仍然有统一边界。RepoBrain 现在把 adapter 生命周期固定成四段：

- session start：消费 `brain inject`
- task known：消费 `brain suggest-skills --format json` 里的 `invocation_plan`
- session end：产出 extract candidate
- failure path：产出 reinforce event

这样 adapter 仍然只是格式翻译层，而不是重型 integration SDK。

共享 adapter 文档与示例位于 [integrations/README.md](./integrations/README.md)。

### Claude Code

Claude 继续沿用现有的 hook 和 plugin 接口；新的 adapter contract 会明确：

- session start 怎么消费 inject
- task 已知后怎么消费 `invocation_plan`
- session end 怎么产出 extract candidate
- failure 时怎么回退到 `brain reinforce`

当前相关文件：

- `.claude-plugin/plugin.json`
- `.claude-plugin/mcp.json`
- `dist/hooks/session-start.js`
- `dist/hooks/session-end.js`
- `integrations/claude/SKILL.md`

### Codex

Codex 集成故意保持轻量，它只是 workflow 放大器，不会改变产品核心定位。

安装 Git hook：

```bash
sh scripts/setup-git-hooks.sh
```

开始一个新的 Codex session 前，可以先运行：

```bash
brain inject
brain suggest-skills --format json --task "current task" --path src/example.ts
```

模板和安装说明：

- `integrations/codex/SKILL.md`
- [.codex/INSTALL.md](./.codex/INSTALL.md)

### Cursor

Cursor 继续保持 rules-first，不做深度集成。可以把 `integrations/cursor/repobrain.mdc` 复制到 `.cursor/rules/repobrain.mdc`，再按共享 contract 消费 inject、`invocation_plan`、extract candidate 和 reinforce event。

### GitHub Copilot

Copilot 继续提供 custom instructions 模板。可以把 `integrations/copilot/copilot-instructions.md` 复制到 `.github/copilot-instructions.md`，并继续把 RepoBrain 作为共享 memory core，而不是单独维护 Copilot 专属的 repo notes。

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
brain setup
```

`brain setup` 是当前更推荐的入口。它会像 `brain init` 一样初始化 `.brain/`，并且当你在 Git 根目录执行时，还会顺手安装一个轻量的 `post-commit` hook，用于从更丰富的 commit 上下文做自动提取。

如果你只想初始化工作区、不想安装 Git hook 自动化，`brain init` 仍然是最轻量的入口。现在它在 `.brain/` 初始化完成后，还会顺手询问是否生成 Claude Code / Codex 的 steering rules：

```text
已初始化 .brain/ 目录。
? 你使用哪个 AI 编码工具？（用于生成 steering rules）
1. Claude Code（生成 .claude/rules/brain-session.md）
2. Codex（补充 .codex/brain-session.md）
3. 两者都用
4. 跳过
```

这些文件都是纯 Markdown 工作流说明，用来提醒 agent 在新会话开始时先运行 `brain inject`，以及在结束后及时提取 durable memory。

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
- `extractMode`：控制 hooks 走手动、候选写入，还是直接写入 active memory
- `language`：提取提示词偏好的输出语言

### Step 2: Capture Your First Memory

不要用 toy example，直接用一个真实 repo lesson。这里我们用一个很常见的例子：ESLint 的 `no-unused-vars` 和 TypeScript 的 `noUnusedLocals` 同时开启时，容易产生重复告警。

过薄的一句话提示会被 deterministic reviewer 有意拒绝；第一次体验时请尽量提供一段具体、带 repo 上下文的总结。

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

`brain extract` 现在会先跑一轮 deterministic review，再决定怎么落盘。CLI 会为每条提取结果输出 `decision`、`target_memory_ids` 和 `reason`。`accept` 会保持当前写入行为，`merge` / `supersede` 会先保守地落成 `candidate`，`reject` 则不会写入。

当前 baseline reviewer 仍然是 deterministic 且可解释的，但不再依赖单层阈值堆叠，而是改成分层管线：

- 先过滤不可比较对象：`type`、活动状态、scope 可比性
- 再构建结构化 evidence vector：identity、scope、title/summary/detail overlap、replacement wording、recency、status/lineage
- 再判定内部关系：`duplicate`、`additive_update`、`full_replacement`、`possible_split`、`ambiguous_overlap`
- 最后再映射回 Core 的公开决定：`accept` / `merge` / `supersede` / `reject`

现在的 `same_scope` 表示 scope 归一化后完全一致；`overlapping_scope` 表示归一化后是父子级重叠但不完全相同；`same_identity` 也不再只是标题 slug 是否相等，而是由分层 evidence 累积得到。这样措辞变化仍然可以 merge，而不同 scope 下的同标题 memory 会更容易保持分离。程序化集成依然可以附带 external review input，但 Core 仍会先校验输入结构，再保留本地最终决策权。

### 内置本地抽取器

当没有设置 `BRAIN_EXTRACTOR_COMMAND` 时，RepoBrain 会使用一个完全本地可运行的 staged extractor：

- `预处理 -> 片段切分 -> 候选识别 -> 类型判定 -> 字段补全 -> 质量打分 -> 去重初筛 -> deterministic review`
- 支持的输入形态：普通 session summary、bullet 风格修复记录、中英混合笔记、长段复盘，以及 `brain extract-commit` 生成的 commit context
- 使用的信号：显式 `decision:` 前缀、关键词、因果词、限制词、风险词、bullet 结构、changed files 和仓库路径
- metadata 推断：会结合文本和路径上下文补全 `tags`、`importance`、`area`、`files`、`path_scope`
- 拒绝策略：低信息量备注、debug 噪音、只修 typo 的记录、一次性的 action log 会在写入前 review 之前被过滤掉

这个本地抽取器现在比旧的“只看前缀”的 heuristic 更能从混乱总结里救出有价值的 memory，但它仍然是保守策略，不是通用语义推理器。如果总结里缺少“为什么”、把多条无关结论揉在一起，或者描述过于含糊，补一两句简短因果说明仍然会明显提升提取质量。

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

- `created`：日期格式的创建时间（`YYYY-MM-DD`），默认取 `created_at` 的日期部分
- `updated`：日期格式的最后更新时间（`YYYY-MM-DD`），默认等于 `created`
- `area`：可选功能域，比如 `auth`、`api`、`db`、`infra`、`ui`、`testing`、`general`
- `files`：可选的相关文件 glob，例如 `src/auth/**`
- `expires`：可选过期日期，主要给短期 `working` memory 使用
- `status`：goal 的状态，比如 `active`、`done`、`stale`；需要时也继续兼容现有的 `candidate`、`superseded`

- `type`：这条 durable knowledge 属于哪一类
- `importance`：它在注入阶段应该占多高优先级
- `tags`：帮助后续快速扫描和 review 的关键词
- `score`：记忆质量分，范围 `0` 到 `100`，默认 `60`
- `hit_count`：这条 memory 被注入使用的次数，默认 `0`
- `last_used`：最后一次被注入的 ISO 时间戳，默认 `null`
- `created_at`：这条 memory 首次创建时的 ISO 时间戳，默认沿用 `date`
- `stale`：这条 memory 的元数据是否已标记为过期，默认 `false`
- `supersedes`：可选，表示这条 memory 取代了哪条旧 memory，值为相对于 `.brain/` 的文件路径，默认 `null`
- `superseded_by`：可选，表示这条 memory 被哪条新 memory 取代，值为相对于 `.brain/` 的文件路径，默认 `null`
- `version`：同一决策血缘中的版本号，默认 `1`
- `related`：可选，相关但不互相取代的 memory 文件路径列表，路径相对于 `.brain/`，默认 `[]`
- `origin`：可选来源标记，用于 failure reinforcement 这类特殊写入路径

### Skill Routing 字段

如果你希望某条 memory 同时给后续 agent / skill routing 提供线索，可以在 frontmatter 里补这些可选字段：

- `path_scope`：这条 memory 最相关的仓库路径或文件模式
- `recommended_skills`：通常适合优先考虑的 skill
- `required_skills`：这条 memory 生效时必须纳入考虑的 skill
- `suppressed_skills`：这条 memory 生效时应避免调用的 skill
- `skill_trigger_paths`：命中后说明这条 memory 相关的路径或文件模式
- `skill_trigger_tasks`：命中后说明这条 memory 相关的任务描述
- `invocation_mode`：只能是 `required`、`prefer`、`optional` 或 `suppress`
- `risk_level`：只能是 `high`、`medium` 或 `low`

如果这些字段缺省，RepoBrain 会保持旧条目兼容：所有列表字段默认是 `[]`，`invocation_mode` 默认是 `optional`，`risk_level` 默认是 `low`，`score` 默认是 `60`，`hit_count` 默认是 `0`，`last_used` 默认是 `null`，`created_at` 默认沿用 memory 的 `date`，`stale` 默认是 `false`，`supersedes` 默认是 `null`，`superseded_by` 默认是 `null`，`version` 默认是 `1`，`related` 默认是 `[]`，`origin` 默认不设置。

新增字段里，`created` 默认取 `created_at` 的日期部分，`updated` 默认等于 `created`，`files` 默认是 `[]`，`goal` 的 `status` 默认是 `active`。

最小示例：

```md
---
type: "decision"
title: "将浏览器测试任务路由到 Playwright 经验"
summary: "调试浏览器测试时优先参考 Playwright 相关经验。"
tags:
  - "playwright"
importance: "medium"
date: "2026-04-01T12:34:56.000Z"
path_scope:
  - "tests/e2e/"
recommended_skills:
  - "github:gh-fix-ci"
required_skills:
  - "playwright"
suppressed_skills:
skill_trigger_paths:
  - "tests/e2e/"
  - "playwright.config.ts"
skill_trigger_tasks:
  - "debug flaky browser tests"
invocation_mode: "prefer"
risk_level: "medium"
---

## DECISION

当任务涉及浏览器测试基础设施时，优先采用 Playwright 方向的经验和排查方式。
```

### 生成 Skill Shortlist

当一部分 memories 已经带上 skill routing 元数据后，可以直接让 RepoBrain 按当前任务和变更路径给出 shortlist：

```bash
brain suggest-skills --task "debug flaky browser tests in CI" --path tests/e2e/login.spec.ts --path playwright.config.ts
```

这个命令只会读取 `active` 状态的 memories。它会用 `skill_trigger_tasks` 匹配任务描述，用 `skill_trigger_paths` 匹配你传入的路径，然后生成一份可追溯、deterministic 的路由结果：

- `matched_memories`：哪些 memories 命中了，以及为什么命中
- `resolved_skills`：把本地规则应用到每个 skill 之后的结果
- `conflicts`：冲突记录，包含 required-vs-suppressed 这类冲突的本地策略结果
- `invocation_plan`：稳定的 adapter-facing plan，至少包含 `required`、`prefer_first`、`optional_fallback`、`suppress`，并在需要时额外给出 `blocked`、`human_review`

默认仍然输出给人看的 markdown：

```bash
brain suggest-skills --task "debug flaky browser tests in CI" --path tests/e2e/login.spec.ts
```

如果上层 agent adapter 需要直接消费 plan，可以切到 JSON：

```bash
brain suggest-skills --format json --task "debug flaky browser tests in CI" --path tests/e2e/login.spec.ts
# 或
brain suggest-skills --json --task "debug flaky browser tests in CI" --path tests/e2e/login.spec.ts
```

JSON 结构示例：

```json
{
  "contract_version": "repobrain.skill-plan.v1",
  "kind": "repobrain.skill_invocation_plan",
  "task": "debug flaky browser tests in CI",
  "paths": ["tests/e2e/login.spec.ts"],
  "matched_memories": [],
  "resolved_skills": [],
  "conflicts": [],
  "invocation_plan": {
    "required": [],
    "prefer_first": [],
    "optional_fallback": [],
    "suppress": [],
    "blocked": [],
    "human_review": []
  }
}
```

如果任务描述已经在文件里，或者来自另一个命令，也可以直接从 `stdin` 管道输入：

```bash
cat task.txt | brain suggest-skills --path src/cli.ts --path test/store.test.mjs
```

### 什么时候用 `inject`，什么时候用 `suggest-skills`，什么时候消费 `invocation_plan`

如果你需要在开始编码前先把 repo 的 durable context 压缩带进 session，用 `brain inject`。如果你已经知道当前任务，只是想让 RepoBrain 帮你缩小 skill / workflow 选择范围，用 `brain suggest-skills`。如果你在写 Claude Code / Codex 之类的上层 adapter，并且已经有任务上下文，只需要一个稳定 contract 来路由 skill，就直接消费 `invocation_plan`。

- `brain inject`：更适合 session 开始前、方案实现前、风险较高的改动前，用来先看 repo 级上下文和历史约束
- `brain suggest-skills`：更适合任务已经明确之后，把 task/path 信号解析成一份本地 deterministic 的 skill 路由结果
- `invocation_plan`：更适合薄 adapter 直接消费 RepoBrain 的路由结论，而不是再二次理解 prose

边界保持不变：

- `brain inject` 负责给上下文
- `brain suggest-skills` 负责把 metadata 解析成 plan
- 上层 adapter 决定是否、何时、以及如何真正调用 skill

`brain inject` 现在会按综合注入优先级对 `active` memories 排序，跳过 frontmatter 中 `stale: true` 或 `superseded_by` 非空的条目；当 `version >= 2` 时，会在标题前加上 `[更新 vN]` 前缀；如果 `supersedes` 指向的旧文件没有正确回填 `superseded_by`，inject 还会在终端输出警告。成功注入后，RepoBrain 仍会以原子方式回写更高的 `hit_count` 和最新的 `last_used` 日期。默认情况下，它还会读取当前 Git 分支名和 `git diff --name-only HEAD`，对 `files`、`area`、`tags` 能命中当前改动上下文的 memories 额外加分；如果当前不在 Git 仓库中，或者旧 memories 没有填写 `files` 和 `area`，则会自动退回旧的排序逻辑。如果你传入任务信号，RepoBrain 仍会给出简短的命中原因，主要包括：

- `skill_trigger_tasks` 的任务短语命中
- `path_scope` 和 `skill_trigger_paths` 的路径命中
- `--module` / 任务文本与标题、summary、tags、scope 路径之间的关键词重叠
- `importance`、`risk_level`、`invocation_mode` 的小幅加权，用来做同分时的偏置

### Step 3: Inject And Verify

下一次 session 开始前，把刚刚沉淀的 repo knowledge 注入出来：

```bash
brain inject
brain status
```

如果你已经知道当前任务，仍然可以把任务信息传给 `inject`，让输出里带上更明确的命中原因：

```bash
brain inject --task "refactor config loading for the CLI" --path src/config.ts --path src/cli.ts --module cli
```

如果任务风险更高，建议把关键路径和模块一起传进去，让 RepoBrain 更早暴露高风险 gotcha / decision：

```bash
brain inject --task "fix refund transaction bug before release" --path src/payments/refund.ts --module payments --module ledger
```

常用 flag：

- `--no-context`：关闭 Git 上下文打分，强制使用旧排序逻辑
- `--include-working`：把 `active` 状态的 `working` memory 也纳入注入
- `--explain`：在输出末尾追加 HTML 注释，打印每条注入 memory 的 Git 上下文得分

`active` 状态的 `goal` memory 会始终优先注入，不受普通 token 截断影响。

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

血缘示例：

```md
---
type: "decision"
title: "Use the old deploy gate"
summary: "Legacy guidance kept only for history."
importance: "medium"
date: "2026-04-01T08:00:00.000Z"
superseded_by: "decisions/2026-04-01-use-the-new-deploy-gate-090000000.md"
version: 1
---

---
type: "decision"
title: "Use the new deploy gate"
summary: "Current guidance."
importance: "high"
date: "2026-04-01T09:00:00.000Z"
supersedes: "decisions/2026-04-01-use-the-old-deploy-gate-080000000.md"
version: 2
---
```

在这组关系下，`brain inject` 只会输出新的那条 memory，并把标题渲染成 `[更新 v2] Use the new deploy gate`。

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

总耗时：约 25 分钟。下一步可以直接按 [docs/demo-script.zh-CN.md](./docs/demo-script.zh-CN.md) 录一遍完整演示。

## 团队协作工作流

团队使用时，推荐主路径是：

1. 修一个真实问题
2. 运行 `brain extract`
3. review `.brain/` 下新增的 markdown
4. 运行 `brain share <memory-id>` 或 `brain share --all-active`
5. 复制它输出的 `git add` 和 `git commit` 建议命令

`brain share` 的第一版刻意保持保守：它不会直接修改 Git 状态，而是把下一步命令明确打印出来，让团队像 review 代码一样 review memory 变更。

完整说明见 [docs/team-workflow.zh-CN.md](./docs/team-workflow.zh-CN.md)。

如果是在做发布准备或打包检查，再配合 [docs/release-checklist.zh-CN.md](./docs/release-checklist.zh-CN.md) 一起走。

## CLI Reference

```bash
brain init
brain setup
brain extract < session-summary.txt
brain extract --type working < session-summary.txt
brain extract-commit
brain inject
brain list
brain list --type goal
brain list --goals
brain stats
brain goal done <keyword>
brain status
brain review
brain approve --safe
brain approve <memory-id>
brain dismiss <memory-id>
brain supersede <new-memory-file> <old-memory-file>
brain lineage
brain lineage <file>
brain audit-memory
brain reinforce < session-summary.txt
brain suggest-skills --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain suggest-skills --format json --task "debug flaky browser tests" --path tests/e2e/login.spec.ts
brain share <memory-id>
brain share --all-active
brain mcp
```

### 命令说明

- `brain extract --type working`：强制把本次提取结果保存成 `working` memory；如果没有显式给 `expires`，会自动写成“今天 + 7 天”
- `brain extract --type goal`：强制把本次提取结果保存成 `goal` memory，并默认写入 `status: active`
- `brain list --type goal`：按类型过滤 memory，`working` / `goal` 等新类型都支持
- `brain list --goals`：列出所有 goal memory，并按 `status` 分组
- `brain goal done <keyword>`：按标题关键字查找 goal memory，标记成 `done` 并刷新 `updated`

- `brain init`：初始化当前仓库的 `.brain/`
  初始化后可按提示额外生成 `.claude/rules/brain-session.md` 和/或 `.codex/brain-session.md` steering rules。
- `brain setup`：初始化 `.brain/`，并在 Git 根目录执行时安装低风险的 `post-commit` Git hook
- `brain extract`：从 `stdin` 提取长期有价值的仓库知识
  并在写入前输出每条 memory 的 review decision
- `brain extract-commit`：从更丰富的 git commit 上下文提取知识，输入会包含 commit metadata、变更文件和 diff stat
- `brain inject`：为下一次 session 生成注入上下文，也可以配合 `--task`、`--path`、`--module` 做任务感知排序
  当仍有待审核的 candidate memories 时，注入结果底部会提醒你运行 `brain review`。
- `brain sweep`：扫描陈旧 memory；默认交互式逐条确认，`--dry-run` 只看报告，`--auto` 自动执行安全清理规则
- `brain list`：列出当前仓库里的 memory
- `brain stats`：按类型和重要度查看统计
- `brain status`：查看最近一次注入的 memories，以及最近沉淀的 memories
  同时会显示 Claude Code / Codex 的 steering rules 是否已配置；如果两者都不存在，会给出补充配置提示。
- `brain review`：列出等待审批的 candidate memories
- `brain approve`：将单条 candidate memory、全部 candidates，或仅 `--safe` 的低风险 candidates 提升为 active
- `brain dismiss`：将单条 candidate memory，或全部 candidates，标记为 stale
- `brain supersede`：手动把新 memory 和旧 memory 建立取代关系，更新 `supersedes` / `superseded_by`，把新 memory 的 `version` 设为 `旧 version + 1`，并把旧 memory 标记为 stale
- `brain lineage`：以 ASCII 树形式打印所有有血缘关系的 memory，或只打印包含指定 memory 文件的那条血缘链
- `brain score`：按严重度排序检查低质量或过旧的 memories，并支持交互式或批量标记 stale、删除、跳过或导出 JSON
- `brain audit-memory`：审计 `.brain/` 中疑似 stale、conflict、low-signal 或 overscoped 的条目
- `brain reinforce`：从 `stdin` 手动执行失败分析和记忆强化；自动化或 CI 场景可加 `--yes` 跳过确认
- `brain suggest-skills`：根据任务文本、变更路径和命中的 active memories 输出一份 deterministic skill routing plan
- `brain share`：为单条 memory 或全部 active memories 输出建议的 `git add` / `git commit` 命令
- `brain mcp`：以最小 MCP stdio server 的形式运行 RepoBrain

## Configuration

RepoBrain 的配置文件位于 `.brain/config.yaml`。

当前配置项：

```yaml
maxInjectTokens: 1200
extractMode: suggest
language: zh-CN
staleDays: 90
sweepOnInject: false
```

- `maxInjectTokens`：生成注入上下文时使用的近似 token 预算，针对中英混合内容做了更稳的估算
- `extractMode`：控制 hook 提取走手动、候选写入，还是直接写入 active memory
- `language`：提取提示词偏好的输出语言
- `staleDays`：非 goal memory 距离 `updated` 超过多少天后，`brain sweep` 会把它判定为陈旧并尝试降权
- `sweepOnInject`：为 `true` 时，每次 `brain inject` 前都会先执行一次 `brain sweep --auto`；清理日志写到 `stderr`，不会污染 inject 的 markdown 输出
- 旧的 `provider`、`model`、`apiKey` 一类 review 配置会被忽略，并给出弃用提示；RepoBrain Core 不会调用远程审核服务

## Memory 生命周期

当前 MVP 的生命周期规则刻意保持很小：

- 新提取出的 memory 会先经过一轮 deterministic review：`accept`、`merge`、`supersede` 或 `reject`
- 手动执行 `brain extract` 时，`accept` 结果仍会直接写成 `active`
- hook 在 `suggest` 模式下，会把可接受的结果写成 `candidate`
- 重复或高度重合的 durable knowledge 会走 `merge`，而不是交给远程 reviewer
- `merge` 和 `supersede` 目前都保持保守：RepoBrain 只会把新 memory 存成 `candidate`，并输出目标 memory ids，不会自动改写旧文件
- reviewer 的内部关系现在比公开 decision 更细：`duplicate`、`additive_update`、`full_replacement`、`possible_split`、`ambiguous_overlap`
- `merge` 用于 `duplicate` 和 `additive_update`
- `supersede` 用于 `full_replacement`
- `reject` 除了低质量/临时信息之外，也会覆盖 `possible_split` 和 `ambiguous_overlap`，避免 Core 在 partial update 或多目标冲突上做猜测
- `reject` 会带着明确原因被跳过，比如 `temporary_detail`、`insufficient_signal`
- `brain approve` 会把 candidate 提升为 `active`
- `brain dismiss` 会把 candidate 标记为 `stale`
- 如果新激活的 memory 与现有 active memory 命中“同类型 + 标题归一化后相同 + scope 归一化后相同”，旧 memory 会自动标记为 `superseded`
- `brain inject` 生成上下文时只会加载 `active` memories，然后进一步过滤 `stale: true` 或 `superseded_by` 非空的条目，所以被新版本取代的血缘节点不会再参与正常匹配或注入基线
- 如果某条 memory 设置了 `supersedes`，inject 会额外检查旧文件是否正确设置了 `superseded_by`；若未设置，会把修复提示输出到 stderr，但不会破坏现有兼容行为
- external review input 是可选附加信息；Core 会校验结构、忽略非法输入，并保留本地最终判定
- session-end hook 现在还可以做 failure reinforcement：识别违反旧记忆或重复错误，提升或重写对应记忆，也可以额外保存一条带 `origin: failure` 的新 `gotcha`

这样既保留了当前清晰的写入主路径，也允许更高层 agent 工作流围绕同一套 deterministic baseline 附加结构化建议。

如果你是通过代码集成 RepoBrain，`store-api` 现在也会导出 `buildMemoryReviewContext`、`parseExternalReviewInput`、`decideCandidateMemoryReview`、`explainCandidateMemoryReview` 和 `renderCandidateMemoryReviewExplanation`，这样 adapter 可以读取 evidence / explain 输出，同时保持最终审核权仍在 Core。

### Reviewer 复杂案例

- 旧逻辑里，“标题相同但 scope 只是部分重叠”的情况经常只能落回 `accept`。新逻辑会把它显式打成 `possible_split` 或 `ambiguous_overlap`，并带着 evidence 拒绝自动关系决策。
- 旧逻辑里，`transaction helper` 这类措辞变化一旦摘要相似度掉出阈值，就容易错过 merge。新逻辑把 identity evidence 和 overlap evidence 分开累计，所以同 scope 的措辞变化更容易稳定落到 `additive_update -> merge`。
- 旧逻辑里，replace 类文本很依赖标题/摘要阈值。新逻辑会把 replacement wording、recency、status/lineage 一起计入，因此更容易稳定识别 `full_replacement -> supersede`。
- 旧逻辑里，两个旧 memory 同时和新 memory 有中等重叠时，系统往往只能把它当成新 memory。新逻辑会直接返回 `ambiguous_existing_overlap`，明确告诉开发者 Core 为什么拒绝自动 merge。

## Memory Audit

当 `.brain/` 里的知识逐渐变多、你想在分享、发布前检查或定期清理时，可以运行 `brain audit-memory` 做一次知识卫生审计。

比较适合的场景：

- 连续做过几轮 `extract` 和 `approve` 之后
- 准备提交或分享一批 `.brain/` 变更之前
- 觉得旧 guidance 可能已经冲突、过时或范围过宽时

这个命令是只读的，不会改写或删除 memory 文件。第一版规则审计会检查四类问题：

- `stale`：太旧、太久没处理的 candidate，或可能需要回看的低价值 active memory
- `conflict`：同 scope 下看起来指向相反方向的 `decision` / `convention`
- `low_signal`：过薄、过泛，难以给未来任务提供稳定帮助的条目
- `overscoped`：scope 或表述过宽，容易在注入时制造噪音的条目

示例：

```bash
brain audit-memory
brain audit-memory --json
```

默认的人类可读输出会包含 `memory_id`、问题类型、原因和建议动作；加上 `--json` 后会输出同一份结构化结果，便于后续 hooks 或其他 adapter 消费。

## 外部 Extractor 契约

如果设置了 `BRAIN_EXTRACTOR_COMMAND`，RepoBrain 会优先调用这个命令，而不是使用内置的本地 staged extractor。

这就是给外部 agent、adapter 或 skill 留的扩展点，用来提供更强的语义候选提炼；RepoBrain Core 仍然只消费本地进程输出，不内置自己的模型 API 客户端。默认路径依旧是完全本地的，不要求联网调用 LLM。

同一份契约也会被导出的 `detectFailures(sessionLog, existingMemories)` 复用（实现位于 `src/failure-detector.ts`）。这个辅助函数会发送一次小 prompt，内容包含记忆索引（`title | type | file`）和 session 日志全文，并期待命令从 `stdout` 返回严格 JSON 的事件数组。失败检测是 best-effort 的：命令执行失败或返回非法 JSON 时，会静默返回 `[]`，不会中断 session。

接口约定：

- RepoBrain 会把完整提取 prompt 通过 `stdin` 传给命令
- 命令必须通过 `stdout` 输出严格 JSON，格式为 `{ "memories": [...] }`
- 每条 memory 都必须使用受支持的 `type`、`importance`，以及预期的字符串字段
- 非 0 退出码会被视为 extractor 执行失败

Failure detector 契约：

- RepoBrain 会通过 `stdin` 发送一次 prompt，内容包含记忆标题索引（`title | type | file`）和 session 日志
- 命令必须通过 `stdout` 输出严格 JSON，格式为 `[{ "kind": "...", ... }]`
- 支持的事件类型是 `violated_memory` 和 `new_failure`
- 支持的动作是 `boost_score`、`rewrite_memory` 和 `extract_new`
- 如果没有明确的失败事件，命令应返回 `[]`

错误处理：

- 如果命令执行失败，RepoBrain 会把错误写入 `.brain/errors.log`，然后回退到启发式提取
- 如果命令输出的 JSON 非法，或 memory 条目字段不合法，RepoBrain 也会记录错误并回退到启发式提取
- 如果没有值得保存的内容，命令应返回 `{ "memories": [] }`

外部 extractor 也应该遵守和内置抽取器一致的质量门槛：

- 保持当前 memory schema 不变
- 优先提取可复用的 decision、gotcha、convention、pattern、working、goal，而不是原始变更流水账
- 能补就补稳定 metadata，尤其是 `files`、`area`、`importance` 和简洁 summary
- 短期 debug 噪音尽量直接拒绝，不要把清洗压力留给后续 Core review

## Roadmap

- 更顺手的 Claude Code 安装和说明
- 更稳定的 Codex 轻量工作流
- 更清晰的 deterministic memory review / promote 流程
- 更完整的 adapter 示例，用于 candidate extraction 和 review suggestion
- 更完整的开源演示和真实案例

## Contributing

欢迎提 Issue 和 PR。

当前最有帮助的贡献方向是：

- 来自真实 coding session 的测试样本
- 对提取质量的反馈
- RepoBrain 目前还没覆盖到的 repo context 场景
- 能让新用户 5 分钟内上手的文档改进
- 来自 Windows、macOS、Linux shell 的发布验证反馈

如果你准备提 PR，最重要的一条是别把项目带偏：

> RepoBrain 的核心是给 coding agent 沉淀 durable repo knowledge，而不是做一个通用长期聊天记忆系统。

它不是另一个 AI 应用，也不是模型 API 中间层；它是 agent-agnostic 的 repo knowledge infrastructure。
