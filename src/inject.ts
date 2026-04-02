import { execSync } from "node:child_process";

import { getMemoryStatus, loadStoredMemoryRecords, recordInjectedMemories } from "./store.js";
import { computeInjectPriority } from "./memory-priority.js";
import {
  hasSelectionContext,
  normalizeSelectionOptions,
  scoreMemoryForSelection,
} from "./memory-relevance.js";
import type { MemorySelectionOptions } from "./memory-relevance.js";
import type { BrainConfig, Memory, MemoryArea, StoredMemoryRecord } from "./types.js";

export interface GitContext {
  changedFiles: string[];
  branchName: string;
}

export interface BuildInjectionOptions extends MemorySelectionOptions {
  noContext?: boolean;
  explain?: boolean;
  includeWorking?: boolean;
  gitContext?: GitContext;
}

interface RankedMemory {
  relativePath: string;
  memory: Memory;
  relevanceScore: number;
  gitContextScore: number;
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
  rawOptions: BuildInjectionOptions = {},
): Promise<string> {
  const allRecords = await loadStoredMemoryRecords(projectRoot);
  const allMemories = allRecords.map((entry) => entry.memory);
  const activeRecords = allRecords.filter((entry) => {
    if (getMemoryStatus(entry.memory) !== "active") {
      return false;
    }

    if (rawOptions.includeWorking) {
      return true;
    }

    return entry.memory.type !== "working";
  });
  const candidateCount = allRecords.filter((entry) => getMemoryStatus(entry.memory) === "candidate").length;
  emitLineageWarnings(activeRecords);
  const staleCount = activeRecords.filter((entry) => entry.memory.stale).length;
  const options = normalizeSelectionOptions(rawOptions);
  const taskAware = hasSelectionContext(options);
  const gitContext = rawOptions.noContext ? { changedFiles: [], branchName: "" } : (rawOptions.gitContext ?? getGitContext(projectRoot));
  const gitContextEnabled = !rawOptions.noContext && shouldUseGitContext(activeRecords, gitContext);
  const ranked = rankMemories(activeRecords, options, {
    taskAware,
    gitContext,
    gitContextEnabled,
  });
  const selection = selectWithinTokenBudget(ranked, config.maxInjectTokens, staleCount);
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
    ...(taskAware || gitContextEnabled ? ["", renderSelectionSummary(options, gitContext, gitContextEnabled)] : []),
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
    ...(rawOptions.explain ? [renderExplainComment(selected)] : []),
  ].join("\n");
}

function rankMemories(
  records: StoredMemoryRecord[],
  options: MemorySelectionOptions,
  context: {
    taskAware: boolean;
    gitContext: GitContext;
    gitContextEnabled: boolean;
  },
): RankedMemory[] {
  return records
    .filter((entry) => entry.memory.superseded_by === null && !entry.memory.stale)
    .map((entry) => {
      const memory = entry.memory;
      const match = context.taskAware ? scoreMemoryForSelection(memory, options) : { score: 0, reasons: [] };
      const gitContextScore = context.gitContextEnabled ? scoreMemory(memory, context.gitContext) : 0;
      return {
        relativePath: toBrainRelativePath(entry.relativePath),
        memory,
        relevanceScore: gitContextScore + match.score,
        gitContextScore,
        injectPriority: computeInjectPriority(memory),
        reasons: match.reasons,
      };
    })
    .sort(compareRankedMemories);
}

function compareRankedMemories(left: RankedMemory, right: RankedMemory): number {
  const goalDiff = Number(isAlwaysIncludedGoal(right.memory)) - Number(isAlwaysIncludedGoal(left.memory));
  if (goalDiff !== 0) {
    return goalDiff;
  }

  const scoreDiff = right.relevanceScore - left.relevanceScore;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const priorityDiff = right.injectPriority - left.injectPriority;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return right.memory.date.localeCompare(left.memory.date);
}

function selectWithinTokenBudget(
  rankedMemories: RankedMemory[],
  maxTokens: number,
  staleCount: number,
): SelectionResult {
  const selected: RankedMemory[] = [];
  const requiredMemories = rankedMemories.filter((entry) => isAlwaysIncludedGoal(entry.memory));
  const optionalMemories = rankedMemories.filter((entry) => !isAlwaysIncludedGoal(entry.memory));
  const eligibleMemories = rankedMemories;
  let usedTokens = approximateTokens(
    [
      "# Project Brain: Repo Knowledge Context",
      "## Injected Memories (Priority Order)",
      "Selection mode:",
      "---",
      "[RepoBrain] injected 0/0 eligible memories.",
    ].join("\n"),
  );

  for (const entry of requiredMemories) {
    const renderedTokens = approximateTokens(renderRankedMemory(entry, entry.reasons.length > 0));
    selected.push(entry);
    usedTokens += renderedTokens;
  }

  for (const entry of optionalMemories) {
    const rendered = renderRankedMemory(entry, entry.reasons.length > 0);
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

function renderSelectionSummary(
  options: MemorySelectionOptions,
  gitContext: GitContext,
  gitContextEnabled: boolean,
): string {
  const parts: string[] = [];
  const modes: string[] = [];

  if (gitContextEnabled) {
    modes.push("git-context");
    parts.push(`changed=${gitContext.changedFiles.length}`);
    if (gitContext.branchName) {
      parts.push(`branch="${gitContext.branchName}"`);
    }
  }

  if (hasSelectionContext(options)) {
    modes.push("task-aware");
  }

  if (options.task) {
    parts.push(`task="${options.task}"`);
  }

  if ((options.paths ?? []).length > 0) {
    parts.push(`paths=${options.paths?.join(", ")}`);
  }

  if ((options.modules ?? []).length > 0) {
    parts.push(`modules=${options.modules?.join(", ")}`);
  }

  return `Selection mode: ${modes.join(" + ")} (${parts.join(" | ")}). Memories are ranked by contextual score, then injection priority.`;
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

function shouldUseGitContext(records: StoredMemoryRecord[], gitContext: GitContext): boolean {
  if (gitContext.changedFiles.length === 0 && !gitContext.branchName) {
    return false;
  }

  return records.some((entry) => (entry.memory.files ?? []).length > 0 || Boolean(entry.memory.area));
}

function getGitContext(projectRoot: string): GitContext {
  try {
    const changedFiles = execSync("git diff --name-only HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((value) => normalizeGitPath(value))
      .filter(Boolean);
    const branchName = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { changedFiles, branchName };
  } catch {
    return { changedFiles: [], branchName: "" };
  }
}

function scoreMemory(memory: Memory, gitContext: GitContext): number {
  let score = 0;
  const importanceScore: Record<string, number> = { high: 15, medium: 10, low: 5 };
  score += importanceScore[memory.importance] ?? 10;

  const changedFiles = gitContext.changedFiles.map((value) => normalizeGitPath(value));
  const memoryFiles = memory.files ?? [];

  if (memoryFiles.length > 0 && changedFiles.length > 0) {
    const hasMatch = memoryFiles.some((pattern) =>
      changedFiles.some((filePath) => matchesGlob(filePath, pattern)),
    );
    if (hasMatch) {
      score += 40;
    }
  }

  if (memory.area && changedFiles.length > 0) {
    const areaPrefix = areaToPathPrefix(memory.area);
    if (areaPrefix && changedFiles.some((filePath) => filePath.startsWith(areaPrefix))) {
      score += 20;
    }
  }

  if ((memory.tags ?? []).length > 0 && gitContext.branchName) {
    const branchWords = tokenize(gitContext.branchName);
    if (memory.tags.some((tag) => branchWords.includes(normalizeToken(tag)))) {
      score += 20;
    }
  }

  return score;
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const normalizedPath = normalizeGitPath(filePath);
  const normalizedPattern = normalizeGitPath(pattern);
  if (!normalizedPattern) {
    return false;
  }

  if (!normalizedPattern.includes("*")) {
    return normalizedPath === normalizedPattern;
  }

  let regexSource = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    const nextCharacter = normalizedPattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      regexSource += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      regexSource += "[^/]*";
      continue;
    }

    regexSource += escapeRegExp(character ?? "");
  }
  regexSource += "$";

  return new RegExp(regexSource).test(normalizedPath);
}

function areaToPathPrefix(area: MemoryArea): string {
  const areaPrefixes: Record<MemoryArea, string> = {
    auth: "src/auth",
    api: "src/api",
    db: "src/db",
    infra: "infra",
    ui: "src/ui",
    testing: "test",
    general: "",
  };

  return areaPrefixes[area];
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((item) => normalizeToken(item))
    .filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeGitPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function isAlwaysIncludedGoal(memory: Memory): boolean {
  return memory.type === "goal" && getMemoryStatus(memory) === "active";
}

function renderExplainComment(memories: RankedMemory[]): string {
  const parts = memories.map((entry) => `${entry.relativePath}=${entry.gitContextScore}`);
  return `<!-- brain-inject-scores: ${parts.join(", ")} -->`;
}
