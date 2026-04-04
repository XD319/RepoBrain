import { execSync } from "node:child_process";
import { getMemoryStatus, loadStoredMemoryRecords } from "./store.js";
import {
  matchPathPatterns,
  matchTaskTriggers,
  normalizePaths,
} from "./memory-relevance.js";
import type {
  Importance,
  InvocationMode,
  RiskLevel,
  StoredMemoryRecord,
} from "./types.js";

export type PathSource = "explicit" | "git_diff" | "none";

export interface SuggestSkillsOptions {
  task?: string;
  paths?: string[];
  path_source?: PathSource;
}

export const SUGGEST_SKILLS_CONTRACT_VERSION = "repobrain.skill-plan.v1";
export const SUGGEST_SKILLS_CONTRACT_KIND = "repobrain.skill_invocation_plan";

export interface SkillSuggestionResult {
  contract_version: typeof SUGGEST_SKILLS_CONTRACT_VERSION;
  kind: typeof SUGGEST_SKILLS_CONTRACT_KIND;
  task?: string;
  paths: string[];
  path_source: PathSource;
  matched_memories: MatchedMemory[];
  resolved_skills: ResolvedSkill[];
  conflicts: SkillConflict[];
  invocation_plan: InvocationPlan;
  matchedMemories: MatchedMemory[];
  skills: ResolvedSkill[];
}

export interface MatchedMemory {
  record: StoredMemoryRecord;
  reasons: string[];
  score: number;
}

export interface SkillSuggestionSource {
  memory_title: string;
  relative_path: string;
  relation: SkillRelation;
  invocation_mode: InvocationMode;
  risk_level: RiskLevel;
  importance: Importance;
  match_score: number;
}

export interface ResolvedSkill {
  skill: string;
  disposition: SkillDisposition;
  score: number;
  plan_slot: InvocationPlanSlot | "none";
  sources: SkillSuggestionSource[];
}

export interface SkillConflict {
  skill: string;
  kind: SkillConflictKind;
  strategy_result: RequiredSuppressionStrategy | "suppress";
  reason: string;
  required_score: number;
  recommended_score: number;
  suppressed_score: number;
  sources: SkillSuggestionSource[];
}

export interface InvocationPlan {
  required: string[];
  prefer_first: string[];
  optional_fallback: string[];
  suppress: string[];
  blocked: string[];
  human_review: string[];
}

export type SuggestSkillsOutputFormat = "markdown" | "json";

type SkillDisposition = "required" | "recommended" | "suppressed" | "conflicted";
type SkillRelation = "required" | "recommended" | "suppressed";
type SkillConflictKind = "required_vs_suppressed" | "recommended_vs_suppressed";
type RequiredSuppressionStrategy = "block" | "human-review" | "choose-required";
type InvocationPlanSlot =
  | "required"
  | "prefer_first"
  | "optional_fallback"
  | "suppress"
  | "blocked"
  | "human_review";

interface SkillAggregate {
  skill: string;
  required_score: number;
  recommended_score: number;
  suppressed_score: number;
  sources: SkillSuggestionSource[];
}

const IMPORTANCE_WEIGHT: Record<Importance, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const RISK_WEIGHT: Record<RiskLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const INVOCATION_WEIGHT: Record<InvocationMode, number> = {
  required: 3,
  prefer: 2,
  optional: 1,
  suppress: 0,
};

const DISPOSITION_PRIORITY: Record<SkillDisposition, number> = {
  required: 0,
  conflicted: 1,
  recommended: 2,
  suppressed: 3,
};

const PLAN_SLOT_PRIORITY: Record<InvocationPlanSlot | "none", number> = {
  required: 0,
  blocked: 1,
  human_review: 2,
  prefer_first: 3,
  optional_fallback: 4,
  suppress: 5,
  none: 6,
};

export async function buildSkillShortlist(
  projectRoot: string,
  options: SuggestSkillsOptions,
): Promise<SkillSuggestionResult> {
  const task = options.task?.trim();
  const paths = normalizePaths(options.paths ?? []);
  const path_source: PathSource = options.path_source ?? (paths.length > 0 ? "explicit" : "none");

  if (!task && paths.length === 0) {
    throw new Error(
      'Provide a task with "--task" (or stdin) and/or at least one "--path". ' +
      "When --path is omitted, the CLI auto-collects paths from git diff; " +
      "pass --task alone if no git context is available.",
    );
  }

  const records = await loadStoredMemoryRecords(projectRoot);
  const matched_memories = records
    .filter((entry) => getMemoryStatus(entry.memory) === "active")
    .map((entry) => matchMemory(entry, task, paths))
    .filter((entry): entry is MatchedMemory => entry !== null)
    .sort((left, right) => {
      const scoreDifference = right.score - left.score;
      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return right.record.memory.date.localeCompare(left.record.memory.date);
    });

  const routing = buildRouting(matched_memories);

  return {
    contract_version: SUGGEST_SKILLS_CONTRACT_VERSION,
    kind: SUGGEST_SKILLS_CONTRACT_KIND,
    ...(task ? { task } : {}),
    paths,
    path_source,
    matched_memories,
    resolved_skills: routing.resolved_skills,
    conflicts: routing.conflicts,
    invocation_plan: routing.invocation_plan,
    matchedMemories: matched_memories,
    skills: routing.resolved_skills,
  };
}

export function renderSkillShortlist(result: SkillSuggestionResult): string {
  const lines: string[] = [];

  if (result.task) {
    lines.push(`Task: ${result.task}`);
  }

  lines.push(`Contract: ${result.contract_version} (${result.kind})`);
  const pathLabel = result.path_source === "git_diff" ? "Paths (from git diff):" : "Paths:";
  lines.push(pathLabel);
  if (result.paths.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of result.paths) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("");
  lines.push("Matched memories:");
  if (result.matched_memories.length === 0) {
    lines.push("- None.");
  } else {
    for (const entry of result.matched_memories) {
      lines.push(
        `- ${entry.record.memory.type} | ${entry.record.memory.importance} | score=${entry.score} | ${entry.record.memory.title}`,
      );
      lines.push(`  File: ${toDisplayPath(entry.record.relativePath)}`);
      lines.push(`  Why: ${entry.reasons.join("; ")}`);
    }
  }

  lines.push("");
  lines.push("Resolved skills:");
  if (result.resolved_skills.length === 0) {
    lines.push("- None.");
  } else {
    for (const skill of result.resolved_skills) {
      lines.push(
        `- ${skill.skill} | ${skill.disposition} | plan=${skill.plan_slot} | score=${skill.score}`,
      );
      lines.push(`  From: ${formatSources(skill.sources)}`);
    }
  }

  lines.push("");
  lines.push("Conflicts:");
  if (result.conflicts.length === 0) {
    lines.push("- None.");
  } else {
    for (const conflict of result.conflicts) {
      lines.push(
        `- ${conflict.skill} | ${conflict.kind} | strategy=${conflict.strategy_result}`,
      );
      lines.push(`  Reason: ${conflict.reason}`);
      lines.push(`  From: ${formatSources(conflict.sources)}`);
    }
  }

  lines.push("");
  lines.push("Invocation plan:");
  lines.push(renderPlanLine("required", result.invocation_plan.required));
  lines.push(renderPlanLine("prefer_first", result.invocation_plan.prefer_first));
  lines.push(renderPlanLine("optional_fallback", result.invocation_plan.optional_fallback));
  lines.push(renderPlanLine("suppress", result.invocation_plan.suppress));
  lines.push(renderPlanLine("blocked", result.invocation_plan.blocked));
  lines.push(renderPlanLine("human_review", result.invocation_plan.human_review));

  return lines.join("\n");
}

export function renderSkillShortlistJson(result: SkillSuggestionResult): string {
  return JSON.stringify(result, null, 2);
}

function buildRouting(matched_memories: MatchedMemory[]): {
  resolved_skills: ResolvedSkill[];
  conflicts: SkillConflict[];
  invocation_plan: InvocationPlan;
} {
  const suggestions = new Map<string, SkillAggregate>();

  for (const entry of matched_memories) {
    const memory = entry.record.memory;
    addSkillRelations(suggestions, memory.required_skills ?? [], entry, "required", 6);
    addSkillRelations(suggestions, memory.recommended_skills ?? [], entry, "recommended", 3);
    addSkillRelations(suggestions, memory.suppressed_skills ?? [], entry, "suppressed", 1);
  }

  const conflicts: SkillConflict[] = [];
  const resolved_skills = Array.from(suggestions.values())
    .map((aggregate) => resolveSkillAggregate(aggregate, conflicts))
    .sort(compareResolvedSkills);

  const invocation_plan = buildInvocationPlan(resolved_skills);

  return {
    resolved_skills,
    conflicts: conflicts.sort(compareConflicts),
    invocation_plan,
  };
}

function addSkillRelations(
  suggestions: Map<string, SkillAggregate>,
  skills: string[],
  entry: MatchedMemory,
  relation: SkillRelation,
  bonus: number,
): void {
  for (const skill of new Set(skills)) {
    const aggregate = suggestions.get(skill) ?? {
      skill,
      required_score: 0,
      recommended_score: 0,
      suppressed_score: 0,
      sources: [],
    };

    switch (relation) {
      case "required":
        aggregate.required_score += entry.score + bonus;
        break;
      case "recommended":
        aggregate.recommended_score += entry.score + bonus;
        break;
      case "suppressed":
        aggregate.suppressed_score += entry.score + bonus;
        break;
    }

    aggregate.sources.push({
      memory_title: entry.record.memory.title,
      relative_path: toDisplayPath(entry.record.relativePath),
      relation,
      invocation_mode: entry.record.memory.invocation_mode ?? "optional",
      risk_level: entry.record.memory.risk_level ?? "low",
      importance: entry.record.memory.importance,
      match_score: entry.score,
    });

    suggestions.set(skill, aggregate);
  }
}

function resolveSkillAggregate(
  aggregate: SkillAggregate,
  conflicts: SkillConflict[],
): ResolvedSkill {
  const has_required = aggregate.required_score > 0;
  const has_recommended = aggregate.recommended_score > 0;
  const has_suppressed = aggregate.suppressed_score > 0;

  if (has_required && has_suppressed) {
    const strategy = resolveRequiredSuppressionStrategy(aggregate);
    const reason = describeRequiredSuppressionReason(aggregate, strategy);
    conflicts.push({
      skill: aggregate.skill,
      kind: "required_vs_suppressed",
      strategy_result: strategy,
      reason,
      required_score: aggregate.required_score,
      recommended_score: aggregate.recommended_score,
      suppressed_score: aggregate.suppressed_score,
      sources: sortSources(aggregate.sources),
    });

    return {
      skill: aggregate.skill,
      disposition: "conflicted",
      score: aggregate.required_score + aggregate.recommended_score + aggregate.suppressed_score,
      plan_slot:
        strategy === "choose-required"
          ? "required"
          : strategy === "block"
            ? "blocked"
            : "human_review",
      sources: sortSources(aggregate.sources),
    };
  }

  if (has_recommended && has_suppressed) {
    const reason = describeRecommendedSuppressionReason(aggregate);
    conflicts.push({
      skill: aggregate.skill,
      kind: "recommended_vs_suppressed",
      strategy_result: "suppress",
      reason,
      required_score: aggregate.required_score,
      recommended_score: aggregate.recommended_score,
      suppressed_score: aggregate.suppressed_score,
      sources: sortSources(aggregate.sources),
    });

    return {
      skill: aggregate.skill,
      disposition: "conflicted",
      score: aggregate.required_score + aggregate.recommended_score + aggregate.suppressed_score,
      plan_slot: "suppress",
      sources: sortSources(aggregate.sources),
    };
  }

  if (has_required) {
    return {
      skill: aggregate.skill,
      disposition: "required",
      score: aggregate.required_score + aggregate.recommended_score + aggregate.suppressed_score,
      plan_slot: "required",
      sources: sortSources(aggregate.sources),
    };
  }

  if (has_recommended) {
    return {
      skill: aggregate.skill,
      disposition: "recommended",
      score: aggregate.required_score + aggregate.recommended_score + aggregate.suppressed_score,
      plan_slot: resolveRecommendedPlanSlot(aggregate.sources),
      sources: sortSources(aggregate.sources),
    };
  }

  return {
    skill: aggregate.skill,
    disposition: "suppressed",
    score: aggregate.required_score + aggregate.recommended_score + aggregate.suppressed_score,
    plan_slot: "suppress",
    sources: sortSources(aggregate.sources),
  };
}

function resolveRequiredSuppressionStrategy(
  aggregate: SkillAggregate,
): RequiredSuppressionStrategy {
  const suppressedSources = aggregate.sources.filter((source) => source.relation === "suppressed");
  const hasHighRiskSuppression = suppressedSources.some((source) => source.risk_level === "high");
  const scoreDelta = aggregate.required_score - aggregate.suppressed_score;

  if (hasHighRiskSuppression && aggregate.suppressed_score >= aggregate.required_score) {
    return "block";
  }

  if (scoreDelta >= 5 && !hasHighRiskSuppression) {
    return "choose-required";
  }

  return "human-review";
}

function describeRequiredSuppressionReason(
  aggregate: SkillAggregate,
  strategy: RequiredSuppressionStrategy,
): string {
  const suppressedSources = aggregate.sources.filter((source) => source.relation === "suppressed");
  const hasHighRiskSuppression = suppressedSources.some((source) => source.risk_level === "high");

  if (strategy === "block") {
    return [
      `Required score ${aggregate.required_score} is not stronger than suppressed score ${aggregate.suppressed_score}.`,
      "At least one suppressing memory is marked high risk, so the local rule blocks automatic invocation.",
    ].join(" ");
  }

  if (strategy === "choose-required") {
    return [
      `Required score ${aggregate.required_score} exceeds suppressed score ${aggregate.suppressed_score} by at least 5.`,
      "No suppressing memory is marked high risk, so the local rule keeps the required skill.",
    ].join(" ");
  }

  return [
    `Required score ${aggregate.required_score} and suppressed score ${aggregate.suppressed_score} are too close for an automatic decision.`,
    hasHighRiskSuppression
      ? "A high-risk suppressing memory is present, so the local rule escalates to human review."
      : "No deterministic winner exists under the local routing rules, so the conflict is sent to human review.",
  ].join(" ");
}

function describeRecommendedSuppressionReason(aggregate: SkillAggregate): string {
  return [
    `Recommended score ${aggregate.recommended_score} conflicts with suppressed score ${aggregate.suppressed_score}.`,
    "RepoBrain keeps the suppression in the final plan because recommendations are advisory while suppressions are explicit do-not-invoke hints.",
  ].join(" ");
}

function resolveRecommendedPlanSlot(
  sources: SkillSuggestionSource[],
): "prefer_first" | "optional_fallback" {
  const recommendedSources = sources.filter((source) => source.relation === "recommended");
  const hasPreferFirstSource = recommendedSources.some((source) =>
    source.invocation_mode === "required" || source.invocation_mode === "prefer",
  );

  return hasPreferFirstSource ? "prefer_first" : "optional_fallback";
}

function buildInvocationPlan(resolved_skills: ResolvedSkill[]): InvocationPlan {
  const plan: InvocationPlan = {
    required: [],
    prefer_first: [],
    optional_fallback: [],
    suppress: [],
    blocked: [],
    human_review: [],
  };

  for (const skill of resolved_skills) {
    switch (skill.plan_slot) {
      case "required":
        plan.required.push(skill.skill);
        break;
      case "prefer_first":
        plan.prefer_first.push(skill.skill);
        break;
      case "optional_fallback":
        plan.optional_fallback.push(skill.skill);
        break;
      case "suppress":
        plan.suppress.push(skill.skill);
        break;
      case "blocked":
        plan.blocked.push(skill.skill);
        break;
      case "human_review":
        plan.human_review.push(skill.skill);
        break;
      case "none":
        break;
    }
  }

  return plan;
}

function compareResolvedSkills(left: ResolvedSkill, right: ResolvedSkill): number {
  const dispositionDifference = DISPOSITION_PRIORITY[left.disposition] - DISPOSITION_PRIORITY[right.disposition];
  if (dispositionDifference !== 0) {
    return dispositionDifference;
  }

  const planDifference = PLAN_SLOT_PRIORITY[left.plan_slot] - PLAN_SLOT_PRIORITY[right.plan_slot];
  if (planDifference !== 0) {
    return planDifference;
  }

  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return left.skill.localeCompare(right.skill);
}

function compareConflicts(left: SkillConflict, right: SkillConflict): number {
  const strategyDifference = left.strategy_result.localeCompare(right.strategy_result);
  if (strategyDifference !== 0) {
    return strategyDifference;
  }

  const scoreDifference =
    right.required_score +
    right.recommended_score +
    right.suppressed_score -
    (left.required_score + left.recommended_score + left.suppressed_score);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return left.skill.localeCompare(right.skill);
}

function sortSources(sources: SkillSuggestionSource[]): SkillSuggestionSource[] {
  return [...sources].sort((left, right) => {
    const relationDifference = left.relation.localeCompare(right.relation);
    if (relationDifference !== 0) {
      return relationDifference;
    }

    const scoreDifference = right.match_score - left.match_score;
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return left.memory_title.localeCompare(right.memory_title);
  });
}

function matchMemory(
  record: StoredMemoryRecord,
  task: string | undefined,
  paths: string[],
): MatchedMemory | null {
  const taskReasons = task
    ? matchTaskTriggers(task, record.memory.skill_trigger_tasks ?? [], "task")
    : [];
  const pathReasons = matchPathPatterns(paths, record.memory.skill_trigger_paths ?? [], "path");
  const reasons = [...taskReasons, ...pathReasons];

  if (reasons.length === 0) {
    return null;
  }

  const memory = record.memory;
  const score =
    reasons.length * 4 +
    IMPORTANCE_WEIGHT[memory.importance] +
    RISK_WEIGHT[memory.risk_level ?? "low"] +
    INVOCATION_WEIGHT[memory.invocation_mode ?? "optional"];

  return {
    record,
    reasons,
    score,
  };
}

function formatSources(sources: SkillSuggestionSource[]): string {
  return sources
    .map(
      (source) =>
        `${source.relation} via ${source.memory_title} (${source.relative_path}; mode=${source.invocation_mode}; risk=${source.risk_level}; score=${source.match_score})`,
    )
    .join("; ");
}

function renderPlanLine(label: string, values: string[]): string {
  return `- ${label}: ${values.length > 0 ? values.join(", ") : "None."}`;
}

export function collectGitDiffPaths(projectRoot: string): string[] {
  try {
    return execSync("git diff --name-only HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((value) => value.trim().replace(/\\/g, "/").replace(/^\.\/+/, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveSuggestedSkillPaths(
  projectRoot: string,
  explicitPaths: string[],
): {
  paths: string[];
  path_source: PathSource;
  warnings: string[];
} {
  const normalizedExplicitPaths = normalizePaths(explicitPaths);
  if (normalizedExplicitPaths.length > 0) {
    return {
      paths: normalizedExplicitPaths,
      path_source: "explicit",
      warnings: [],
    };
  }

  const gitPaths = collectGitDiffPaths(projectRoot);
  if (gitPaths.length > 0) {
    return {
      paths: gitPaths,
      path_source: "git_diff",
      warnings: [],
    };
  }

  return {
    paths: [],
    path_source: "none",
    warnings: [
      "Git diff paths were unavailable, so RepoBrain continued with task-only routing.",
    ],
  };
}

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}
