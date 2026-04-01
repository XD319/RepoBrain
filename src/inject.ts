import { getMemoryStatus, loadAllMemories, recordInjectedMemories } from "./store.js";
import {
  hasSelectionContext,
  normalizeSelectionOptions,
  scoreMemoryForSelection,
} from "./memory-relevance.js";
import type { BrainConfig, Memory, MemoryType } from "./types.js";
import type { MemorySelectionOptions } from "./memory-relevance.js";

const TYPE_ORDER: MemoryType[] = ["decision", "gotcha", "convention", "pattern"];
const IMPORTANCE_SCORE: Record<Memory["importance"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

interface RankedMemory {
  memory: Memory;
  score: number;
  reasons: string[];
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
  const selected = selectWithinTokenBudget(ranked, config.maxInjectTokens, taskAware);

  await recordInjectedMemories(
    projectRoot,
    selected.map((entry) => entry.memory),
  );

  const grouped = new Map<MemoryType, RankedMemory[]>(
    TYPE_ORDER.map((type) => [type, selected.filter((entry) => entry.memory.type === type)]),
  );
  const lastUpdated = allMemories[0]?.date ?? "N/A";

  return [
    "# Project Brain: Repo Knowledge Context",
    "",
    "Before starting the current task, review the project knowledge below. It captures repo decisions, limits, and conventions that should be followed unless you have a clear reason to deviate.",
    ...(taskAware ? ["", renderSelectionSummary(options)] : []),
    "",
    "## High-priority decisions",
    renderGroup(grouped.get("decision") ?? [], taskAware),
    "",
    "## Known gotchas and limits",
    renderGroup(grouped.get("gotcha") ?? [], taskAware),
    "",
    "## Repo conventions",
    renderGroup(grouped.get("convention") ?? [], taskAware),
    "",
    "## Reusable patterns",
    renderGroup(grouped.get("pattern") ?? [], taskAware),
    "",
    "---",
    `Source: .brain/ (${allMemories.length} records, last updated: ${lastUpdated})`,
    "Requirements:",
    "- Understand these memories before choosing an implementation plan",
    "- If you need to conflict with a high-priority memory, explain why first",
    "- Do not suggest approaches that have already been ruled out",
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
        score: match.score,
        reasons: match.reasons,
      };
    })
    .sort((left, right) => compareRankedMemories(left, right, taskAware));
}

function compareRankedMemories(left: RankedMemory, right: RankedMemory, taskAware: boolean): number {
  if (taskAware) {
    const scoreDiff = right.score - left.score;
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
  }

  return compareMemories(left.memory, right.memory);
}

function compareMemories(left: Memory, right: Memory): number {
  const importanceDiff = IMPORTANCE_SCORE[right.importance] - IMPORTANCE_SCORE[left.importance];
  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.date.localeCompare(left.date);
}

function selectWithinTokenBudget(
  rankedMemories: RankedMemory[],
  maxTokens: number,
  taskAware: boolean,
): RankedMemory[] {
  const selected: RankedMemory[] = [];
  let usedTokens = approximateTokens(
    [
      "# Project Brain: Repo Knowledge Context",
      "## High-priority decisions",
      "## Known gotchas and limits",
      "## Repo conventions",
      "## Reusable patterns",
      taskAware ? "Selection mode: task-aware" : "",
      "---",
    ].join("\n"),
  );

  for (const entry of rankedMemories) {
    const rendered = renderRankedMemory(entry, taskAware);
    const renderedTokens = approximateTokens(rendered);

    if (selected.length > 0 && usedTokens + renderedTokens > maxTokens) {
      continue;
    }

    selected.push(entry);
    usedTokens += renderedTokens;
  }

  return selected;
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

  return `Selection mode: task-aware (${parts.join(" | ")}). Relevance is ranked ahead of recency.`;
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
    `- [${entry.memory.importance}] ${entry.memory.title}`,
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
