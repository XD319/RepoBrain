import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SteeringRulesChoice = "claude" | "codex" | "cursor" | "all" | "both" | "skip";

const CLAUDE_RULES_PATH = path.join(".claude", "rules", "brain-session.md");
const CODEX_RULES_PATH = path.join(".codex", "brain-session.md");
const CURSOR_RULES_PATH = path.join(".cursor", "rules", "brain-session.mdc");

const CLAUDE_RULES_CONTENT = `# RepoBrain 会话规则

## 会话开始时（必须）

每次新会话开始时，在回复用户之前先执行：

\`\`\`bash
brain inject
\`\`\`

将输出内容作为本仓库的背景上下文。如果 \`.brain/\` 不存在，跳过并提示用户运行 \`brain init\`。

## 会话过程中

当用户做出以下操作时，主动提议提取记忆：
- 修复了一个之前反复出现的 bug → 提议提取 \`gotcha\`
- 解释了某个架构决策的原因 → 提议提取 \`decision\`
- 描述了一个"绝对不能这样做"的约束 → 提议提取 \`gotcha\`
- 明确了仓库命名或结构规范 → 提议提取 \`convention\`
- 开始一个跨越多轮对话的功能开发 → 提议提取 \`goal\`

提议示例：
> 「这个 JWT refresh 的坑点值得记录下来，我可以帮你提取成 gotcha，下次不会重踩，要保存吗？」

## 临时上下文（working 类型）

只在本次会话有用的上下文，用 working 类型存储（7 天自动过期）：

\`\`\`bash
echo "<临时上下文>" | brain extract --type working
\`\`\`

## 跨会话目标（goal 类型）

用户描述的多会话任务，用 goal 类型记录：

\`\`\`bash
echo "目标：<描述>

进度：
- [ ] 步骤一" | brain extract --type goal
\`\`\`

\`brain inject\` 会在每次会话开始时优先展示所有 active goal，自动恢复上下文。

## 会话结束时（推荐）

本次会话有重要发现时：

\`\`\`bash
git log -1 --pretty=format:"%B" | brain extract --source git-commit
\`\`\`
`;

const CODEX_RULES_CONTENT = `# RepoBrain 会话规则（Codex）

## 会话开始时（必须）

每次新会话开始时，在回复用户之前先执行：

\`\`\`bash
brain inject
\`\`\`

将输出内容作为本仓库的背景上下文。如果 \`.brain/\` 不存在，跳过并提示用户运行 \`brain setup\`。

如果已知当前任务，优先使用带路由的组合命令：

\`\`\`bash
brain start --format json --task "<当前任务描述>"
\`\`\`

## 会话过程中

当用户做出以下操作时，主动提议提取记忆：
- 修复了一个之前反复出现的 bug → 提议提取 \`gotcha\`
- 解释了某个架构决策的原因 → 提议提取 \`decision\`
- 描述了一个"绝对不能这样做"的约束 → 提议提取 \`gotcha\`
- 明确了仓库命名或结构规范 → 提议提取 \`convention\`
- 开始一个跨越多轮对话的功能开发 → 提议提取 \`goal\`

提议示例：
> 「这个 JWT refresh 的坑点值得记录下来，我可以帮你提取成 gotcha，下次不会重踩，要保存吗？」

## 临时上下文（working 类型）

只在本次会话有用的上下文，用 working 类型存储（7 天自动过期）：

\`\`\`bash
echo "<临时上下文>" | brain extract --type working
\`\`\`

## 跨会话目标（goal 类型）

用户描述的多会话任务，用 goal 类型记录：

\`\`\`bash
echo "目标：<描述>

进度：
- [ ] 步骤一" | brain extract --type goal
\`\`\`

\`brain inject\` 会在每次会话开始时优先展示所有 active goal，自动恢复上下文。

## 会话结束时（推荐）

本次会话有重要发现时：

\`\`\`bash
git log -1 --pretty=format:"%B" | brain extract --source git-commit
\`\`\`
`;

const CURSOR_RULES_CONTENT = `---
description: RepoBrain session lifecycle — auto-inject repo memory at session start, extract durable lessons at session end
globs:
alwaysApply: true
---

# RepoBrain 会话规则（Cursor）

## 会话开始时（必须）

每次新会话开始时，在回复用户之前先执行：

\`\`\`bash
brain inject
\`\`\`

将输出内容作为本仓库的背景上下文。如果 \`.brain/\` 不存在，跳过并提示用户运行 \`brain setup\`。

如果已知当前任务，优先使用带路由的组合命令：

\`\`\`bash
brain start --format json --task "<当前任务描述>"
\`\`\`

## 会话过程中

当用户做出以下操作时，主动提议提取记忆：
- 修复了一个之前反复出现的 bug → 提议提取 \`gotcha\`
- 解释了某个架构决策的原因 → 提议提取 \`decision\`
- 描述了一个"绝对不能这样做"的约束 → 提议提取 \`gotcha\`
- 明确了仓库命名或结构规范 → 提议提取 \`convention\`
- 开始一个跨越多轮对话的功能开发 → 提议提取 \`goal\`

提议示例：
> 「这个 JWT refresh 的坑点值得记录下来，我可以帮你提取成 gotcha，下次不会重踩，要保存吗？」

## 临时上下文（working 类型）

只在本次会话有用的上下文，用 working 类型存储（7 天自动过期）：

\`\`\`bash
echo "<临时上下文>" | brain extract --type working
\`\`\`

## 跨会话目标（goal 类型）

用户描述的多会话任务，用 goal 类型记录：

\`\`\`bash
echo "目标：<描述>

进度：
- [ ] 步骤一" | brain extract --type goal
\`\`\`

\`brain inject\` 会在每次会话开始时优先展示所有 active goal，自动恢复上下文。

## 会话结束时（推荐）

本次会话有重要发现时：

\`\`\`bash
git log -1 --pretty=format:"%B" | brain extract --source git-commit
\`\`\`

## 规则

- \`.brain/\` 是唯一的持久知识存储。
- 不要在 Cursor 内创建独立的知识副本（如自行创建 .cursor/memories/ 等）。
- \`brain inject\` 提供上下文，\`brain suggest-skills\` 提供路由。
- \`brain extract\` 和 \`brain reinforce\` 是唯一的持久写入路径。
`;

export async function writeSteeringRules(
  projectRoot: string,
  choice: SteeringRulesChoice,
): Promise<string[]> {
  const writtenPaths: string[] = [];
  const writeAll = choice === "all" || choice === "both";

  if (choice === "claude" || writeAll) {
    writtenPaths.push(await writeSteeringRuleFile(projectRoot, CLAUDE_RULES_PATH, CLAUDE_RULES_CONTENT));
  }

  if (choice === "codex" || writeAll) {
    writtenPaths.push(await writeSteeringRuleFile(projectRoot, CODEX_RULES_PATH, CODEX_RULES_CONTENT));
  }

  if (choice === "cursor" || writeAll) {
    writtenPaths.push(await writeSteeringRuleFile(projectRoot, CURSOR_RULES_PATH, CURSOR_RULES_CONTENT));
  }

  return writtenPaths;
}

export async function getSteeringRulesStatus(projectRoot: string): Promise<{
  claudeConfigured: boolean;
  codexConfigured: boolean;
  cursorConfigured: boolean;
}> {
  const [claudeConfigured, codexConfigured, cursorConfigured] = await Promise.all([
    fileExists(path.join(projectRoot, CLAUDE_RULES_PATH)),
    fileExists(path.join(projectRoot, CODEX_RULES_PATH)),
    fileExists(path.join(projectRoot, CURSOR_RULES_PATH)),
  ]);

  return {
    claudeConfigured,
    codexConfigured,
    cursorConfigured,
  };
}

async function writeSteeringRuleFile(projectRoot: string, relativePath: string, content: string): Promise<string> {
  const targetPath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return relativePath.replace(/\\/g, "/");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}
