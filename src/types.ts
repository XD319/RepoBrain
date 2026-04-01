export const MEMORY_TYPES = ["decision", "gotcha", "convention", "pattern"] as const;
export const IMPORTANCE_LEVELS = ["high", "medium", "low"] as const;
export const MEMORY_SOURCES = ["session", "git-commit", "manual", "pr"] as const;
export const MEMORY_STATUSES = ["active", "candidate", "stale", "superseded"] as const;
export const EXTRACT_MODES = ["manual", "suggest", "auto"] as const;
export const INVOCATION_MODES = ["required", "prefer", "optional", "suppress"] as const;
export const RISK_LEVELS = ["high", "medium", "low"] as const;
export const MEMORY_REVIEW_DECISIONS = ["accept", "merge", "supersede", "reject"] as const;
export const MEMORY_REVIEW_REASONS = [
  "novel_memory",
  "same_scope_summary_overlap",
  "newer_memory_replaces_older",
  "duplicate",
  "temporary_detail",
  "insufficient_signal",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type Importance = (typeof IMPORTANCE_LEVELS)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type ExtractMode = (typeof EXTRACT_MODES)[number];
export type InvocationMode = (typeof INVOCATION_MODES)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type MemoryReviewDecision = (typeof MEMORY_REVIEW_DECISIONS)[number];
export type MemoryReviewReason = (typeof MEMORY_REVIEW_REASONS)[number];

export interface Memory {
  type: MemoryType;
  title: string;
  summary: string;
  detail: string;
  tags: string[];
  importance: Importance;
  date: string;
  source?: MemorySource;
  status?: MemoryStatus;
  path_scope?: string[];
  recommended_skills?: string[];
  required_skills?: string[];
  suppressed_skills?: string[];
  skill_trigger_paths?: string[];
  skill_trigger_tasks?: string[];
  invocation_mode?: InvocationMode;
  risk_level?: RiskLevel;
}

export interface BrainConfig {
  maxInjectTokens: number;
  extractMode: ExtractMode;
  language: string;
}

export interface ExtractedMemoriesPayload {
  memories: Memory[];
}

export interface MemoryActivityEntry {
  type: MemoryType;
  title: string;
  importance: Importance;
  date: string;
}

export interface BrainActivityState {
  lastInjectedAt?: string;
  recentLoadedMemories: MemoryActivityEntry[];
}

export interface StoredMemoryRecord {
  filePath: string;
  relativePath: string;
  memory: Memory;
}

export interface CandidateMemoryReviewResult {
  decision: MemoryReviewDecision;
  target_memory_ids: string[];
  reason: MemoryReviewReason;
}

export interface MemoryReviewMatch {
  target_memory_id: string;
  target_status: MemoryStatus;
  target_updated_at: string;
  title_similarity: number;
  summary_similarity: number;
  same_scope: boolean;
  overlapping_scope: boolean;
  same_identity: boolean;
  candidate_is_newer: boolean;
  replacement_signal: boolean;
}

export interface MemoryReviewContext {
  memory: Memory;
  comparable_matches: MemoryReviewMatch[];
}

export interface ReviewedMemoryCandidate {
  memory: Memory;
  review: CandidateMemoryReviewResult;
}

export interface MemoryReviewer {
  reviewCandidate(memory: Memory, existingRecords: StoredMemoryRecord[]): CandidateMemoryReviewResult;
}
