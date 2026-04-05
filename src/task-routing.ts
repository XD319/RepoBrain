import { buildInjection } from "./inject.js";
import {
  buildSkillShortlist,
  renderSkillShortlist,
  type PathSource,
  type RoutingExplanation,
  type SkillConflict,
  type ResolvedSkill,
  type InvocationPlan,
  type MatchedMemory,
} from "./suggest-skills.js";
import type { BrainConfig } from "./types.js";

export const TASK_ROUTING_BUNDLE_CONTRACT_VERSION = "repobrain.task-routing-bundle.v1";

export type TaskRoutingDisplayMode = "silent-ok" | "needs-review";

export interface BuildTaskRoutingBundleOptions {
  task: string;
  paths?: string[];
  path_source?: PathSource;
  modules?: string[];
  warnings?: string[];
  /** When false, skip `.brain/runtime/session-profile.json` for inject + routing. Default: true. */
  includeSessionProfile?: boolean;
}

export interface TaskRoutingBundle {
  contract_version: typeof TASK_ROUTING_BUNDLE_CONTRACT_VERSION;
  task: string;
  paths: string[];
  path_source: PathSource;
  context_markdown: string;
  skill_plan: InvocationPlan;
  matched_memories: MatchedMemory[];
  resolved_skills: ResolvedSkill[];
  conflicts: SkillConflict[];
  warnings: string[];
  display_mode: TaskRoutingDisplayMode;
  /** Optional machine-readable routing trace (same as `brain suggest-skills` JSON when present). */
  routing_explanation?: RoutingExplanation;
}

export function shouldEscalateRoutingPlan(
  plan: InvocationPlan,
  conflicts: SkillConflict[],
): boolean {
  return plan.blocked.length > 0 || plan.human_review.length > 0 || hasStrongRoutingConflict(conflicts);
}

export function summarizeRoutingEscalation(
  plan: InvocationPlan,
  conflicts: SkillConflict[],
): string[] {
  const warnings: string[] = [];

  if (plan.blocked.length > 0) {
    warnings.push(`Routing blocked: ${plan.blocked.join(", ")}.`);
  }

  if (plan.human_review.length > 0) {
    warnings.push(`Human review required: ${plan.human_review.join(", ")}.`);
  }

  const strongConflicts = conflicts.filter(isStrongRequiredSuppressionConflict);
  if (strongConflicts.length > 0) {
    warnings.push(
      `Required/suppress conflict: ${strongConflicts
        .map((entry) => `${entry.skill} (${describeConflictOutcome(entry)})`)
        .join(", ")}.`,
    );
  }

  return warnings;
}

export async function buildTaskRoutingBundle(
  projectRoot: string,
  config: BrainConfig,
  options: BuildTaskRoutingBundleOptions,
): Promise<TaskRoutingBundle> {
  const task = options.task.trim();
  if (!task) {
    throw new Error('Provide a task with "--task" or stdin before running "brain route".');
  }

  const paths = options.paths ?? [];
  const path_source = options.path_source ?? (paths.length > 0 ? "explicit" : "none");
  const warnings = [...(options.warnings ?? [])];

  const [context_markdown, shortlist] = await Promise.all([
    buildInjection(projectRoot, config, {
      task,
      paths,
      modules: options.modules ?? [],
      ...(options.includeSessionProfile === false ? { includeSessionProfile: false } : {}),
    }),
    buildSkillShortlist(projectRoot, {
      task,
      paths,
      path_source,
      modules: options.modules ?? [],
      ...(options.includeSessionProfile === false ? { includeSessionProfile: false } : {}),
    }),
  ]);

  warnings.push(...summarizeRoutingEscalation(shortlist.invocation_plan, shortlist.conflicts));

  const display_mode: TaskRoutingDisplayMode = shouldEscalateRoutingPlan(
    shortlist.invocation_plan,
    shortlist.conflicts,
  )
    ? "needs-review"
    : "silent-ok";

  return {
    contract_version: TASK_ROUTING_BUNDLE_CONTRACT_VERSION,
    task,
    paths,
    path_source,
    context_markdown,
    skill_plan: shortlist.invocation_plan,
    matched_memories: shortlist.matched_memories,
    resolved_skills: shortlist.resolved_skills,
    conflicts: shortlist.conflicts,
    warnings,
    display_mode,
    ...(shortlist.routing_explanation ? { routing_explanation: shortlist.routing_explanation } : {}),
  };
}

export function renderTaskRoutingBundle(bundle: TaskRoutingBundle): string {
  const lines: string[] = [
    "# RepoBrain Task Routing",
    "",
    `Contract: ${bundle.contract_version}`,
    `Task: ${bundle.task}`,
    `Display mode: ${bundle.display_mode}`,
    `Path source: ${bundle.path_source}`,
    "Paths:",
    ...(bundle.paths.length > 0 ? bundle.paths.map((entry) => `- ${entry}`) : ["- None."]),
  ];

  if (bundle.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    bundle.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  lines.push("");
  lines.push("## Context");
  lines.push(bundle.context_markdown);
  lines.push("");
  lines.push("## Skill Routing");
  lines.push(
    renderSkillShortlist({
      contract_version: "repobrain.skill-plan.v1",
      kind: "repobrain.skill_invocation_plan",
      task: bundle.task,
      paths: bundle.paths,
      path_source: bundle.path_source,
      matched_memories: bundle.matched_memories,
      resolved_skills: bundle.resolved_skills,
      conflicts: bundle.conflicts,
      invocation_plan: bundle.skill_plan,
      matchedMemories: bundle.matched_memories,
      skills: bundle.resolved_skills,
      ...(bundle.routing_explanation ? { routing_explanation: bundle.routing_explanation } : {}),
    }),
  );

  return lines.join("\n");
}

export function renderTaskRoutingBundleJson(bundle: TaskRoutingBundle): string {
  return JSON.stringify(bundle, null, 2);
}

function hasStrongRoutingConflict(conflicts: SkillConflict[]): boolean {
  return conflicts.some(isStrongRequiredSuppressionConflict);
}

function isStrongRequiredSuppressionConflict(conflict: SkillConflict): boolean {
  return conflict.kind === "required_vs_suppressed";
}

function describeConflictOutcome(conflict: SkillConflict): string {
  switch (conflict.strategy_result) {
    case "block":
      return "blocked";
    case "human-review":
      return "needs review";
    case "choose-required":
      return "required kept";
    default:
      return conflict.strategy_result;
  }
}
