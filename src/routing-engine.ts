import { buildInvocationPlan, invocationPlanSlotOrder } from "./invocation-plan-renderer.js";
import type {
  ApplicablePreference,
  PreferencePolicyInput,
  StaticMemoryPolicyInput,
  TaskContextInput,
} from "./routing-inputs.js";
import { ROUTING_PRIORITY_LAYERS } from "./routing-inputs.js";
import type {
  MatchedMemory,
  RequiredSuppressionStrategy,
  ResolvedSkill,
  RoutingExplanation,
  SkillConflict,
  SkillDisposition,
  SkillRelation,
  SkillSuggestionSource,
} from "./skill-routing-types.js";
import type { Importance, InvocationMode, RiskLevel } from "./types.js";

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

interface SkillAggregate {
  skill: string;
  required_score: number;
  recommended_score: number;
  suppressed_score: number;
  sources: SkillSuggestionSource[];
  preference_review_requested: boolean;
}

export interface RoutingEngineResult {
  resolved_skills: ResolvedSkill[];
  conflicts: SkillConflict[];
  routing_explanation: RoutingExplanation;
}

export function runRoutingEngine(
  staticInput: StaticMemoryPolicyInput,
  preferenceInput: PreferencePolicyInput,
  _taskContext: TaskContextInput,
): RoutingEngineResult {
  const aggregates = buildAggregatesFromStaticMemories(staticInput.matched_memories);
  applyPreferenceSignals(aggregates, preferenceInput.applicable);

  const conflicts: SkillConflict[] = [];
  let resolved_skills = Array.from(aggregates.values())
    .map((aggregate) => resolveSkillAggregate(aggregate, conflicts))
    .sort(compareResolvedSkills);

  resolved_skills = resolved_skills.map(applyPreferenceReviewOverride);

  const routing_explanation = buildRoutingExplanation(
    staticInput,
    preferenceInput,
    resolved_skills,
    conflicts,
  );

  return {
    resolved_skills,
    conflicts: conflicts.sort(compareConflicts),
    routing_explanation,
  };
}

function buildAggregatesFromStaticMemories(matchedMemories: MatchedMemory[]): Map<string, SkillAggregate> {
  const suggestions = new Map<string, SkillAggregate>();

  for (const entry of matchedMemories) {
    const memory = entry.record.memory;
    addMemorySkillRelations(suggestions, memory.required_skills ?? [], entry, "required", 6);
    addMemorySkillRelations(suggestions, memory.recommended_skills ?? [], entry, "recommended", 3);
    addMemorySkillRelations(suggestions, memory.suppressed_skills ?? [], entry, "suppressed", 1);
  }

  return suggestions;
}

function addMemorySkillRelations(
  suggestions: Map<string, SkillAggregate>,
  skills: string[],
  entry: MatchedMemory,
  relation: Extract<SkillRelation, "required" | "recommended" | "suppressed">,
  bonus: number,
): void {
  for (const skill of new Set(skills)) {
    const aggregate = getOrCreateAggregate(suggestions, skill);

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

function getOrCreateAggregate(suggestions: Map<string, SkillAggregate>, skill: string): SkillAggregate {
  return (
    suggestions.get(skill) ?? {
      skill,
      required_score: 0,
      recommended_score: 0,
      suppressed_score: 0,
      sources: [],
      preference_review_requested: false,
    }
  );
}

function applyPreferenceSignals(
  aggregates: Map<string, SkillAggregate>,
  applicable: ApplicablePreference[],
): void {
  /** Multiple preferences for the same target: merge by weighted sum (confidence-scaled). */
  const byTarget = new Map<string, ApplicablePreference[]>();
  for (const entry of applicable) {
    const key = entry.preference.target.trim();
    const list = byTarget.get(key) ?? [];
    list.push(entry);
    byTarget.set(key, list);
  }

  for (const [, list] of byTarget) {
    const sorted = [...list].sort((a, b) => b.preference.updated_at.localeCompare(a.preference.updated_at));
    for (const entry of sorted) {
      addPreferenceToAggregate(aggregates, entry);
    }
  }
}

function addPreferenceToAggregate(aggregates: Map<string, SkillAggregate>, entry: ApplicablePreference): void {
  const pref = entry.preference;
  const skill = pref.target.trim();
  const aggregate = getOrCreateAggregate(aggregates, skill);
  const w = 10 * (pref.confidence ?? 0.5);
  const hintNote =
    entry.match_reasons.length > 0
      ? entry.match_reasons.join("; ")
      : "global preference (no task/path hints)";

  switch (pref.preference) {
    case "prefer":
      aggregate.recommended_score += w;
      aggregate.sources.push({
        memory_title: `Preference → ${skill}`,
        relative_path: `.brain/preferences (${hintNote})`,
        relation: "preference_prefer",
        invocation_mode: "prefer",
        risk_level: "low",
        importance: "medium",
        match_score: w,
      });
      break;
    case "avoid":
      aggregate.suppressed_score += w;
      aggregate.sources.push({
        memory_title: `Preference → ${skill}`,
        relative_path: `.brain/preferences (${hintNote})`,
        relation: "preference_avoid",
        invocation_mode: "optional",
        risk_level: "low",
        importance: "medium",
        match_score: w,
      });
      break;
    case "require_review":
      aggregate.preference_review_requested = true;
      aggregate.recommended_score += 0.5;
      aggregate.sources.push({
        memory_title: `Preference → ${skill}`,
        relative_path: `.brain/preferences (${hintNote})`,
        relation: "preference_review",
        invocation_mode: "optional",
        risk_level: "low",
        importance: "medium",
        match_score: 0.5,
      });
      break;
    default:
      break;
  }

  aggregates.set(skill, aggregate);
}

function resolveSkillAggregate(aggregate: SkillAggregate, conflicts: SkillConflict[]): ResolvedSkill {
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

function applyPreferenceReviewOverride(skill: ResolvedSkill): ResolvedSkill {
  if (skill.plan_slot !== "prefer_first" && skill.plan_slot !== "optional_fallback") {
    return skill;
  }
  const hasRequired = skill.sources.some((s) => s.relation === "required");
  if (hasRequired) {
    return skill;
  }
  const wantsReview = skill.sources.some((s) => s.relation === "preference_review");
  if (!wantsReview) {
    return skill;
  }
  return {
    ...skill,
    plan_slot: "human_review",
    disposition: "recommended",
  };
}

function resolveRequiredSuppressionStrategy(aggregate: SkillAggregate): RequiredSuppressionStrategy {
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
  const hasPrefAvoid = aggregate.sources.some((s) => s.relation === "preference_avoid");

  if (strategy === "block") {
    return [
      `Required score ${aggregate.required_score} is not stronger than suppressed score ${aggregate.suppressed_score}.`,
      "At least one suppressing memory is marked high risk, so the local rule blocks automatic invocation.",
    ].join(" ");
  }

  if (strategy === "choose-required") {
    const prefNote = hasPrefAvoid
      ? " Static required skill outranks preference.avoid per routing policy order."
      : "";
    return [
      `Required score ${aggregate.required_score} exceeds suppressed score ${aggregate.suppressed_score} by at least 5.`,
      `No suppressing memory is marked high risk, so the local rule keeps the required skill.${prefNote}`,
    ].join(" ");
  }

  return [
    `Required score ${aggregate.required_score} and suppressed score ${aggregate.suppressed_score} are too close for an automatic decision.`,
    hasHighRiskSuppression
      ? "A high-risk suppressing memory is present, so the local rule escalates to human review."
      : hasPrefAvoid
        ? "Preference avoid competes with static required; scores are ambiguous, so the conflict is sent to human review."
        : "No deterministic winner exists under the local routing rules, so the conflict is sent to human review.",
  ].join(" ");
}

function describeRecommendedSuppressionReason(aggregate: SkillAggregate): string {
  const hasPrefPrefer = aggregate.sources.some((s) => s.relation === "preference_prefer");
  const memSuppress = aggregate.sources.some((s) => s.relation === "suppressed");

  if (hasPrefPrefer && memSuppress) {
    return [
      `Recommended score ${aggregate.recommended_score} (including preference.prefer) conflicts with suppressed score ${aggregate.suppressed_score} from static memory.`,
      "Static suppress outranks positive preference when both apply to the same skill.",
    ].join(" ");
  }

  return [
    `Recommended score ${aggregate.recommended_score} conflicts with suppressed score ${aggregate.suppressed_score}.`,
    "RepoBrain keeps the suppression in the final plan because recommendations are advisory while suppressions are explicit do-not-invoke hints.",
  ].join(" ");
}

function resolveRecommendedPlanSlot(
  sources: SkillSuggestionSource[],
): "prefer_first" | "optional_fallback" {
  const recommendedSources = sources.filter(
    (source) => source.relation === "recommended" || source.relation === "preference_prefer",
  );
  const hasPreferFirstSource = recommendedSources.some(
    (source) =>
      source.relation === "preference_prefer" ||
      source.invocation_mode === "required" ||
      source.invocation_mode === "prefer",
  );

  return hasPreferFirstSource ? "prefer_first" : "optional_fallback";
}

function compareResolvedSkills(left: ResolvedSkill, right: ResolvedSkill): number {
  const dispositionDifference = DISPOSITION_PRIORITY[left.disposition] - DISPOSITION_PRIORITY[right.disposition];
  if (dispositionDifference !== 0) {
    return dispositionDifference;
  }

  const planDifference =
    invocationPlanSlotOrder(left.plan_slot as any) - invocationPlanSlotOrder(right.plan_slot as any);
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

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function buildRoutingExplanation(
  staticInput: StaticMemoryPolicyInput,
  preferenceInput: PreferencePolicyInput,
  resolved: ResolvedSkill[],
  conflicts: SkillConflict[],
): RoutingExplanation {
  const skill_evidence: Record<string, string[]> = {};
  const notes: string[] = [
    `Policy layers (highest precedence first): ${ROUTING_PRIORITY_LAYERS.join(" → ")}`,
  ];

  for (const skipped of preferenceInput.skipped) {
    notes.push(
      `Skipped preference for ${skipped.preference.target} (${skipped.preference.preference}): ${skipped.reason}`,
    );
  }

  for (const skill of resolved) {
    const lines: string[] = [];
    lines.push(`plan_slot=${skill.plan_slot}, disposition=${skill.disposition}, total_score=${skill.score}`);
    for (const src of skill.sources) {
      lines.push(
        `${src.relation}: ${src.memory_title} [${src.relative_path}] (invocation_mode=${src.invocation_mode}, risk=${src.risk_level}, match_weight=${src.match_score})`,
      );
    }
    skill_evidence[skill.skill] = lines;
  }

  for (const c of conflicts) {
    const extra = skill_evidence[c.skill] ?? [];
    extra.push(`conflict: ${c.kind} → ${c.strategy_result}: ${c.reason}`);
    skill_evidence[c.skill] = extra;
  }

  if (staticInput.matched_memories.length === 0) {
    notes.push("No durable memories matched task/path triggers; any skills below come from preferences only.");
  }

  return {
    priority_order: ROUTING_PRIORITY_LAYERS,
    skill_evidence,
    notes,
  };
}
