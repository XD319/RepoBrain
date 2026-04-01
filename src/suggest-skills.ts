import { getMemoryStatus, loadStoredMemoryRecords } from "./store.js";
import {
  matchPathPatterns,
  matchTaskTriggers,
  normalizePath,
  normalizePaths,
  normalizeText,
} from "./memory-relevance.js";
import type {
  Importance,
  InvocationMode,
  RiskLevel,
  StoredMemoryRecord,
} from "./types.js";

export interface SuggestSkillsOptions {
  task?: string;
  paths?: string[];
}

export interface SkillSuggestionResult {
  task?: string;
  paths: string[];
  matchedMemories: MatchedMemory[];
  skills: SkillSuggestion[];
}

export interface MatchedMemory {
  record: StoredMemoryRecord;
  reasons: string[];
  score: number;
}

export interface SkillSuggestion {
  skill: string;
  disposition: SkillDisposition;
  score: number;
  sources: SkillSuggestionSource[];
}

export interface SkillSuggestionSource {
  memoryTitle: string;
  relativePath: string;
  relation: SkillRelation;
}

type SkillDisposition = "required" | "recommended" | "suppressed" | "conflicted";
type SkillRelation = "required" | "recommended" | "suppressed";

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

export async function buildSkillShortlist(
  projectRoot: string,
  options: SuggestSkillsOptions,
): Promise<SkillSuggestionResult> {
  const task = options.task?.trim();
  const paths = normalizePaths(options.paths ?? []);

  if (!task && paths.length === 0) {
    throw new Error('Provide a task with "--task" (or stdin) and/or at least one "--path".');
  }

  const records = await loadStoredMemoryRecords(projectRoot);
  const matchedMemories = records
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

  return {
    ...(task ? { task } : {}),
    paths,
    matchedMemories,
    skills: buildSuggestions(matchedMemories),
  };
}

export function renderSkillShortlist(result: SkillSuggestionResult): string {
  const lines: string[] = [];

  if (result.task) {
    lines.push(`Task: ${result.task}`);
  }

  lines.push("Paths:");
  if (result.paths.length === 0) {
    lines.push("- None.");
  } else {
    for (const item of result.paths) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("");
  lines.push("Matched memories:");
  if (result.matchedMemories.length === 0) {
    lines.push("- None.");
  } else {
    for (const entry of result.matchedMemories) {
      lines.push(
        `- ${entry.record.memory.type} | ${entry.record.memory.importance} | ${entry.record.memory.title}`,
      );
      lines.push(`  File: ${toDisplayPath(entry.record.relativePath)}`);
      lines.push(`  Why: ${entry.reasons.join("; ")}`);
    }
  }

  lines.push("");
  lines.push("Skill shortlist:");
  if (result.skills.length === 0) {
    lines.push("- None.");
  } else {
    for (const skill of result.skills) {
      lines.push(`- ${skill.skill} | ${skill.disposition} | score=${skill.score}`);
      lines.push(`  From: ${formatSources(skill.sources)}`);
    }
  }

  return lines.join("\n");
}

function buildSuggestions(matchedMemories: MatchedMemory[]): SkillSuggestion[] {
  const suggestions = new Map<
    string,
    {
      requiredScore: number;
      recommendedScore: number;
      suppressedScore: number;
      sources: SkillSuggestionSource[];
    }
  >();

  for (const entry of matchedMemories) {
    const memory = entry.record.memory;
    addSkillRelations(suggestions, memory.required_skills ?? [], entry, "required", 6);
    addSkillRelations(suggestions, memory.recommended_skills ?? [], entry, "recommended", 3);
    addSkillRelations(suggestions, memory.suppressed_skills ?? [], entry, "suppressed", 1);
  }

  return Array.from(suggestions.entries())
    .map(([skill, aggregate]) => {
      const disposition = resolveDisposition(
        aggregate.requiredScore,
        aggregate.recommendedScore,
        aggregate.suppressedScore,
      );

      return {
        skill,
        disposition,
        score:
          aggregate.requiredScore +
          aggregate.recommendedScore +
          aggregate.suppressedScore,
        sources: aggregate.sources.sort((left, right) => left.memoryTitle.localeCompare(right.memoryTitle)),
      };
    })
    .sort((left, right) => {
      const priorityDifference =
        DISPOSITION_PRIORITY[left.disposition] - DISPOSITION_PRIORITY[right.disposition];
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      const scoreDifference = right.score - left.score;
      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.skill.localeCompare(right.skill);
    });
}

function addSkillRelations(
  suggestions: Map<
    string,
    {
      requiredScore: number;
      recommendedScore: number;
      suppressedScore: number;
      sources: SkillSuggestionSource[];
    }
  >,
  skills: string[],
  entry: MatchedMemory,
  relation: SkillRelation,
  bonus: number,
): void {
  for (const skill of new Set(skills)) {
    const aggregate = suggestions.get(skill) ?? {
      requiredScore: 0,
      recommendedScore: 0,
      suppressedScore: 0,
      sources: [],
    };

    switch (relation) {
      case "required":
        aggregate.requiredScore += entry.score + bonus;
        break;
      case "recommended":
        aggregate.recommendedScore += entry.score + bonus;
        break;
      case "suppressed":
        aggregate.suppressedScore += entry.score + bonus;
        break;
    }

    aggregate.sources.push({
      memoryTitle: entry.record.memory.title,
      relativePath: toDisplayPath(entry.record.relativePath),
      relation,
    });

    suggestions.set(skill, aggregate);
  }
}

function resolveDisposition(
  requiredScore: number,
  recommendedScore: number,
  suppressedScore: number,
): SkillDisposition {
  const hasRequired = requiredScore > 0;
  const hasRecommended = recommendedScore > 0;
  const hasSuppressed = suppressedScore > 0;

  if ((hasRequired && hasSuppressed) || (hasRecommended && hasSuppressed)) {
    return "conflicted";
  }

  if (hasRequired) {
    return "required";
  }

  if (hasRecommended) {
    return "recommended";
  }

  return "suppressed";
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
    .map((source) => `${source.relation} via ${source.memoryTitle} (${source.relativePath})`)
    .join("; ");
}

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}
