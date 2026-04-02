import { getMemoryStatus, loadAllMemories, recordInjectedMemories } from "./store.js";
import { computeInjectPriority } from "./memory-priority.js";
import {
  hasSelectionContext,
  normalizeSelectionOptions,
  scoreMemoryForSelection,
} from "./memory-relevance.js";
import type { BrainConfig, Memory } from "./types.js";
import type { MemorySelectionOptions } from "./memory-relevance.js";

interface RankedMemory {
  memory: Memory;
  relevanceScore: number;
  injectPriority: number;
  reasons: string[];
}

interface SelectionResult {
  selected: RankedMemory[];
  staleCount: number;
  eligibleCount: number;
}

export async function buildInjection(
  projectRoot: string,
  config: BrainConfig,
  rawOptions: MemorySelectionOptions = {},
): Promise<string> {
  const allMemories = await loadAllMemories(projectRoot);
  const activeMemories = allMemories.filter((memory) => getMemoryStatus(memory) === "active");
  const options = normalizeSelectionOptions(rawOptions);
  const taskAware = hasSelectionContext(options);
  const ranked = rankMemories(activeMemories, options, taskAware);
  const selection = selectWithinTokenBudget(ranked, config.maxInjectTokens, taskAware);
  const selected = selection.selected;

  await recordInjectedMemories(
    projectRoot,
    selected.map((entry) => entry.memory),
  );

  const lastUpdated = allMemories[0]?.date ?? "N/A";

  return [
    "# Project Brain: Repo Knowledge Context",
    "",
    "Before starting the current task, review the project knowledge below. It captures repo decisions, limits, and conventions that should be followed unless you have a clear reason to deviate.",
    ...(taskAware ? ["", renderSelectionSummary(options)] : []),
    "",
    "## Injected Memories (Priority Order)",
    renderGroup(selected, taskAware),
    "",
    "---",
    `Source: .brain/ (${allMemories.length} records, last updated: ${lastUpdated})`,
    `[RepoBrain] 已注入 ${selected.length}/${selection.eligibleCount} 条记忆`,
    "Requirements:",
    "- Understand these memories before choosing an implementation plan",
    "- If you need to conflict with a high-priority memory, explain why first",
    "- Do not suggest approaches that have already been ruled out",
    ...(selection.staleCount > 0
      ? [`⚠ 有 ${selection.staleCount} 条记忆已标记为过期，运行 brain score 查看`]
      : []),
  ].join("\n");
}

function rankMemories(
  memories: Memory[],
  options: MemorySelectionOptions,
  taskAware: boolean,
): RankedMemory[] {
  return memories
    .map((memory) => {
      const match = taskAware ? scoreMemoryForSelection(memory, options) : { score: 0, reasons: [] };
      return {
        memory,
        relevanceScore: match.score,
        injectPriority: computeInjectPriority(memory),
        reasons: match.reasons,
      };
    })
    .sort((left, right) => compareRankedMemories(left, right, taskAware));
}

function compareRankedMemories(left: RankedMemory, right: RankedMemory, taskAware: boolean): number {
  const priorityDiff = right.injectPriority - left.injectPriority;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  if (taskAware) {
    const scoreDiff = right.relevanceScore - left.relevanceScore;
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
  }

  return right.memory.date.localeCompare(left.memory.date);
}

function selectWithinTokenBudget(
  rankedMemories: RankedMemory[],
  maxTokens: number,
  taskAware: boolean,
): SelectionResult {
  const selected: RankedMemory[] = [];
  const staleCount = rankedMemories.filter((entry) => entry.memory.stale).length;
  const eligibleMemories = rankedMemories.filter((entry) => !entry.memory.stale);
  let usedTokens = approximateTokens(
    [
      "# Project Brain: Repo Knowledge Context",
      "## Injected Memories (Priority Order)",
      taskAware ? "Selection mode: task-aware" : "",
      "---",
      "[RepoBrain] 已注入 0/0 条记忆",
    ].join("\n"),
  );

  for (const entry of eligibleMemories) {
    const rendered = renderRankedMemory(entry, taskAware);
    const renderedTokens = approximateTokens(rendered);

    if (selected.length > 0 && usedTokens + renderedTokens > maxTokens) {
      continue;
    }

    selected.push(entry);
    usedTokens += renderedTokens;
  }

  return {
    selected,
    staleCount,
    eligibleCount: eligibleMemories.length,
  };
}

function renderSelectionSummary(options: MemorySelectionOptions): string {
  const parts: string[] = [];

  if (options.task) {
    parts.push(`task="${options.task}"`);
  }

  if ((options.paths ?? []).length > 0) {
    parts.push(`paths=${options.paths?.join(", ")}`);
  }

  if ((options.modules ?? []).length > 0) {
    parts.push(`modules=${options.modules?.join(", ")}`);
  }

  return `Selection mode: task-aware (${parts.join(" | ")}). Memories are selected by injection priority.`;
}

function renderGroup(memories: RankedMemory[], taskAware: boolean): string {
  if (memories.length === 0) {
    return "_None._";
  }

  return memories.map((memory) => renderRankedMemory(memory, taskAware)).join("\n");
}

function renderRankedMemory(entry: RankedMemory, taskAware: boolean): string {
  const tags = entry.memory.tags.length > 0 ? ` | tags: ${entry.memory.tags.join(", ")}` : "";
  const lines = [
    `- [${entry.memory.type} | ${entry.memory.importance}] ${entry.memory.title}`,
    `  ${entry.memory.summary}`,
    `  Scope: ${extractScope(entry.memory.detail)}${tags}`,
  ];

  if (taskAware && entry.reasons.length > 0) {
    lines.push(`  Why now: ${pickDisplayReasons(entry.reasons).join("; ")}`);
  }

  return lines.join("\n");
}

function extractScope(detail: string): string {
  const singleLine = detail
    .replace(/^##\s+\w+\s*/m, "")
    .replace(/\s+/g, " ")
    .trim();

  return singleLine.slice(0, 180) || "See memory detail.";
}

function pickDisplayReasons(reasons: string[]): string[] {
  const preferredPrefixes = [
    "task trigger",
    "task keywords",
    "module scope",
    "path scope",
    "skill trigger path",
  ];
  const selected: string[] = [];

  for (const prefix of preferredPrefixes) {
    const match = reasons.find((reason) => reason.startsWith(`${prefix}:`));
    if (match && !selected.includes(match)) {
      selected.push(match);
    }

    if (selected.length === 2) {
      return selected;
    }
  }

  for (const reason of reasons) {
    if (!selected.includes(reason)) {
      selected.push(reason);
    }

    if (selected.length === 2) {
      return selected;
    }
  }

  return selected;
}

function approximateTokens(text: string): number {
  let asciiChars = 0;
  let nonAsciiTokens = 0;

  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
      continue;
    }

    nonAsciiTokens += 1;
  }

  return Math.ceil(asciiChars / 4) + nonAsciiTokens;
}
