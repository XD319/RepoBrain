import { loadAllMemories } from "./store.js";
import type { BrainConfig, Memory, MemoryType } from "./types.js";

const TYPE_ORDER: MemoryType[] = ["decision", "gotcha", "convention"];
const IMPORTANCE_SCORE: Record<Memory["importance"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export async function buildInjection(projectRoot: string, config: BrainConfig): Promise<string> {
  const allMemories = await loadAllMemories(projectRoot);
  const activeMemories = allMemories
    .filter((memory) => memory.status !== "superseded")
    .sort(compareMemories);
  const selected = selectWithinTokenBudget(activeMemories, config.maxInjectTokens);
  const grouped = new Map<MemoryType, Memory[]>(
    TYPE_ORDER.map((type) => [type, selected.filter((memory) => memory.type === type)]),
  );
  const lastUpdated = allMemories[0]?.date ?? "N/A";

  return [
    "# Project Brain: Repo Knowledge Context",
    "",
    "Before starting the current task, review the project knowledge below. It captures repo decisions, limits, and conventions that should be followed unless you have a clear reason to deviate.",
    "",
    "## High-priority decisions",
    renderGroup(grouped.get("decision") ?? []),
    "",
    "## Known gotchas and limits",
    renderGroup(grouped.get("gotcha") ?? []),
    "",
    "## Repo conventions",
    renderGroup(grouped.get("convention") ?? []),
    "",
    "---",
    `Source: .brain/ (${allMemories.length} records, last updated: ${lastUpdated})`,
    "Requirements:",
    "- Understand these memories before choosing an implementation plan",
    "- If you need to conflict with a high-priority memory, explain why first",
    "- Do not suggest approaches that have already been ruled out",
  ].join("\n");
}

function compareMemories(left: Memory, right: Memory): number {
  const importanceDiff = IMPORTANCE_SCORE[right.importance] - IMPORTANCE_SCORE[left.importance];
  if (importanceDiff !== 0) {
    return importanceDiff;
  }

  return right.date.localeCompare(left.date);
}

function selectWithinTokenBudget(memories: Memory[], maxTokens: number): Memory[] {
  const selected: Memory[] = [];
  let usedTokens = approximateTokens(
    [
      "# Project Brain: Repo Knowledge Context",
      "## High-priority decisions",
      "## Known gotchas and limits",
      "## Repo conventions",
      "---",
    ].join("\n"),
  );

  for (const memory of memories) {
    const rendered = renderMemory(memory);
    const renderedTokens = approximateTokens(rendered);

    if (selected.length > 0 && usedTokens + renderedTokens > maxTokens) {
      continue;
    }

    selected.push(memory);
    usedTokens += renderedTokens;
  }

  return selected;
}

function renderGroup(memories: Memory[]): string {
  if (memories.length === 0) {
    return "_None._";
  }

  return memories.map(renderMemory).join("\n");
}

function renderMemory(memory: Memory): string {
  const tags = memory.tags.length > 0 ? ` | tags: ${memory.tags.join(", ")}` : "";
  return [
    `- [${memory.importance}] ${memory.title}`,
    `  ${memory.summary}`,
    `  Scope: ${extractScope(memory.detail)}${tags}`,
  ].join("\n");
}

function extractScope(detail: string): string {
  const singleLine = detail
    .replace(/^##\s+\w+\s*/m, "")
    .replace(/\s+/g, " ")
    .trim();

  return singleLine.slice(0, 180) || "See memory detail.";
}

function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
