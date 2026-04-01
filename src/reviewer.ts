import {
  buildMemoryIdentity,
  buildScopeIdentity,
  normalizeTextForComparison,
  scopesOverlap,
} from "./memory-identity.js";
import type {
  CandidateMemoryReviewResult,
  Memory,
  MemoryReviewContext,
  MemoryReviewMatch,
  MemoryReviewer,
  MemoryStatus,
  ReviewedMemoryCandidate,
  StoredMemoryRecord,
} from "./types.js";

const DUPLICATE_TITLE_THRESHOLD = 0.96;
const DUPLICATE_SUMMARY_THRESHOLD = 0.92;
const MERGE_TITLE_THRESHOLD = 0.72;
const MERGE_SUMMARY_THRESHOLD = 0.45;
const SUPERSEDE_TITLE_THRESHOLD = 0.9;
const SUPERSEDE_SUMMARY_THRESHOLD = 0.28;
const REVIEW_CONTEXT_TITLE_THRESHOLD = 0.58;

const TEMPORARY_DETAIL_PATTERN =
  /\b(?:temporary|temp|for now|one-off|one off|until release|today only|debug only|wip|todo)\b|\u4e34\u65f6|\u6682\u65f6|\u4e00\u6b21\u6027|\u4ec5\u7528\u4e8e\u8c03\u8bd5/u;
const REPLACEMENT_SIGNAL_PATTERN =
  /\b(?:replace|replaced|supersede|superseded|deprecate|deprecated|obsolete|instead of|no longer|migrate to|switch to)\b|\u6539\u4e3a|\u66ff\u6362|\u5e9f\u5f03|\u4e0d\u518d\u4f7f\u7528|\u8fc1\u79fb\u5230/u;

export function createDeterministicMemoryReviewer(): MemoryReviewer {
  return {
    reviewCandidate(memory, existingRecords) {
      return decideCandidateMemoryReview(buildMemoryReviewContext(memory, existingRecords));
    },
  };
}

export function buildMemoryReviewContext(
  memory: Memory,
  existingRecords: StoredMemoryRecord[],
): MemoryReviewContext {
  const comparableMatches = existingRecords
    .filter((entry) => entry.memory.type === memory.type)
    .map((entry) => buildReviewMatch(memory, entry))
    .filter((entry): entry is MemoryReviewMatch => entry !== null)
    .sort(compareReviewMatches);

  return {
    memory,
    comparable_matches: comparableMatches,
  };
}

export function reviewCandidateMemory(
  memory: Memory,
  existingRecords: StoredMemoryRecord[],
): CandidateMemoryReviewResult {
  return decideCandidateMemoryReview(buildMemoryReviewContext(memory, existingRecords));
}

export function reviewCandidateMemories(
  memories: Memory[],
  existingRecords: StoredMemoryRecord[],
  reviewer: MemoryReviewer = createDeterministicMemoryReviewer(),
): ReviewedMemoryCandidate[] {
  return memories.map((memory) => ({
    memory,
    review: reviewer.reviewCandidate(memory, existingRecords),
  }));
}

export function decideCandidateMemoryReview(context: MemoryReviewContext): CandidateMemoryReviewResult {
  const { memory, comparable_matches: comparableMatches } = context;

  if (hasInsufficientSignal(memory)) {
    return {
      decision: "reject",
      target_memory_ids: [],
      reason: "insufficient_signal",
    };
  }

  if (looksTemporary(memory)) {
    return {
      decision: "reject",
      target_memory_ids: [],
      reason: "temporary_detail",
    };
  }

  const duplicateMatches = comparableMatches.filter(isDuplicateMatch);
  if (duplicateMatches.length > 0) {
    return {
      decision: "reject",
      target_memory_ids: duplicateMatches.map((entry) => entry.target_memory_id),
      reason: "duplicate",
    };
  }

  const supersedeTarget = comparableMatches.find(isSupersedeMatch);
  if (supersedeTarget) {
    return {
      decision: "supersede",
      target_memory_ids: [supersedeTarget.target_memory_id],
      reason: "newer_memory_replaces_older",
    };
  }

  const mergeTarget = comparableMatches.find(isMergeMatch);
  if (mergeTarget) {
    return {
      decision: "merge",
      target_memory_ids: [mergeTarget.target_memory_id],
      reason: "same_scope_summary_overlap",
    };
  }

  return {
    decision: "accept",
    target_memory_ids: [],
    reason: "novel_memory",
  };
}

function buildReviewMatch(memory: Memory, entry: StoredMemoryRecord): MemoryReviewMatch | null {
  const targetStatus = getMemoryStatus(entry.memory);
  if (targetStatus === "stale" || targetStatus === "superseded") {
    return null;
  }

  const sameScope = hasSameScopeIdentity(memory, entry.memory);
  const overlappingScope = scopesOverlap(memory.path_scope ?? [], entry.memory.path_scope ?? []);
  const titleSimilarity = getTextSimilarity(memory.title, entry.memory.title);
  const summarySimilarity = getTextSimilarity(memory.summary, entry.memory.summary);

  if (!sameScope && !(overlappingScope && titleSimilarity >= REVIEW_CONTEXT_TITLE_THRESHOLD)) {
    return null;
  }

  return {
    target_memory_id: getStoredMemoryId(entry),
    target_status: targetStatus,
    target_updated_at: entry.memory.date,
    title_similarity: titleSimilarity,
    summary_similarity: summarySimilarity,
    same_scope: sameScope,
    overlapping_scope: overlappingScope,
    same_identity: buildMemoryIdentity(memory) === buildMemoryIdentity(entry.memory),
    candidate_is_newer: isCandidateNewer(memory, entry.memory),
    replacement_signal: hasReplacementSignal(memory),
  };
}

function isDuplicateMatch(match: MemoryReviewMatch): boolean {
  return (
    (match.target_status === "active" || match.target_status === "candidate") &&
    match.same_identity &&
    match.title_similarity >= DUPLICATE_TITLE_THRESHOLD &&
    match.summary_similarity >= DUPLICATE_SUMMARY_THRESHOLD
  );
}

function isSupersedeMatch(match: MemoryReviewMatch): boolean {
  return (
    match.target_status === "active" &&
    match.same_scope &&
    match.same_identity &&
    match.candidate_is_newer &&
    match.replacement_signal &&
    match.title_similarity >= SUPERSEDE_TITLE_THRESHOLD &&
    match.summary_similarity >= SUPERSEDE_SUMMARY_THRESHOLD
  );
}

function isMergeMatch(match: MemoryReviewMatch): boolean {
  return (
    (match.target_status === "active" || match.target_status === "candidate") &&
    match.same_scope &&
    !match.replacement_signal &&
    match.title_similarity >= MERGE_TITLE_THRESHOLD &&
    match.summary_similarity >= MERGE_SUMMARY_THRESHOLD
  );
}

function hasInsufficientSignal(memory: Memory): boolean {
  const normalizedTitle = normalizeTextForComparison(memory.title);
  const normalizedSummary = normalizeTextForComparison(memory.summary);
  const normalizedDetail = normalizeTextForComparison(memory.detail);
  const combinedTokens = new Set(
    `${normalizedTitle} ${normalizedSummary} ${normalizedDetail}`
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean),
  );

  return combinedTokens.size < 8 || normalizedSummary.length < 18 || normalizedDetail.length < 48;
}

function looksTemporary(memory: Memory): boolean {
  return TEMPORARY_DETAIL_PATTERN.test(`${memory.title}\n${memory.summary}\n${memory.detail}`);
}

function hasReplacementSignal(memory: Memory): boolean {
  return REPLACEMENT_SIGNAL_PATTERN.test(`${memory.title}\n${memory.summary}\n${memory.detail}`);
}

function isCandidateNewer(memory: Memory, target: Memory): boolean {
  const candidateDate = Date.parse(memory.date);
  const targetDate = Date.parse(target.date);

  if (Number.isFinite(candidateDate) && Number.isFinite(targetDate)) {
    return candidateDate >= targetDate;
  }

  return memory.date.localeCompare(target.date) >= 0;
}

function hasSameScopeIdentity(left: Pick<Memory, "path_scope">, right: Pick<Memory, "path_scope">): boolean {
  return buildScopeIdentity(left.path_scope ?? []) === buildScopeIdentity(right.path_scope ?? []);
}

function getTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeTextForComparison(left);
  const normalizedRight = normalizeTextForComparison(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const tokenScore = getJaccardSimilarity(tokenize(normalizedLeft), tokenize(normalizedRight));
  const bigramScore = getDiceCoefficient(getBigrams(normalizedLeft), getBigrams(normalizedRight));
  return Math.max(tokenScore, bigramScore);
}

function tokenize(value: string): string[] {
  return value.split(" ").map((token) => token.trim()).filter(Boolean);
}

function getBigrams(value: string): string[] {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 2) {
    return compact ? [compact] : [];
  }

  const bigrams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.push(compact.slice(index, index + 2));
  }

  return bigrams;
}

function getJaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function getDiceCoefficient(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const token of right) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const token of left) {
    const count = rightCounts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(token, count - 1);
    }
  }

  return (2 * overlap) / (left.length + right.length);
}

function getMemoryStatus(memory: Memory): MemoryStatus {
  return memory.status ?? "active";
}

function getStoredMemoryId(entry: StoredMemoryRecord): string {
  return pathlessBaseName(entry.filePath);
}

function pathlessBaseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return fileName.replace(/\.md$/i, "");
}

function getStatusWeight(status: MemoryStatus): number {
  switch (status) {
    case "active":
      return 3;
    case "candidate":
      return 2;
    case "stale":
      return 1;
    case "superseded":
      return 0;
  }
}

function compareReviewMatches(left: MemoryReviewMatch, right: MemoryReviewMatch): number {
  if (right.same_scope !== left.same_scope) {
    return Number(right.same_scope) - Number(left.same_scope);
  }

  if (right.target_status !== left.target_status) {
    return getStatusWeight(right.target_status) - getStatusWeight(left.target_status);
  }

  if (right.title_similarity !== left.title_similarity) {
    return right.title_similarity - left.title_similarity;
  }

  if (right.summary_similarity !== left.summary_similarity) {
    return right.summary_similarity - left.summary_similarity;
  }

  if (right.target_updated_at !== left.target_updated_at) {
    return right.target_updated_at.localeCompare(left.target_updated_at);
  }

  return Number(right.candidate_is_newer) - Number(left.candidate_is_newer);
}
