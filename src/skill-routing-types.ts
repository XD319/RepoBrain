import type { Importance, InvocationMode, RiskLevel, StoredMemoryRecord } from "./types.js";

export type PathSource = "explicit" | "git_diff" | "none";

export interface SuggestSkillsOptions {
  task?: string;
  paths?: string[];
  path_source?: PathSource;
  /** Optional module names from inject / route for future scoring; included in task context. */
  modules?: string[];
  /** When false, skip `.brain/runtime/session-profile.json` for routing. Default: true. */
  includeSessionProfile?: boolean;
}

export const SUGGEST_SKILLS_CONTRACT_VERSION = "repobrain.skill-plan.v1";
export const SUGGEST_SKILLS_CONTRACT_KIND = "repobrain.skill_invocation_plan";

export interface MatchedMemory {
  record: StoredMemoryRecord;
  reasons: string[];
  score: number;
}

export type SkillRelation =
  | "required"
  | "recommended"
  | "suppressed"
  | "preference_prefer"
  | "preference_avoid"
  | "preference_review"
  | "session_prefer"
  | "session_avoid"
  | "session_review";

export interface SkillSuggestionSource {
  memory_title: string;
  relative_path: string;
  relation: SkillRelation;
  invocation_mode: InvocationMode;
  risk_level: RiskLevel;
  importance: Importance;
  match_score: number;
}

export type SkillDisposition = "required" | "recommended" | "suppressed" | "conflicted";
export type SkillConflictKind = "required_vs_suppressed" | "recommended_vs_suppressed";
export type RequiredSuppressionStrategy = "block" | "human-review" | "choose-required";
export type InvocationPlanSlot =
  | "required"
  | "prefer_first"
  | "optional_fallback"
  | "suppress"
  | "blocked"
  | "human_review";

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

/** Machine-readable trace for adapters; optional on the wire for backward compatibility. */
export interface RoutingExplanation {
  /** Ordered policy layers applied by the engine (highest precedence first). */
  priority_order: readonly string[];
  /** Per-skill evidence lines (why prefer / suppress / blocked / ignored preference, etc.). */
  skill_evidence: Record<string, string[]>;
  /** Cross-cutting notes (e.g. stale preferences skipped). */
  notes: string[];
}

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
  routing_explanation?: RoutingExplanation;
}
