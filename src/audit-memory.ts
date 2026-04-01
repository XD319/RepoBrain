import path from "node:path";

import { loadActivityState, loadStoredMemoryRecords, getMemoryStatus } from "./store.js";
import {
  normalizeTextForComparison,
  scopesOverlap,
  slugifyMemoryTitle,
} from "./memory-identity.js";
import type {
  Memory,
  MemoryActivityEntry,
  MemoryAuditIssue,
  MemoryAuditIssueType,
  MemoryAuditResult,
  StoredMemoryRecord,
} from "./types.js";

export interface MemoryAuditOptions {
  now?: string;
}

const ISSUE_TYPE_ORDER: MemoryAuditIssueType[] = [
  "stale",
  "conflict",
  "low_signal",
  "overscoped",
];

const STALE_SIGNAL_PATTERN =
  /\b(?:temporary|temp|deprecated|obsolete|legacy fallback|old workaround|until release|one-off|one off)\b|临时|过时|弃用|旧方案/u;
const GENERIC_SIGNAL_PATTERN =
  /\b(?:general guidance|misc(?:ellaneous)? update|remember this|notes for later|keep code clean|follow best practices|improve quality)\b|通用说明|杂项更新|后续再看|保持代码整洁/u;
const BROAD_LANGUAGE_PATTERN =
  /\b(?:all code|all modules|entire repo|whole repo|every task|every change|any change|everywhere|global rule)\b|整个仓库|所有模块|所有改动|任何改动/u;
const APPLICABILITY_PATTERN =
  /\b(?:when|if|before|after|only|unless|under|for|during)\b|当|如果|仅在|除非|适用于|在.+时/u;

const NEGATIVE_POLARITY_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bmust not\b/gu, weight: 3 },
  { pattern: /\bnever\b/gu, weight: 3 },
  { pattern: /\bdo not\b/gu, weight: 2 },
  { pattern: /\bdon't\b/gu, weight: 2 },
  { pattern: /\bavoid\b/gu, weight: 2 },
  { pattern: /\bdisable\b/gu, weight: 2 },
  { pattern: /\bskip\b/gu, weight: 1 },
  { pattern: /\binstead of\b/gu, weight: 2 },
  { pattern: /不要|禁止|避免|不要用/gu, weight: 2 },
];

const POSITIVE_POLARITY_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bmust\b/gu, weight: 1 },
  { pattern: /\balways\b/gu, weight: 1 },
  { pattern: /\bprefer\b/gu, weight: 1 },
  { pattern: /\buse\b/gu, weight: 1 },
  { pattern: /\benable\b/gu, weight: 1 },
  { pattern: /\bkeep\b/gu, weight: 1 },
  { pattern: /\ballow\b/gu, weight: 1 },
  { pattern: /\brequire\b/gu, weight: 1 },
  { pattern: /\binside\b/gu, weight: 1 },
  { pattern: /优先|启用|必须|保持|要求/gu, weight: 1 },
];

const BROAD_SCOPE_MARKERS = new Set(["global", ".", "*", "**", "src", "packages", "apps", "services", "repo"]);

export async function buildMemoryAudit(
  projectRoot: string,
  options: MemoryAuditOptions = {},
): Promise<MemoryAuditResult> {
  const [records, activity] = await Promise.all([
    loadStoredMemoryRecords(projectRoot),
    loadActivityState(projectRoot),
  ]);
  const generatedAt = options.now?.trim() || new Date().toISOString();
  const recentLoadKeys = new Set(activity.recentLoadedMemories.map((entry) => getActivityEntryKey(entry)));
  const issues = [
    ...findStaleIssues(records, recentLoadKeys, generatedAt),
    ...findConflictIssues(records),
    ...findLowSignalIssues(records),
    ...findOverscopedIssues(records),
  ].sort(compareAuditIssues);

  const byIssueType = {
    stale: 0,
    conflict: 0,
    low_signal: 0,
    overscoped: 0,
  } satisfies Record<MemoryAuditIssueType, number>;

  for (const issue of issues) {
    byIssueType[issue.issue_type] += 1;
  }

  return {
    generated_at: generatedAt,
    summary: {
      total_issues: issues.length,
      by_issue_type: byIssueType,
    },
    issues,
  };
}

export function renderMemoryAuditResult(result: MemoryAuditResult): string {
  const lines = [
    `Memory audit generated at ${result.generated_at}`,
    `Issues: total=${result.summary.total_issues}, stale=${result.summary.by_issue_type.stale}, conflict=${result.summary.by_issue_type.conflict}, low_signal=${result.summary.by_issue_type.low_signal}, overscoped=${result.summary.by_issue_type.overscoped}`,
    "",
    "Findings:",
  ];

  if (result.issues.length === 0) {
    lines.push("- None.");
    return lines.join("\n");
  }

  for (const issue of result.issues) {
    lines.push(`- ${issue.issue_type} | ${issue.memory_id} | action=${issue.suggested_action}`);
    lines.push(`  File: ${toDisplayPath(issue.relative_path)}`);
    if ((issue.related_memory_ids ?? []).length > 0) {
      lines.push(`  Related: ${issue.related_memory_ids?.join(", ")}`);
    }
    lines.push(`  Reason: ${issue.reason}`);
  }

  return lines.join("\n");
}

function findStaleIssues(
  records: StoredMemoryRecord[],
  recentLoadKeys: Set<string>,
  generatedAt: string,
): MemoryAuditIssue[] {
  return getAuditableRecords(records)
    .filter((record) => shouldMarkStale(record, recentLoadKeys, generatedAt))
    .map((record) => {
      const ageDays = getAgeInDays(record.memory.date, generatedAt);
      const status = getMemoryStatus(record.memory);
      const staleByAge =
        status === "candidate"
          ? `candidate memory has been waiting ${ageDays} days without promotion`
          : `active memory is ${ageDays} days old and has not appeared in recent inject activity`;
      const staleByContent = hasStaleSignal(record.memory)
        ? "its content still reads like a temporary or deprecated workaround"
        : "its age and status now make it a review candidate";

      return buildIssue(record, "stale", `${staleByAge}; ${staleByContent}.`, status === "candidate" ? "archive" : "review");
    });
}

function findConflictIssues(records: StoredMemoryRecord[]): MemoryAuditIssue[] {
  const auditable = getAuditableRecords(records).filter((record) => {
    const type = record.memory.type;
    return type === "decision" || type === "convention";
  });
  const issues: MemoryAuditIssue[] = [];

  for (let index = 0; index < auditable.length; index += 1) {
    const left = auditable[index];
    if (!left) {
      continue;
    }

    for (let inner = index + 1; inner < auditable.length; inner += 1) {
      const right = auditable[inner];
      if (!right || !looksConflicting(left, right)) {
        continue;
      }

      issues.push(
        buildIssue(
          left,
          "conflict",
          `conflicts with ${getStoredMemoryId(right)} because the entries apply to the same scope but recommend opposite directions.`,
          "review",
          [getStoredMemoryId(right)],
        ),
      );
      issues.push(
        buildIssue(
          right,
          "conflict",
          `conflicts with ${getStoredMemoryId(left)} because the entries apply to the same scope but recommend opposite directions.`,
          "review",
          [getStoredMemoryId(left)],
        ),
      );
    }
  }

  return issues;
}

function findLowSignalIssues(records: StoredMemoryRecord[]): MemoryAuditIssue[] {
  return getAuditableRecords(records)
    .filter((record) => isLowSignal(record.memory))
    .map((record) =>
      buildIssue(
        record,
        "low_signal",
        "summary/detail do not carry enough durable repo knowledge signal yet; the entry is too thin or too generic to route future work reliably.",
        "rewrite",
      ),
    );
}

function findOverscopedIssues(records: StoredMemoryRecord[]): MemoryAuditIssue[] {
  return getAuditableRecords(records)
    .filter((record) => isOverscoped(record.memory))
    .map((record) =>
      buildIssue(
        record,
        "overscoped",
        "scope is so broad that this memory is likely to be injected or matched outside its real applicability.",
        "narrow_scope",
      ),
    );
}

function buildIssue(
  record: StoredMemoryRecord,
  issueType: MemoryAuditIssueType,
  reason: string,
  suggestedAction: string,
  relatedMemoryIds: string[] = [],
): MemoryAuditIssue {
  return {
    memory_id: getStoredMemoryId(record),
    relative_path: record.relativePath,
    issue_type: issueType,
    reason,
    suggested_action: suggestedAction,
    ...(relatedMemoryIds.length > 0 ? { related_memory_ids: relatedMemoryIds } : {}),
  };
}

function getAuditableRecords(records: StoredMemoryRecord[]): StoredMemoryRecord[] {
  return records.filter((record) => {
    const status = getMemoryStatus(record.memory);
    return status !== "superseded" && status !== "stale";
  });
}

function shouldMarkStale(
  record: StoredMemoryRecord,
  recentLoadKeys: Set<string>,
  generatedAt: string,
): boolean {
  const status = getMemoryStatus(record.memory);
  const ageDays = getAgeInDays(record.memory.date, generatedAt);
  const recentlyLoaded = recentLoadKeys.has(getMemoryKey(record.memory));

  if (status === "candidate") {
    return ageDays >= 21;
  }

  if (hasStaleSignal(record.memory) && ageDays >= 45 && !recentlyLoaded) {
    return true;
  }

  return status === "active" && record.memory.importance === "low" && ageDays >= 180 && !recentlyLoaded;
}

function looksConflicting(left: StoredMemoryRecord, right: StoredMemoryRecord): boolean {
  if (left.memory.type !== right.memory.type) {
    return false;
  }

  if (!scopesOverlap(left.memory.path_scope ?? [], right.memory.path_scope ?? [])) {
    return false;
  }

  const explicitOpposite = hasExplicitOppositeDirective(left.memory, right.memory);
  if (explicitOpposite) {
    return true;
  }

  const titleMatch =
    slugifyMemoryTitle(left.memory.title) === slugifyMemoryTitle(right.memory.title) ||
    getTextSimilarity(left.memory.title, right.memory.title) >= 0.45;
  const summaryMatch = getTextSimilarity(left.memory.summary, right.memory.summary) >= 0.35;
  const sharedSubject =
    getSharedMeaningfulTokenCount(
      `${left.memory.title} ${left.memory.summary}`,
      `${right.memory.title} ${right.memory.summary}`,
    ) >= 4;

  if (!titleMatch && !summaryMatch && !sharedSubject) {
    return false;
  }

  const leftPolarity = getDirectivePolarity(left.memory);
  const rightPolarity = getDirectivePolarity(right.memory);
  return explicitOpposite || (leftPolarity !== 0 && rightPolarity !== 0 && leftPolarity !== rightPolarity);
}

function getSharedMeaningfulTokenCount(left: string, right: string): number {
  const ignoreTokens = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "must",
    "never",
    "always",
    "route",
    "through",
    "without",
    "when",
    "because",
    "should",
  ]);
  const leftTokens = new Set(
    normalizeTextForComparison(left)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !ignoreTokens.has(token)),
  );
  const rightTokens = new Set(
    normalizeTextForComparison(right)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !ignoreTokens.has(token)),
  );

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function hasExplicitOppositeDirective(left: Memory, right: Memory): boolean {
  const leftText = normalizeTextForComparison(`${left.title} ${left.summary} ${left.detail}`);
  const rightText = normalizeTextForComparison(`${right.title} ${right.summary} ${right.detail}`);
  const positivePattern = /\b(?:always|must|prefer|enable|keep|allow)\b/u;
  const negativePattern = /\b(?:never|must not|do not|don't|avoid|disable|skip)\b/u;

  return (
    (positivePattern.test(leftText) && negativePattern.test(rightText)) ||
    (negativePattern.test(leftText) && positivePattern.test(rightText))
  );
}

function isLowSignal(memory: Memory): boolean {
  const normalizedSummary = normalizeTextForComparison(memory.summary);
  const normalizedDetail = normalizeTextForComparison(memory.detail);
  const tokens = new Set(
    `${normalizeTextForComparison(memory.title)} ${normalizedSummary} ${normalizedDetail}`
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean),
  );

  let weakSignals = 0;
  if (tokens.size < 12) {
    weakSignals += 1;
  }
  if (normalizedSummary.length < 30) {
    weakSignals += 1;
  }
  if (normalizedDetail.length < 80) {
    weakSignals += 1;
  }
  if ((memory.tags ?? []).length === 0 && (memory.path_scope ?? []).length === 0) {
    weakSignals += 1;
  }
  if (GENERIC_SIGNAL_PATTERN.test(`${memory.title}\n${memory.summary}\n${memory.detail}`)) {
    weakSignals += 2;
  }

  return weakSignals >= 3;
}

function isOverscoped(memory: Memory): boolean {
  const normalizedScopes = (memory.path_scope ?? []).map(normalizeScopeEntry).filter(Boolean);
  const broadScope = normalizedScopes.some((scope) => BROAD_SCOPE_MARKERS.has(scope));
  const broadLanguage = BROAD_LANGUAGE_PATTERN.test(`${memory.title}\n${memory.summary}\n${memory.detail}`);
  const hasApplicability = APPLICABILITY_PATTERN.test(`${memory.summary}\n${memory.detail}`);

  if (broadScope && (broadLanguage || !hasApplicability)) {
    return true;
  }

  return normalizedScopes.length === 0 && broadLanguage && !hasApplicability;
}

function hasStaleSignal(memory: Memory): boolean {
  return STALE_SIGNAL_PATTERN.test(`${memory.title}\n${memory.summary}\n${memory.detail}`);
}

function getDirectivePolarity(memory: Memory): number {
  const content = `${memory.title}\n${memory.summary}\n${memory.detail}`;
  const negativeScore = NEGATIVE_POLARITY_PATTERNS.reduce(
    (sum, entry) => sum + countMatches(content, entry.pattern) * entry.weight,
    0,
  );
  const positiveScore = POSITIVE_POLARITY_PATTERNS.reduce(
    (sum, entry) => sum + countMatches(content, entry.pattern) * entry.weight,
    0,
  );

  if (negativeScore >= positiveScore + 1) {
    return -1;
  }

  if (positiveScore >= negativeScore + 1) {
    return 1;
  }

  return 0;
}

function countMatches(content: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return Array.from(content.matchAll(new RegExp(pattern.source, flags))).length;
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

  const leftTokens = new Set(normalizedLeft.split(" ").filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / union.size;
}

function getAgeInDays(date: string, now: string): number {
  const parsedDate = Date.parse(date);
  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedDate) || !Number.isFinite(parsedNow)) {
    return 0;
  }

  return Math.floor((parsedNow - parsedDate) / (24 * 60 * 60 * 1000));
}

function getStoredMemoryId(record: StoredMemoryRecord): string {
  return path.basename(record.filePath, path.extname(record.filePath));
}

function getMemoryKey(memory: Pick<Memory, "type" | "title" | "date">): string {
  return `${memory.type}|${memory.title}|${memory.date}`;
}

function getActivityEntryKey(entry: MemoryActivityEntry): string {
  return `${entry.type}|${entry.title}|${entry.date}`;
}

function normalizeScopeEntry(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/\*\*?$/u, "")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

function compareAuditIssues(left: MemoryAuditIssue, right: MemoryAuditIssue): number {
  const issueOrderDifference =
    ISSUE_TYPE_ORDER.indexOf(left.issue_type) - ISSUE_TYPE_ORDER.indexOf(right.issue_type);
  if (issueOrderDifference !== 0) {
    return issueOrderDifference;
  }

  const pathDifference = left.relative_path.localeCompare(right.relative_path);
  if (pathDifference !== 0) {
    return pathDifference;
  }

  return left.memory_id.localeCompare(right.memory_id);
}

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}
