import {
  buildMemoryIdentity,
  normalizeTextForComparison,
  scopesOverlap,
} from "./memory-identity.js";
import type {
  CandidateMemoryReviewResult,
  Memory,
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

const TEMPORARY_DETAIL_PATTERN =
  /\b(?:temporary|temp|for now|one-off|one off|until release|today only|debug only|wip|todo)\b|\u4e34\u65f6|\u6682\u65f6|\u4e00\u6b21\u6027|\u4ec5\u7528\u4e8e\u8c03\u8bd5/u;
const REPLACEMENT_SIGNAL_PATTERN =
  /\b(?:replace|replaced|supersede|superseded|deprecate|deprecated|obsolete|instead of|no longer|migrate to|switch to)\b|\u6539\u4e3a|\u66ff\u6362|\u5e9f\u5f03|\u4e0d\u518d\u4f7f\u7528|\u8fc1\u79fb\u5230/u;

export function createDeterministicMemoryReviewer(): MemoryReviewer {
  return {
    reviewCandidate(memory, existingRecords) {
      return reviewCandidateMemory(memory, existingRecords);
    },
  };
}

export function reviewCandidateMemory(
  memory: Memory,
  existingRecords: StoredMemoryRecord[],
): CandidateMemoryReviewResult {
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

  const comparable = existingRecords
    .filter((entry) => entry.memory.type === memory.type)
    .map((entry) => buildComparison(memory, entry))
    .filter((entry) => entry.isComparable)
    .sort(compareComparisons);

  const duplicateMatches = comparable.filter((entry) => entry.isDuplicate);
  if (duplicateMatches.length > 0) {
    return {
      decision: "reject",
      target_memory_ids: duplicateMatches.map((entry) => entry.targetId),
      reason: "duplicate",
    };
  }

  const supersedeTarget = comparable.find((entry) => entry.isSupersedeCandidate);
  if (supersedeTarget) {
    return {
      decision: "supersede",
      target_memory_ids: [supersedeTarget.targetId],
      reason: "newer_memory_replaces_older",
    };
  }

  const mergeTarget = comparable.find((entry) => entry.isMergeCandidate);
  if (mergeTarget) {
    return {
      decision: "merge",
      target_memory_ids: [mergeTarget.targetId],
      reason: "same_scope_summary_overlap",
    };
  }

  return {
    decision: "accept",
    target_memory_ids: [],
    reason: "novel_memory",
  };
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

function buildComparison(memory: Memory, entry: StoredMemoryRecord) {
  const targetStatus = getMemoryStatus(entry.memory);
  const sameScope = scopesOverlap(memory.path_scope ?? [], entry.memory.path_scope ?? []);
  const titleSimilarity = getTextSimilarity(memory.title, entry.memory.title);
  const summarySimilarity = getTextSimilarity(memory.summary, entry.memory.summary);
  const candidateDate = Date.parse(memory.date);
  const targetDate = Date.parse(entry.memory.date);
  const candidateIsNewer =
    Number.isFinite(candidateDate) && Number.isFinite(targetDate)
      ? candidateDate >= targetDate
      : memory.date.localeCompare(entry.memory.date) >= 0;
  const replacementSignal = hasReplacementSignal(memory);
  const sameIdentity = buildMemoryIdentity(memory) === buildMemoryIdentity(entry.memory);
  const isComparable = sameScope && (titleSimilarity >= MERGE_TITLE_THRESHOLD || sameIdentity);
  const statusWeight = getStatusWeight(targetStatus);
  const recencyWeight = Number.isFinite(targetDate) ? targetDate : Date.parse("1970-01-01T00:00:00.000Z");

  return {
    entry,
    targetId: getStoredMemoryId(entry),
    targetStatus,
    isComparable,
    titleSimilarity,
    summarySimilarity,
    statusWeight,
    recencyWeight,
    isDuplicate:
      (targetStatus === "active" || targetStatus === "candidate") &&
      sameScope &&
      sameIdentity &&
      titleSimilarity >= DUPLICATE_TITLE_THRESHOLD &&
      summarySimilarity >= DUPLICATE_SUMMARY_THRESHOLD,
    isSupersedeCandidate:
      targetStatus === "active" &&
      sameScope &&
      sameIdentity &&
      candidateIsNewer &&
      replacementSignal &&
      titleSimilarity >= SUPERSEDE_TITLE_THRESHOLD &&
      summarySimilarity >= SUPERSEDE_SUMMARY_THRESHOLD,
    isMergeCandidate:
      (targetStatus === "active" || targetStatus === "candidate") &&
      sameScope &&
      !replacementSignal &&
      titleSimilarity >= MERGE_TITLE_THRESHOLD &&
      summarySimilarity >= MERGE_SUMMARY_THRESHOLD,
  };
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

function compareComparisons(
  left: ReturnType<typeof buildComparison>,
  right: ReturnType<typeof buildComparison>,
): number {
  if (right.statusWeight !== left.statusWeight) {
    return right.statusWeight - left.statusWeight;
  }

  if (right.titleSimilarity !== left.titleSimilarity) {
    return right.titleSimilarity - left.titleSimilarity;
  }

  if (right.summarySimilarity !== left.summarySimilarity) {
    return right.summarySimilarity - left.summarySimilarity;
  }

  return right.recencyWeight - left.recencyWeight;
}
