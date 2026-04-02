import { getMemoryStatus, loadStoredMemoryRecords, recordInjectedMemories } from "./store.js";
import { computeInjectPriority } from "./memory-priority.js";
import {
  hasSelectionContext,
  normalizeSelectionOptions,
  scoreMemoryForSelection,
} from "./memory-relevance.js";
import type { MemorySelectionOptions } from "./memory-relevance.js";
import type { BrainConfig, Memory, StoredMemoryRecord } from "./types.js";

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
  const allRecords = await loadStoredMemoryRecords(projectRoot);
  const allMemories = allRecords.map((entry) => entry.memory);
  const activeRecords = allRecords.filter((entry) => getMemoryStatus(entry.memory) === "active");
  const candidateCount = allRecords.filter((entry) => getMemoryStatus(entry.memory) === "candidate").length;
  emitLineageWarnings(activeRecords);
  const staleCount = activeRecords.filter((entry) => entry.memory.stale).length;
  const options = normalizeSelectionOptions(rawOptions);
  const taskAware = hasSelectionContext(options);
  const ranked = rankMemories(activeRecords, options, taskAware);
  const selection = selectWithinTokenBudget(ranked, config.maxInjectTokens, taskAware, staleCount);
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
    `[RepoBrain] injected ${selected.length}/${selection.eligibleCount} eligible memories.`,
    ...(candidateCount > 0
      ? [`Pending review: ${candidateCount} candidate memor${candidateCount === 1 ? "y" : "ies"}. Run "brain review" to inspect them.`]
      : []),
    "Requirements:",
    "- Understand these memories before choosing an implementation plan",
    "- If you need to conflict with a high-priority memory, explain why first",
    "- Do not suggest approaches that have already been ruled out",
    ...(selection.staleCount > 0
      ? [`Note: ${selection.staleCount} stale memor${selection.staleCount === 1 ? "y is" : "ies are"} currently excluded. Run "brain score" to review them.`]
      : []),
  ].join("\n");
}

function rankMemories(
  records: StoredMemoryRecord[],
  options: MemorySelectionOptions,
  taskAware: boolean,
): RankedMemory[] {
  return records
    .filter((entry) => entry.memory.superseded_by === null && !entry.memory.stale)
    .map((entry) => {
      const memory = entry.memory;
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
  staleCount: number,
): SelectionResult {
  const selected: RankedMemory[] = [];
  const eligibleMemories = rankedMemories;
  let usedTokens = approximateTokens(
    [
      "# Project Brain: Repo Knowledge Context",
      "## Injected Memories (Priority Order)",
      taskAware ? "Selection mode: task-aware" : "",
      "---",
      "[RepoBrain] injected 0/0 eligible memories.",
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
  const titlePrefix = entry.memory.version && entry.memory.version >= 2 ? `[Updated v${entry.memory.version}] ` : "";
  const lines = [
    `- [${entry.memory.type} | ${entry.memory.importance}] ${titlePrefix}${entry.memory.title}`,
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

function emitLineageWarnings(activeRecords: StoredMemoryRecord[]): void {
  const byBrainRelativePath = new Map<string, StoredMemoryRecord>();

  for (const entry of activeRecords) {
    byBrainRelativePath.set(toBrainRelativePath(entry.relativePath), entry);
  }

  for (const entry of activeRecords) {
    const supersededPath = entry.memory.supersedes;
    if (!supersededPath) {
      continue;
    }

    const supersededRecord = byBrainRelativePath.get(supersededPath);
    if (!supersededRecord || supersededRecord.memory.superseded_by !== null) {
      continue;
    }

    process.stderr.write(
      `[brain] lineage warning: ${supersededPath} should set superseded_by: ${toBrainRelativePath(entry.relativePath)}\n`,
    );
  }
}

function toBrainRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.brain\//, "");
}
