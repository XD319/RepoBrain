import {
  buildScopeIdentity,
  normalizeTextForComparison,
  scopesOverlap,
  slugifyMemoryTitle,
} from "./memory-identity.js";
import type {
  CandidateMemoryReviewExplanation,
  CandidateMemoryReviewResult,
  ExternalReviewSuggestion,
  Memory,
  MemoryReviewContext,
  MemoryReviewDecision,
  MemoryReviewEvidenceBucket,
  MemoryReviewEvidenceItem,
  MemoryReviewEvidenceVector,
  MemoryReviewMatch,
  MemoryReviewReason,
  MemoryReviewRelation,
  MemoryReviewer,
  MemoryScopeRelation,
  MemoryStatus,
  ReviewCandidateMemoriesOptions,
  ReviewedMemoryCandidate,
  StoredMemoryRecord,
  ValidatedExternalReviewInput,
} from "./types.js";
import { MEMORY_REVIEW_DECISIONS } from "./types.js";

const REVIEW_CONTEXT_TITLE_THRESHOLD = 0.58;
const REVIEW_CONTEXT_CONTENT_THRESHOLD = 0.36;
const SAME_IDENTITY_THRESHOLD = 0.58;
const MODERATE_OVERLAP_THRESHOLD = 0.44;
const AMBIGUOUS_MATCH_THRESHOLD = 0.25;

const TEMPORARY_DETAIL_PATTERN =
  /\b(?:temporary|temp|for now|one-off|one off|until release|today only|debug only|wip|todo)\b|\u4e34\u65f6|\u6682\u65f6|\u4e00\u6b21\u6027|\u4ec5\u7528\u4e8e\u8c03\u8bd5/u;
const REPLACEMENT_SIGNAL_PATTERN =
  /\b(?:replace|replaced|supersede|superseded|deprecate|deprecated|obsolete|instead of|no longer|migrate to|switch to)\b|\u6539\u4e3a|\u66ff\u6362|\u5e9f\u5f03|\u4e0d\u518d\u4f7f\u7528|\u8fc1\u79fb\u5230/u;
const ADDITIVE_SIGNAL_PATTERN =
  /\b(?:also|extend|extends|additional|broaden|broader|cover|covers|include|includes|in addition|applies to|along with|another case)\b|\u8865\u5145|\u6269\u5c55|\u53e6\u5916|\u540c\u65f6|\u4e5f\u8981|\u4e5f\u9002\u7528/u;
const PARTIAL_UPDATE_PATTERN =
  /\b(?:partial|specific|only for|for .* only|subset|subpath|one branch|one module|one case|except)\b|\u90e8\u5206|\u53ea\u9488\u5bf9|\u5b50\u96c6|\u67d0\u4e2a\u6a21\u5757|\u4f8b\u5916/u;
const SPLIT_SIGNAL_PATTERN =
  /\b(?:split|separate|separately|two memories|multiple memories|different cases|one for .* and one for)\b|\u62c6\u5206|\u5206\u5f00|\u591a\u6761|\u4e24\u6761/u;

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
  externalReviewInput?: unknown,
): MemoryReviewContext {
  const validatedExternalReviewInput = parseExternalReviewInput(externalReviewInput);
  const comparableMatches = existingRecords
    .filter((entry) => entry.memory.type === memory.type)
    .map((entry) => buildReviewMatch(memory, entry))
    .filter((entry): entry is MemoryReviewMatch => entry !== null)
    .sort(compareReviewMatches);

  return {
    memory,
    comparable_matches: comparableMatches,
    ...(validatedExternalReviewInput ? { external_review_input: validatedExternalReviewInput } : {}),
  };
}

export function reviewCandidateMemory(
  memory: Memory,
  existingRecords: StoredMemoryRecord[],
  externalReviewInput?: unknown,
): CandidateMemoryReviewResult {
  return decideCandidateMemoryReview(buildMemoryReviewContext(memory, existingRecords, externalReviewInput));
}

export function reviewCandidateMemories(
  memories: Memory[],
  existingRecords: StoredMemoryRecord[],
  legacyReviewerOrOptions?: MemoryReviewer | ReviewCandidateMemoriesOptions,
): ReviewedMemoryCandidate[] {
  const options = normalizeReviewCandidateMemoriesOptions(legacyReviewerOrOptions);

  return memories.map((memory) => ({
    memory,
    review: reviewCandidateMemory(
      memory,
      existingRecords,
      options.resolveExternalReviewInput?.(memory, existingRecords),
    ),
  }));
}

export function explainCandidateMemoryReview(
  memory: Memory,
  existingRecords: StoredMemoryRecord[],
  externalReviewInput?: unknown,
): { review: CandidateMemoryReviewResult; context: MemoryReviewContext; text: string } {
  const context = buildMemoryReviewContext(memory, existingRecords, externalReviewInput);
  const review = decideCandidateMemoryReview(context);
  return {
    review,
    context,
    text: renderCandidateMemoryReviewExplanation(review, context),
  };
}

export function renderCandidateMemoryReviewExplanation(
  review: CandidateMemoryReviewResult,
  context: MemoryReviewContext,
): string {
  const lines = [
    `decision=${review.decision} confidence=${formatConfidence(review.confidence)} relation=${review.internal_relation ?? "none"} reason=${review.reason}`,
    `summary=${review.explanation?.summary ?? "No review explanation available."}`,
  ];

  if (context.comparable_matches.length === 0) {
    lines.push("matches=none");
    return lines.join("\n");
  }

  lines.push("matches:");
  for (const match of context.comparable_matches.slice(0, 5)) {
    lines.push(
      `- ${match.target_memory_id} relation=${match.relation} confidence=${formatConfidence(match.confidence)} scope=${match.scope_relation} identity=${match.same_identity ? "yes" : "no"} overlap(title=${match.title_similarity.toFixed(2)} summary=${match.summary_similarity.toFixed(2)} detail=${match.detail_similarity.toFixed(2)})`,
    );
    lines.push(`  ${match.explain_summary}`);
    lines.push(`  evidence identity=${formatEvidenceBucket(match.evidence.identity)}`);
    lines.push(`  evidence scope=${formatEvidenceBucket(match.evidence.scope)}`);
    lines.push(`  evidence overlap=${formatEvidenceBucket(match.evidence.title_summary_detail_overlap)}`);
    lines.push(`  evidence replacement=${formatEvidenceBucket(match.evidence.replacement_wording)}`);
    lines.push(`  evidence recency=${formatEvidenceBucket(match.evidence.recency)}`);
    lines.push(`  evidence status_lineage=${formatEvidenceBucket(match.evidence.status_lineage)}`);
  }

  return lines.join("\n");
}

export function decideCandidateMemoryReview(context: MemoryReviewContext): CandidateMemoryReviewResult {
  const { memory, comparable_matches: comparableMatches } = context;

  if (hasInsufficientSignal(memory)) {
    return finalizeReview("reject", [], "insufficient_signal", null, 0.98, context, "Candidate is too thin to preserve as durable repo memory.");
  }

  if (looksTemporary(memory)) {
    return finalizeReview("reject", [], "temporary_detail", null, 0.97, context, "Candidate looks temporary or debugging-only, so it should not become durable memory.");
  }

  const duplicateMatches = comparableMatches.filter((match) => match.relation === "duplicate" && match.confidence >= 0.74);
  if (duplicateMatches.length > 0) {
    const winningTargets = duplicateMatches.map((entry) => entry.target_memory_id);
    const confidence = Math.max(...duplicateMatches.map((entry) => entry.confidence));
    return finalizeReview(
      "merge",
      winningTargets,
      "duplicate_memory",
      "duplicate",
      confidence,
      context,
      `Matched ${winningTargets.length} existing memor${winningTargets.length === 1 ? "y" : "ies"} as the same durable fact with same-scope high-overlap evidence.`,
    );
  }

  const replacementMatches = comparableMatches.filter((match) => match.relation === "full_replacement" && match.confidence >= 0.56);
  const bestReplacement = replacementMatches[0];
  if (bestReplacement && !hasCompetingMatch(bestReplacement, replacementMatches)) {
    return finalizeReview(
      "supersede",
      [bestReplacement.target_memory_id],
      "newer_memory_replaces_older",
      "full_replacement",
      bestReplacement.confidence,
      context,
      `Candidate is newer, points to the same identity and scope, and contains explicit replacement wording for ${bestReplacement.target_memory_id}.`,
    );
  }

  const additiveMatches = comparableMatches.filter((match) => match.relation === "additive_update" && match.confidence >= 0.58);
  const bestAdditive = additiveMatches[0];
  if (bestAdditive && !hasCompetingMatch(bestAdditive, additiveMatches) && !hasAmbiguousConflict(bestAdditive, comparableMatches)) {
    return finalizeReview(
      "merge",
      [bestAdditive.target_memory_id],
      "same_scope_summary_overlap",
      "additive_update",
      bestAdditive.confidence,
      context,
      `Candidate extends the same scope and identity as ${bestAdditive.target_memory_id} without strong replacement wording, so it should be merged as an additive update.`,
    );
  }

  const splitMatches = comparableMatches.filter((match) => match.relation === "possible_split" && match.confidence >= 0.28);
  if (splitMatches.length > 0) {
    return finalizeReview(
      "reject",
      splitMatches.map((entry) => entry.target_memory_id),
      "possible_scope_split",
      "possible_split",
      Math.max(...splitMatches.map((entry) => entry.confidence)),
      context,
      "Candidate overlaps an existing memory but looks like a narrower partial update or split case, so Core keeps it out of automatic merge/supersede.",
    );
  }

  const ambiguousMatches = comparableMatches.filter((match) => match.confidence >= AMBIGUOUS_MATCH_THRESHOLD);
  if (ambiguousMatches.length > 1 && hasMultiTargetConflict(ambiguousMatches)) {
    return finalizeReview(
      "reject",
      ambiguousMatches.map((entry) => entry.target_memory_id),
      "ambiguous_existing_overlap",
      "ambiguous_overlap",
      ambiguousMatches[0]?.confidence ?? 0.6,
      context,
      "Candidate overlaps multiple existing memories with no single deterministic target, so Core rejects automatic relationship changes.",
    );
  }

  return finalizeReview(
    "accept",
    [],
    "novel_memory",
    null,
    comparableMatches[0]?.confidence ? clamp(1 - comparableMatches[0].confidence / 2, 0.55, 0.92) : 0.84,
    context,
    comparableMatches.length === 0
      ? "No comparable active memories passed the scope and evidence checks, so this candidate stays novel."
      : "Comparable memories exist, but none had enough aligned identity, scope, and evidence to justify merge or supersede.",
  );
}

function buildReviewMatch(memory: Memory, entry: StoredMemoryRecord): MemoryReviewMatch | null {
  const targetStatus = getMemoryStatus(entry.memory);
  if (targetStatus === "stale" || targetStatus === "superseded") {
    return null;
  }

  const sameScope = hasSameScopeIdentity(memory, entry.memory);
  const overlappingScope = !sameScope && scopesOverlap(memory.path_scope ?? [], entry.memory.path_scope ?? []);
  const scopeRelation: MemoryScopeRelation = sameScope ? "same_scope" : overlappingScope ? "overlapping_scope" : "disjoint_scope";
  const titleSimilarity = getTextSimilarity(memory.title, entry.memory.title);
  const summarySimilarity = getTextSimilarity(memory.summary, entry.memory.summary);
  const detailSimilarity = getTextSimilarity(memory.detail, entry.memory.detail);
  const evidence = buildEvidenceVector(memory, entry, {
    sameScope,
    overlappingScope,
    scopeRelation,
    titleSimilarity,
    summarySimilarity,
    detailSimilarity,
  });
  const sameIdentity = evidence.identity.score >= SAME_IDENTITY_THRESHOLD;

  if (!isComparableMatch(scopeRelation, titleSimilarity, summarySimilarity, detailSimilarity, evidence, sameIdentity)) {
    return null;
  }

  const relation = classifyReviewRelation({
    sameScope,
    overlappingScope,
    sameIdentity,
    titleSimilarity,
    summarySimilarity,
    detailSimilarity,
    evidence,
    targetStatus,
    candidateIsNewer: isCandidateNewer(memory, entry.memory),
    replacementSignal: hasReplacementSignal(memory),
  });
  const confidence = computeRelationConfidence(relation, evidence);

  return {
    target_memory_id: getStoredMemoryId(entry),
    target_status: targetStatus,
    target_updated_at: entry.memory.updated ?? entry.memory.date,
    title_similarity: titleSimilarity,
    summary_similarity: summarySimilarity,
    detail_similarity: detailSimilarity,
    same_scope: sameScope,
    overlapping_scope: overlappingScope,
    scope_relation: scopeRelation,
    same_identity: sameIdentity,
    candidate_is_newer: isCandidateNewer(memory, entry.memory),
    replacement_signal: hasReplacementSignal(memory),
    relation,
    confidence,
    evidence,
    explain_summary: buildMatchSummary(relation, scopeRelation, sameIdentity, evidence),
  };
}

function buildEvidenceVector(
  candidate: Memory,
  entry: StoredMemoryRecord,
  metrics: {
    sameScope: boolean;
    overlappingScope: boolean;
    scopeRelation: MemoryScopeRelation;
    titleSimilarity: number;
    summarySimilarity: number;
    detailSimilarity: number;
  },
): MemoryReviewEvidenceVector {
  const target = entry.memory;
  const replacementSignal = hasReplacementSignal(candidate);
  const additiveSignal = ADDITIVE_SIGNAL_PATTERN.test(`${candidate.title}\n${candidate.summary}\n${candidate.detail}`);
  const partialUpdateSignal = PARTIAL_UPDATE_PATTERN.test(`${candidate.title}\n${candidate.summary}\n${candidate.detail}`);
  const splitSignal = SPLIT_SIGNAL_PATTERN.test(`${candidate.title}\n${candidate.summary}\n${candidate.detail}`);
  const candidateIsNewer = isCandidateNewer(candidate, target);

  const identityItems: MemoryReviewEvidenceItem[] = [];
  if (slugifyMemoryTitle(candidate.title) === slugifyMemoryTitle(target.title)) {
    identityItems.push(makeEvidence("same_title_slug", "Normalized titles match", 0.42, true));
  }
  if (metrics.titleSimilarity >= 0.92) {
    identityItems.push(makeEvidence("title_overlap_strong", "Title similarity is very high", 0.28, metrics.titleSimilarity));
  } else if (metrics.titleSimilarity >= 0.75) {
    identityItems.push(makeEvidence("title_overlap_moderate", "Title similarity is moderate", 0.18, metrics.titleSimilarity));
  }
  if (metrics.summarySimilarity >= 0.7) {
    identityItems.push(makeEvidence("summary_overlap_strong", "Summary similarity is strong", 0.2, metrics.summarySimilarity));
  } else if (metrics.summarySimilarity >= 0.48) {
    identityItems.push(makeEvidence("summary_overlap_moderate", "Summary similarity is moderate", 0.12, metrics.summarySimilarity));
  }
  if (metrics.detailSimilarity >= 0.62) {
    identityItems.push(makeEvidence("detail_overlap_support", "Detail overlap supports same identity", 0.12, metrics.detailSimilarity));
  }
  if (metrics.sameScope && metrics.titleSimilarity >= 0.72) {
    identityItems.push(makeEvidence("same_scope_support", "Exact scope match supports same identity", 0.08, true));
  }
  const sharedTags = candidate.tags.filter((tag) => target.tags.includes(tag)).slice(0, 3);
  if (sharedTags.length > 0) {
    identityItems.push(makeEvidence("shared_tags", "Shared tags support the same subject", 0.06, sharedTags.join(",")));
  }
  const identity = scoreBucket(identityItems);

  const scopeItems: MemoryReviewEvidenceItem[] = [];
  if (metrics.sameScope) {
    scopeItems.push(makeEvidence("same_scope", "Normalized path scopes are identical", 0.65, buildScopeIdentity(candidate.path_scope ?? [])));
  } else if (metrics.overlappingScope) {
    scopeItems.push(makeEvidence("overlapping_scope", "Path scopes overlap by parent/child scope", 0.35, `${buildScopeIdentity(candidate.path_scope ?? [])} ~ ${buildScopeIdentity(target.path_scope ?? [])}`));
  } else {
    scopeItems.push(makeEvidence("disjoint_scope", "Path scopes are disjoint", -0.45, `${buildScopeIdentity(candidate.path_scope ?? [])} x ${buildScopeIdentity(target.path_scope ?? [])}`));
  }
  const scope = scoreBucket(scopeItems, true);

  const overlapItems: MemoryReviewEvidenceItem[] = [];
  pushSimilarityEvidence(overlapItems, "title", "Title overlap", metrics.titleSimilarity, 0.32, 0.18);
  pushSimilarityEvidence(overlapItems, "summary", "Summary overlap", metrics.summarySimilarity, 0.3, 0.16);
  pushSimilarityEvidence(overlapItems, "detail", "Detail overlap", metrics.detailSimilarity, 0.22, 0.1);
  const overlap = scoreBucket(overlapItems);

  const replacementItems: MemoryReviewEvidenceItem[] = [];
  if (replacementSignal) {
    replacementItems.push(makeEvidence("replacement_wording", "Candidate uses replacement wording", 0.72, true));
  }
  if (additiveSignal) {
    replacementItems.push(makeEvidence("additive_wording", "Candidate reads like an additive update", -0.12, true));
  }
  if (partialUpdateSignal) {
    replacementItems.push(makeEvidence("partial_update_wording", "Candidate reads like a partial update", -0.18, true));
  }
  if (splitSignal) {
    replacementItems.push(makeEvidence("split_wording", "Candidate hints that overlap should stay split", -0.28, true));
  }
  const replacement = scoreBucket(replacementItems, true);

  const recencyItems: MemoryReviewEvidenceItem[] = [];
  const recencyDeltaDays = getDateDeltaDays(candidate.updated ?? candidate.date, target.updated ?? target.date);
  if (candidateIsNewer) {
    recencyItems.push(makeEvidence("candidate_newer", "Candidate is newer than target", recencyDeltaDays >= 7 ? 0.24 : 0.16, recencyDeltaDays));
  } else {
    recencyItems.push(makeEvidence("candidate_older", "Candidate is older than target", -0.22, recencyDeltaDays));
  }
  const recency = scoreBucket(recencyItems, true);

  const statusLineageItems: MemoryReviewEvidenceItem[] = [];
  if (target.status === "active" || !target.status) {
    statusLineageItems.push(makeEvidence("active_target", "Target is active and can own the durable relationship", 0.2, target.status ?? "active"));
  } else if (target.status === "candidate") {
    statusLineageItems.push(makeEvidence("candidate_target", "Target is only a candidate, so confidence is slightly lower", 0.08, target.status));
  } else if (target.status === "done") {
    statusLineageItems.push(makeEvidence("done_target", "Target is done, so overlap is weaker as a replacement baseline", -0.08, target.status));
  }
  if (target.supersedes) {
    statusLineageItems.push(makeEvidence("lineage_present", "Target is already part of a lineage chain", -0.04, target.supersedes));
  }
  const statusLineage = scoreBucket(statusLineageItems, true);

  return {
    identity,
    scope,
    title_summary_detail_overlap: overlap,
    replacement_wording: replacement,
    recency,
    status_lineage: statusLineage,
    total_score: clamp(
      identity.score * 0.28 +
        scope.score * 0.18 +
        overlap.score * 0.26 +
        replacement.score * 0.14 +
        recency.score * 0.08 +
        statusLineage.score * 0.06,
      0,
      1,
    ),
  };
}

function classifyReviewRelation(input: {
  sameScope: boolean;
  overlappingScope: boolean;
  sameIdentity: boolean;
  titleSimilarity: number;
  summarySimilarity: number;
  detailSimilarity: number;
  evidence: MemoryReviewEvidenceVector;
  targetStatus: MemoryStatus;
  candidateIsNewer: boolean;
  replacementSignal: boolean;
}): MemoryReviewRelation {
  const { sameScope, overlappingScope, sameIdentity, titleSimilarity, summarySimilarity, detailSimilarity, evidence, targetStatus, candidateIsNewer, replacementSignal } = input;
  const overlapScore = evidence.title_summary_detail_overlap.score;
  const replacementScore = evidence.replacement_wording.score;
  const hasSplitSignal = evidence.replacement_wording.items.some((item) => item.code === "split_wording");
  const hasPartialUpdateSignal = evidence.replacement_wording.items.some((item) => item.code === "partial_update_wording");

  if (
    (targetStatus === "active" || targetStatus === "candidate") &&
    sameScope &&
    sameIdentity &&
    titleSimilarity >= 0.9 &&
    summarySimilarity >= 0.78 &&
    detailSimilarity >= 0.66 &&
    !replacementSignal &&
    !hasSplitSignal
  ) {
    return "duplicate";
  }

  if (
    targetStatus === "active" &&
    sameScope &&
    sameIdentity &&
    candidateIsNewer &&
    replacementScore >= 0.42 &&
    (overlapScore >= 0.32 || detailSimilarity >= 0.42 || titleSimilarity >= 0.95)
  ) {
    return "full_replacement";
  }

  if (
    (sameScope || overlappingScope) &&
    (sameIdentity || (sameScope && titleSimilarity >= 0.68)) &&
    overlapScore >= MODERATE_OVERLAP_THRESHOLD &&
    replacementScore < 0.32 &&
    !hasSplitSignal
  ) {
    return "additive_update";
  }

  if (
    (sameScope || overlappingScope) &&
    (hasSplitSignal || hasPartialUpdateSignal) &&
    (sameIdentity || overlapScore >= 0.5)
  ) {
    return "possible_split";
  }

  return "ambiguous_overlap";
}

function isComparableMatch(
  scopeRelation: MemoryScopeRelation,
  titleSimilarity: number,
  summarySimilarity: number,
  detailSimilarity: number,
  evidence: MemoryReviewEvidenceVector,
  sameIdentity: boolean,
): boolean {
  if (scopeRelation === "same_scope" || scopeRelation === "overlapping_scope") {
    return (
      titleSimilarity >= REVIEW_CONTEXT_TITLE_THRESHOLD ||
      summarySimilarity >= REVIEW_CONTEXT_CONTENT_THRESHOLD ||
      detailSimilarity >= REVIEW_CONTEXT_CONTENT_THRESHOLD ||
      sameIdentity
    );
  }

  return sameIdentity && titleSimilarity >= 0.9 && evidence.title_summary_detail_overlap.score >= 0.7;
}

function computeRelationConfidence(relation: MemoryReviewRelation, evidence: MemoryReviewEvidenceVector): number {
  const identity = evidence.identity.score;
  const scope = evidence.scope.score;
  const overlap = evidence.title_summary_detail_overlap.score;
  const replacement = evidence.replacement_wording.score;
  const recency = evidence.recency.score;
  const status = evidence.status_lineage.score;

  switch (relation) {
    case "duplicate":
      return clamp(identity * 0.42 + scope * 0.2 + overlap * 0.3 + status * 0.08, 0, 1);
    case "full_replacement":
      return clamp(identity * 0.28 + scope * 0.14 + overlap * 0.18 + replacement * 0.24 + recency * 0.1 + status * 0.06, 0, 1);
    case "additive_update":
      return clamp(identity * 0.26 + scope * 0.16 + overlap * 0.32 + Math.max(0, 1 - replacement) * 0.14 + status * 0.12, 0, 1);
    case "possible_split":
      return clamp(identity * 0.18 + scope * 0.18 + overlap * 0.18 + Math.abs(replacement) * 0.28 + recency * 0.06 + status * 0.12, 0, 1);
    case "ambiguous_overlap":
      return clamp(identity * 0.18 + scope * 0.18 + overlap * 0.22 + status * 0.08, 0, 1);
  }
}

function finalizeReview(
  decision: MemoryReviewDecision,
  targetMemoryIds: string[],
  reason: MemoryReviewReason,
  internalRelation: MemoryReviewRelation | null,
  confidence: number,
  context: MemoryReviewContext,
  summary: string,
): CandidateMemoryReviewResult {
  return {
    decision,
    target_memory_ids: targetMemoryIds,
    reason,
    confidence,
    internal_relation: internalRelation,
    explanation: buildCandidateExplanation(summary, targetMemoryIds, context),
  };
}

function buildCandidateExplanation(
  summary: string,
  winningTargetMemoryIds: string[],
  context: MemoryReviewContext,
): CandidateMemoryReviewExplanation {
  return {
    summary,
    winning_target_memory_ids: winningTargetMemoryIds,
    considered_match_ids: context.comparable_matches.map((match) => match.target_memory_id),
    top_matches: context.comparable_matches.slice(0, 3).map((match) => ({
      target_memory_id: match.target_memory_id,
      relation: match.relation,
      confidence: match.confidence,
      explain_summary: match.explain_summary,
    })),
  };
}

function buildMatchSummary(
  relation: MemoryReviewRelation,
  scopeRelation: MemoryScopeRelation,
  sameIdentity: boolean,
  evidence: MemoryReviewEvidenceVector,
): string {
  const fragments = [
    `${relation} via ${scopeRelation}`,
    sameIdentity ? "same-identity evidence is strong" : "same-identity evidence is limited",
  ];

  const topEvidence = [
    ...evidence.identity.items,
    ...evidence.scope.items,
    ...evidence.title_summary_detail_overlap.items,
    ...evidence.replacement_wording.items,
  ]
    .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
    .slice(0, 3)
    .map((item) => item.code);

  if (topEvidence.length > 0) {
    fragments.push(`top evidence: ${topEvidence.join(", ")}`);
  }

  return fragments.join("; ");
}

function hasCompetingMatch(primary: MemoryReviewMatch, matches: MemoryReviewMatch[]): boolean {
  return matches.some(
    (match) =>
      match.target_memory_id !== primary.target_memory_id &&
      Math.abs(match.confidence - primary.confidence) <= 0.06 &&
      getStatusWeight(match.target_status) >= getStatusWeight(primary.target_status),
  );
}

function hasAmbiguousConflict(primary: MemoryReviewMatch, matches: MemoryReviewMatch[]): boolean {
  return matches.some(
    (match) =>
      match.target_memory_id !== primary.target_memory_id &&
      match.confidence >= primary.confidence - 0.08 &&
      match.scope_relation !== "disjoint_scope" &&
      getStatusWeight(match.target_status) >= getStatusWeight(primary.target_status),
  );
}

function hasMultiTargetConflict(matches: MemoryReviewMatch[]): boolean {
  const activeCandidates = matches.filter((match) => match.scope_relation !== "disjoint_scope");
  return activeCandidates.length >= 2 && activeCandidates[0] && activeCandidates[1]
    ? Math.abs(activeCandidates[0].confidence - activeCandidates[1].confidence) <= 0.12
    : false;
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
  const candidateDate = Date.parse(memory.updated ?? memory.date);
  const targetDate = Date.parse(target.updated ?? target.date);

  if (Number.isFinite(candidateDate) && Number.isFinite(targetDate)) {
    return candidateDate >= targetDate;
  }

  return (memory.updated ?? memory.date).localeCompare(target.updated ?? target.date) >= 0;
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

function normalizeReviewCandidateMemoriesOptions(
  legacyReviewerOrOptions: MemoryReviewer | ReviewCandidateMemoriesOptions | undefined,
): ReviewCandidateMemoriesOptions {
  if (!legacyReviewerOrOptions) {
    return {};
  }

  if (typeof legacyReviewerOrOptions === "object" && "reviewCandidate" in legacyReviewerOrOptions) {
    emitLegacyReviewerWarning();
    return {};
  }

  return legacyReviewerOrOptions;
}

export function parseExternalReviewInput(value: unknown): ValidatedExternalReviewInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const source = asNonEmptyString(candidate.source);
  const suggestion = parseExternalReviewSuggestion(candidate.suggestion);

  if (!source || !suggestion) {
    return null;
  }

  return {
    source,
    suggestion,
  };
}

function parseExternalReviewSuggestion(value: unknown): ExternalReviewSuggestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const decision = asNonEmptyString(candidate.decision);
  if (!decision || !MEMORY_REVIEW_DECISIONS.includes(decision as ExternalReviewSuggestion["decision"])) {
    return null;
  }

  const targetMemoryIds = Array.isArray(candidate.target_memory_ids)
    ? candidate.target_memory_ids.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const reason = asNonEmptyString(candidate.reason) ?? undefined;

  return {
    decision: decision as ExternalReviewSuggestion["decision"],
    target_memory_ids: targetMemoryIds,
    ...(reason ? { reason } : {}),
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

let hasWarnedAboutLegacyReviewer = false;

function emitLegacyReviewerWarning(): void {
  if (hasWarnedAboutLegacyReviewer) {
    return;
  }

  hasWarnedAboutLegacyReviewer = true;
  process.emitWarning(
    "Custom reviewer overrides are deprecated and ignored. RepoBrain Core always uses the local deterministic reviewer; pass optional external review input instead.",
  );
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
    case "done":
      return 1;
    case "stale":
      return 0;
    case "superseded":
      return -1;
  }
}

function compareReviewMatches(left: MemoryReviewMatch, right: MemoryReviewMatch): number {
  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  if (right.same_scope !== left.same_scope) {
    return Number(right.same_scope) - Number(left.same_scope);
  }

  if (right.target_status !== left.target_status) {
    return getStatusWeight(right.target_status) - getStatusWeight(left.target_status);
  }

  if (right.evidence.total_score !== left.evidence.total_score) {
    return right.evidence.total_score - left.evidence.total_score;
  }

  if (right.target_updated_at !== left.target_updated_at) {
    return right.target_updated_at.localeCompare(left.target_updated_at);
  }

  return right.target_memory_id.localeCompare(left.target_memory_id);
}

function scoreBucket(items: MemoryReviewEvidenceItem[], allowNegative: boolean = false): MemoryReviewEvidenceBucket {
  if (items.length === 0) {
    return { score: 0, items: [] };
  }

  const total = items.reduce((sum, item) => sum + item.weight, 0);
  return {
    score: allowNegative ? clamp(total, -1, 1) : clamp(total, 0, 1),
    items,
  };
}

function pushSimilarityEvidence(
  items: MemoryReviewEvidenceItem[],
  codePrefix: string,
  label: string,
  similarity: number,
  strongWeight: number,
  moderateWeight: number,
): void {
  if (similarity >= 0.78) {
    items.push(makeEvidence(`${codePrefix}_overlap_strong`, `${label} is strong`, strongWeight, similarity));
  } else if (similarity >= 0.48) {
    items.push(makeEvidence(`${codePrefix}_overlap_moderate`, `${label} is moderate`, moderateWeight, similarity));
  }
}

function makeEvidence(code: string, label: string, weight: number, value?: string | number | boolean): MemoryReviewEvidenceItem {
  return { code, label, weight, ...(value === undefined ? {} : { value }) };
}

function getDateDeltaDays(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 0;
  }

  return Math.round((leftTime - rightTime) / (1000 * 60 * 60 * 24));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatEvidenceBucket(bucket: MemoryReviewEvidenceBucket): string {
  const details = bucket.items.map((item) => item.code).join(",");
  return `score=${bucket.score.toFixed(2)}${details ? ` items=${details}` : ""}`;
}

function formatConfidence(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}
