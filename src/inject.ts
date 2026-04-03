import { execSync } from "node:child_process";

import { getMemoryStatus, loadStoredMemoryRecords, recordInjectedMemories } from "./store.js";
import {
  buildInjectScoreReport,
  explainSelectionDecision,
  formatCompactReasons,
  hasSelectionContext,
  normalizeSelectionOptions,
} from "./inject-ranking.js";
import type { DiversitySelectionDecision, MemorySelectionOptions, RankedMemoryCandidate } from "./inject-ranking.js";
import type { BrainConfig, Memory, StoredMemoryRecord } from "./types.js";

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
  report: RankedMemoryCandidate["report"];
  selectionDecision?: DiversitySelectionDecision;
  tokenCost: number;
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
  const ranked = rankMemories(activeRecords, options, {
    gitContext,
    gitContextEnabled: !rawOptions.noContext && shouldUseGitContext(activeRecords, gitContext),
  });
  const selection = selectWithinTokenBudget(
    ranked,
    {
      ...config,
      injectDiversity: config.injectDiversity ?? true,
      injectExplainMaxItems: config.injectExplainMaxItems ?? 4,
    },
    staleCount,
  );
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
    ...(hasSelectionContext(options) || ranked.some((entry) => entry.report.contextScore > 0)
      ? ["", renderSelectionSummary(options, gitContext, ranked.some((entry) => hasGitContextComponent(entry)))]
      : []),
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
    ...(shouldRenderExplain(rawOptions.explain)
      ? [renderExplainComment(selected, config.injectExplainMaxItems ?? 4)]
      : []),
  ].join("\n");
}

function rankMemories(
  records: StoredMemoryRecord[],
  options: MemorySelectionOptions,
  context: {
    gitContext: GitContext;
    gitContextEnabled: boolean;
  },
): RankedMemory[] {
  return records
    .filter((entry) => entry.memory.superseded_by === null && !entry.memory.stale)
    .map((entry) => {
      const memory = entry.memory;
      const report = buildInjectScoreReport(
        memory,
        options,
        context.gitContextEnabled ? context.gitContext : { changedFiles: [], branchName: "" },
      );
      const rendered = renderRankedMemory(
        {
          relativePath: toBrainRelativePath(entry.relativePath),
          memory,
          report,
          tokenCost: 0,
        },
        report.reasons.length > 0,
      );
      return {
        relativePath: toBrainRelativePath(entry.relativePath),
        memory,
        report,
        tokenCost: approximateTokens(rendered),
      };
    })
    .sort(compareRankedMemories);
}

function compareRankedMemories(left: RankedMemory, right: RankedMemory): number {
  const goalDiff = Number(isAlwaysIncludedGoal(right.memory)) - Number(isAlwaysIncludedGoal(left.memory));
  if (goalDiff !== 0) {
    return goalDiff;
  }

  const scoreDiff = right.report.totalScore - left.report.totalScore;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const priorityDiff = right.report.priorityScore - left.report.priorityScore;
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return right.memory.date.localeCompare(left.memory.date);
}

function selectWithinTokenBudget(
  rankedMemories: RankedMemory[],
  config: BrainConfig,
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
    selected.push(entry);
    usedTokens += entry.tokenCost;
  }

  const remaining = [...optionalMemories];
  while (remaining.length > 0) {
    const fitCandidates = remaining.filter((entry) => !(selected.length > 0 && usedTokens + entry.tokenCost > config.maxInjectTokens));
    if (fitCandidates.length === 0) {
      break;
    }

    const chosen = fitCandidates
      .map((entry) => ({
        entry,
        decision: config.injectDiversity ? explainSelectionDecision(entry, selected) : createPlainSelectionDecision(entry),
      }))
      .sort((left, right) => {
        const utilityDiff = right.decision.utilityScore - left.decision.utilityScore;
        if (utilityDiff !== 0) {
          return utilityDiff;
        }

        return compareRankedMemories(left.entry, right.entry);
      })[0];

    if (!chosen) {
      break;
    }

    chosen.entry.selectionDecision = chosen.decision;
    selected.push(chosen.entry);
    usedTokens += chosen.entry.tokenCost;
    remaining.splice(
      remaining.findIndex((entry) => entry.relativePath === chosen.entry.relativePath),
      1,
    );
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

  if (taskAware && entry.report.reasons.length > 0) {
    lines.push(`  Why now: ${formatCompactReasons(entry.report.reasons).join("; ")}`);
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

  return records.some(
    (entry) =>
      (entry.memory.files ?? []).length > 0 ||
      (entry.memory.path_scope ?? []).length > 0 ||
      Boolean(entry.memory.area) ||
      (entry.memory.tags ?? []).length > 0,
  );
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

function normalizeGitPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isAlwaysIncludedGoal(memory: Memory): boolean {
  return memory.type === "goal" && getMemoryStatus(memory) === "active";
}

function renderExplainComment(memories: RankedMemory[], maxItems: number): string {
  const lines = memories.map((entry) => {
    const topComponents = entry.report.components
      .slice()
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, maxItems))
      .map((component) => `${component.key}=${component.score} (${component.detail})`);
    const selectionPart = entry.selectionDecision
      ? ` | utility=${entry.selectionDecision.utilityScore} | diversity=+${entry.selectionDecision.diversityBonus} | redundancy=-${entry.selectionDecision.redundancyPenalty}`
      : "";
    return `${entry.relativePath} | total=${entry.report.totalScore} | context=${entry.report.contextScore} | priority=${entry.report.priorityScore}${selectionPart} | ${topComponents.join(" ; ")}`;
  });

  return ["<!-- brain-inject-report", ...lines.map((line) => line.replace(/-->/g, "--&gt;")), "-->"].join("\n");
}

function shouldRenderExplain(explain: boolean | undefined): boolean {
  if (explain) {
    return true;
  }

  return process.env.REPOBRAIN_DEBUG === "1" || process.env.DEBUG?.includes("repobrain:inject") === true;
}

function hasGitContextComponent(entry: RankedMemory): boolean {
  return entry.report.components.some(
    (component) => component.key === "git_changed_files_match" || component.key === "branch_tag_hint",
  );
}

function createPlainSelectionDecision(entry: RankedMemory): DiversitySelectionDecision {
  return {
    diversityBonus: 0,
    redundancyPenalty: 0,
    novelty: [],
    redundancy: [],
    utilityScore: entry.report.totalScore,
  };
}
