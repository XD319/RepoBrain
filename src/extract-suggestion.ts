import type { MemoryType } from "./types.js";

export type ExtractSuggestionSignal = "positive" | "negative" | "neutral";

export interface ExtractSuggestionEvidence {
  rule: string;
  signal: ExtractSuggestionSignal;
  weight: number;
  detail: string;
  suggested_type: MemoryType | null;
}

export interface ExtractSuggestionSuppression {
  rule: string;
  detail: string;
}

export interface PhaseCompletionSignal {
  name: string;
  category: "user_text" | "agent_text" | "test_status" | "diff_scope";
  detail: string;
  boost: number;
}

export interface ExtractSuggestionResult {
  should_extract: boolean;
  confidence: number;
  suggested_type: MemoryType | null;
  reasons: string[];
  evidence: ExtractSuggestionEvidence[];
  suppressions: ExtractSuggestionSuppression[];
  phase_completion_signals: PhaseCompletionSignal[];
  summary: string;
}

export interface ExtractSuggestionInput {
  task?: string | undefined;
  sessionSummary?: string | undefined;
  changedFiles?: string[] | undefined;
  diffStat?: string | undefined;
  testResultSummary?: string | undefined;
  commitMessage?: string | undefined;
  source?: "session" | "git-commit" | undefined;
}

const POSITIVE_THRESHOLD = 2.5;
const NEGATIVE_THRESHOLD = -2.0;
const MAX_CONFIDENCE_SCORE = 8.0;
const MAX_NEGATIVE_CONFIDENCE_SCORE = 6.0;

const DECISION_PATTERN =
  /\b(?:decision|decided|choose|chose|adopt|adopted|switch(?:ed)? to|standardize|standardized|keep using|selected|architect)\b|(?:决定|采用|改为|统一使用|选用|保留|切换到|标准化)/iu;
const DECISION_RATIONALE_PATTERN =
  /\b(?:because|so that|to avoid|for consistency|for rollback|for safety|due to|the reason|rationale)\b|(?:因为|以便|为了一致性|为了安全|原因是)/iu;
const RISK_PATTERN =
  /\b(?:gotcha|pitfall|beware|avoid|never|must not|do not|don't|fails? when|breaks? when|regression|partial write|data loss|rollback|race condition|deadlock|corrupt|unsafe|leak|crash|panic)\b|(?:不要|避免|否则|会导致|陷阱|注意|坑|报错|失败|死锁|回滚|半写入|数据丢失|泄漏)/iu;
const CONVENTION_PATTERN =
  /\b(?:convention|naming|directory|layout|folder|style|standard|always put|store .* under|keep .* under|use the .* folder|linting rule)\b|(?:约定|规范|统一放在|统一使用|命名|目录|放到.*目录|保持.*结构)/iu;
const PATTERN_PATTERN =
  /\b(?:pattern|reusable|workflow|pipeline|helper|wrap .* with|route .* through|extract .* helper|template|fan out|shared .* parser)\b|(?:模式|流程|封装|抽成.*helper|通过.*处理|复用|共享解析器|统一走)/iu;
const GOAL_PATTERN =
  /\b(?:goal|target|migration|roadmap|objective|end state|eventually|long term|north star|milestone)\b|(?:目标|迁移到|最终|长期|收敛到|规划|里程碑|终态)/iu;
const CAUSE_PATTERN =
  /\b(?:because|since|so that|to avoid|to prevent|to keep|ensures?|prevents?|due to|why:)\b|(?:因为|因此|以便|为了|避免|防止|否则|这样可以|原因是)/iu;
const CONSTRAINT_PATTERN =
  /\b(?:must|must not|should not|never|always|cannot|can't|only|required|forbidden)\b|(?:必须|不要|不能|只能|禁止|务必|一律)/iu;

const FORMAT_ONLY_PATTERN =
  /\b(?:format|prettier|eslint fix|lint fix|code style|whitespace|indentation|trailing space)\b|(?:只改格式|格式化|代码风格)/iu;
const DEP_BUMP_PATTERN =
  /\b(?:bump version|upgrade dep|npm install|pnpm install|yarn install|dependency update|renovate|dependabot)\b|(?:升级依赖|依赖更新)/iu;
const DEP_FILE_PATTERN =
  /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json|Gemfile\.lock|Cargo\.lock|go\.sum|requirements\.txt|poetry\.lock)$/i;
const TYPO_PATTERN = /\b(?:typo|spelling|fix typo|typo fix)\b|(?:修个 ?typo|拼写错误)/iu;
const DEBUG_PATTERN =
  /\b(?:console\.log|debug log|printf?\(|print\(|temporary|temp|for now|today only|one-off|debug only|wip)\b|(?:临时|暂时|一次性|仅调试|本次|这轮|打印日志|调试日志)/iu;
const SNAPSHOT_PATTERN = /(?:__snapshots__|\.snap)$/i;
const CI_CONFIG_PATTERN = /(?:\.github\/workflows\/|Jenkinsfile|\.gitlab-ci\.yml|\.circleci\/|\.travis\.yml)/i;
const MERGE_COMMIT_PATTERN = /^Merge (?:branch|pull request|remote)/iu;
const REVERT_PATTERN = /^Revert\b|(?:^revert[:\s])/iu;
const RENAME_ONLY_PATTERN = /\b(?:rename|moved? file|renamed?)\b/iu;

const SCHEMA_MIGRATION_PATTERN = /(?:migration|migrate|schema|\.sql$)/i;
const TEST_FIX_PATTERN = /\b(?:fix(?:ed|es)?|failure|failing|broken|flaky)\b/iu;
const TEST_FILE_PATTERN = /(?:\.test\.|\.spec\.|__tests__|test\/|tests\/|fixture)/i;

// --- Phase-completion signal patterns ---

const USER_PHASE_DONE_PATTERN =
  /(?:好了|先这样|这一版可以|继续下一个|这版可以|可以了|就这样|就先这样|到这里|差不多了|阶段完成|这部分搞定了|先到这|\bmove on\b|\blet'?s move on\b|\bnext step\b|\blooks good\b|\bgood enough\b|\bthat'?s it\b|\bwrap up\b|\bship it\b|\bready for review\b|\bdone with this\b|\bthis part is done\b|\blet'?s continue\b)/iu;

const AGENT_PHASE_DONE_PATTERN =
  /(?:已完成|已修复|已实现|测试已通过|实现完成|修复完成|重构完成|已全部通过|\ball tests pass(?:ing|ed)?\b|\bimplementation complete\b|\bfix(?:ed)? (?:and|&) verified\b|\brefactor(?:ing)? complete\b|\bfeature implemented\b|\bbug fix confirmed\b|\bsuccessfully (?:implemented|completed|fixed|resolved)\b)/iu;

const TEST_STATUS_IMPROVEMENT_PATTERN =
  /(?:(?:from|从)\s*(?:fail|red|broken|失败|不通过)\s*(?:to|→|->|变为|变成)\s*(?:pass|green|通过|成功)|\btests?\s+(?:now\s+)?pass(?:ing|ed)?\b|测试(?:已|全部)?通过|(?:all|全部)\s+(?:tests?\s+)?(?:green|pass))/iu;

const WEAK_ACKNOWLEDGMENT_PATTERN =
  /^(?:ok|okay|好的?|谢谢|thanks?|thank you|嗯|行|收到|got it|alright|sure|fine|知道了|了解|明白|mm?hmm|yep|yeah?|是的)\s*[.!。！]?\s*$/iu;

interface SignalRule {
  name: string;
  test: (input: ExtractSuggestionInput, combined: string) => boolean;
  weight: number;
  signal: ExtractSuggestionSignal;
  detail: (input: ExtractSuggestionInput) => string;
  suggested_type: MemoryType | null;
}

const POSITIVE_RULES: SignalRule[] = [
  {
    name: "architecture_decision",
    test: (_input, combined) => DECISION_PATTERN.test(combined) && DECISION_RATIONALE_PATTERN.test(combined),
    weight: 3.0,
    signal: "positive",
    detail: () => "Detected architecture or technology decision with rationale.",
    suggested_type: "decision",
  },
  {
    name: "risk_or_pitfall",
    test: (_input, combined) => RISK_PATTERN.test(combined),
    weight: 3.5,
    signal: "positive",
    detail: () => "Detected risk, pitfall, or avoidance constraint language.",
    suggested_type: "gotcha",
  },
  {
    name: "convention_established",
    test: (_input, combined) => CONVENTION_PATTERN.test(combined),
    weight: 2.5,
    signal: "positive",
    detail: () => "Detected naming, layout, or convention establishment language.",
    suggested_type: "convention",
  },
  {
    name: "reusable_pattern",
    test: (_input, combined) => PATTERN_PATTERN.test(combined),
    weight: 2.5,
    signal: "positive",
    detail: () => "Detected reusable pattern, workflow, or helper extraction language.",
    suggested_type: "pattern",
  },
  {
    name: "multi_session_goal",
    test: (_input, combined) => GOAL_PATTERN.test(combined),
    weight: 2.5,
    signal: "positive",
    detail: () => "Detected durable goal, migration target, or roadmap item.",
    suggested_type: "goal",
  },
  {
    name: "cross_module_change",
    test: (input) => countDistinctTopDirs(input.changedFiles ?? []) >= 3,
    weight: 1.5,
    signal: "positive",
    detail: (input) => `Changed files span ${countDistinctTopDirs(input.changedFiles ?? [])} top-level directories.`,
    suggested_type: null,
  },
  {
    name: "significant_file_count",
    test: (input) => (input.changedFiles ?? []).length >= 5,
    weight: 1.0,
    signal: "positive",
    detail: (input) => `${(input.changedFiles ?? []).length} files changed.`,
    suggested_type: null,
  },
  {
    name: "cause_or_rationale",
    test: (_input, combined) => CAUSE_PATTERN.test(combined),
    weight: 1.5,
    signal: "positive",
    detail: () => "Detected causal or rationale language (because, so that, to avoid, etc.).",
    suggested_type: null,
  },
  {
    name: "constraint_language",
    test: (_input, combined) => CONSTRAINT_PATTERN.test(combined),
    weight: 1.2,
    signal: "positive",
    detail: () => "Detected constraint language (must, never, always, cannot, etc.).",
    suggested_type: null,
  },
  {
    name: "test_failure_fix",
    test: (input, combined) =>
      Boolean(input.testResultSummary) &&
      TEST_FIX_PATTERN.test(combined) &&
      (input.changedFiles ?? []).some((f) => TEST_FILE_PATTERN.test(f)),
    weight: 2.0,
    signal: "positive",
    detail: () => "Test failure fix detected with test file changes.",
    suggested_type: "gotcha",
  },
  {
    name: "schema_or_migration",
    test: (input) => (input.changedFiles ?? []).some((f) => SCHEMA_MIGRATION_PATTERN.test(f)),
    weight: 2.0,
    signal: "positive",
    detail: () => "Changed files include schema or migration artifacts.",
    suggested_type: "decision",
  },
  {
    name: "decision_keyword_only",
    test: (_input, combined) => DECISION_PATTERN.test(combined) && !DECISION_RATIONALE_PATTERN.test(combined),
    weight: 1.5,
    signal: "positive",
    detail: () => "Decision keyword found without explicit rationale.",
    suggested_type: "decision",
  },
];

const NEGATIVE_RULES: SignalRule[] = [
  {
    name: "format_only",
    test: (input, combined) =>
      (FORMAT_ONLY_PATTERN.test(combined) || FORMAT_ONLY_PATTERN.test(input.commitMessage ?? "")) &&
      !hasAnyPositiveContentSignal(combined),
    weight: -4.0,
    signal: "negative",
    detail: () => "Change appears to be formatting or style-only.",
    suggested_type: null,
  },
  {
    name: "dependency_bump",
    test: (input, combined) =>
      DEP_BUMP_PATTERN.test(combined) &&
      (input.changedFiles ?? []).length > 0 &&
      (input.changedFiles ?? []).every((f) => DEP_FILE_PATTERN.test(f)),
    weight: -4.0,
    signal: "negative",
    detail: () => "Change is a dependency version bump with only lock/manifest file changes.",
    suggested_type: null,
  },
  {
    name: "typo_fix",
    test: (input, combined) => TYPO_PATTERN.test(combined) && (input.changedFiles ?? []).length <= 2,
    weight: -3.5,
    signal: "negative",
    detail: () => "Change is a simple typo fix across few files.",
    suggested_type: null,
  },
  {
    name: "debug_only",
    test: (_input, combined) => DEBUG_PATTERN.test(combined),
    weight: -3.0,
    signal: "negative",
    detail: () => "Change appears to be debug logging or temporary one-off work.",
    suggested_type: null,
  },
  {
    name: "single_line_change",
    test: (input) =>
      parseDiffStatTotalLines(input.diffStat ?? "") <= 3 && parseDiffStatTotalLines(input.diffStat ?? "") > 0,
    weight: -2.5,
    signal: "negative",
    detail: (input) => `Diff stat shows only ${parseDiffStatTotalLines(input.diffStat ?? "")} line(s) changed.`,
    suggested_type: null,
  },
  {
    name: "snapshot_update",
    test: (input) =>
      (input.changedFiles ?? []).length > 0 && (input.changedFiles ?? []).every((f) => SNAPSHOT_PATTERN.test(f)),
    weight: -4.0,
    signal: "negative",
    detail: () => "All changed files are test snapshots.",
    suggested_type: null,
  },
  {
    name: "ci_config_only",
    test: (input, combined) =>
      (input.changedFiles ?? []).length > 0 &&
      (input.changedFiles ?? []).every((f) => CI_CONFIG_PATTERN.test(f)) &&
      !hasAnyPositiveContentSignal(combined),
    weight: -2.0,
    signal: "negative",
    detail: () => "Only CI/CD config files changed without learning signals in the summary.",
    suggested_type: null,
  },
  {
    name: "merge_commit",
    test: (input) => MERGE_COMMIT_PATTERN.test(input.commitMessage ?? ""),
    weight: -3.0,
    signal: "negative",
    detail: () => "Commit is a merge commit.",
    suggested_type: null,
  },
  {
    name: "revert_commit",
    test: (input) => REVERT_PATTERN.test(input.commitMessage ?? ""),
    weight: -3.0,
    signal: "negative",
    detail: () => "Commit is a revert.",
    suggested_type: null,
  },
  {
    name: "rename_only",
    test: (input, combined) => RENAME_ONLY_PATTERN.test(combined) && !hasAnyPositiveContentSignal(combined),
    weight: -3.0,
    signal: "negative",
    detail: () => "Change appears to be a rename-only operation.",
    suggested_type: null,
  },
  {
    name: "empty_or_trivial_input",
    test: (_input, combined) => approximateTokenCount(combined) < 12,
    weight: -5.0,
    signal: "negative",
    detail: () => "Input is too short to contain durable learning.",
    suggested_type: null,
  },
];

const PHASE_COMPLETION_DIFF_THRESHOLD = 30;
const PHASE_COMPLETION_FILE_THRESHOLD = 4;

const PHASE_BOOST_MAX = 1.5;

interface PhaseCompletionRule {
  name: string;
  category: PhaseCompletionSignal["category"];
  test: (input: ExtractSuggestionInput, combined: string) => boolean;
  boost: number;
  detail: (input: ExtractSuggestionInput) => string;
}

const PHASE_COMPLETION_RULES: PhaseCompletionRule[] = [
  {
    name: "user_phase_done",
    category: "user_text",
    test: (input) => {
      const text = input.task ?? "";
      if (WEAK_ACKNOWLEDGMENT_PATTERN.test(text.trim())) return false;
      return USER_PHASE_DONE_PATTERN.test(text);
    },
    boost: 1.0,
    detail: () => "User indicated phase completion (e.g. '好了', 'move on', 'this part is done').",
  },
  {
    name: "agent_phase_done",
    category: "agent_text",
    test: (input) => {
      const text = input.sessionSummary ?? "";
      return AGENT_PHASE_DONE_PATTERN.test(text);
    },
    boost: 1.0,
    detail: () => "Agent summary indicates completion (e.g. '已完成', 'implementation complete').",
  },
  {
    name: "test_status_improvement",
    category: "test_status",
    test: (input) => {
      const text = input.testResultSummary ?? "";
      return TEST_STATUS_IMPROVEMENT_PATTERN.test(text);
    },
    boost: 1.2,
    detail: () => "Test status improved from fail to pass.",
  },
  {
    name: "diff_scope_threshold",
    category: "diff_scope",
    test: (input) => {
      const lines = parseDiffStatTotalLines(input.diffStat ?? "");
      const files = (input.changedFiles ?? []).length;
      return lines >= PHASE_COMPLETION_DIFF_THRESHOLD || files >= PHASE_COMPLETION_FILE_THRESHOLD;
    },
    boost: 0.8,
    detail: (input) => {
      const lines = parseDiffStatTotalLines(input.diffStat ?? "");
      const files = (input.changedFiles ?? []).length;
      return `Diff scope exceeds phase-completion threshold (${lines} lines, ${files} files).`;
    },
  },
];

function detectPhaseCompletionSignals(input: ExtractSuggestionInput, combined: string): PhaseCompletionSignal[] {
  const signals: PhaseCompletionSignal[] = [];
  for (const rule of PHASE_COMPLETION_RULES) {
    if (rule.test(input, combined)) {
      signals.push({
        name: rule.name,
        category: rule.category,
        detail: rule.detail(input),
        boost: rule.boost,
      });
    }
  }
  return signals;
}

function computePhaseBoost(signals: PhaseCompletionSignal[]): number {
  if (signals.length === 0) return 0;
  const raw = signals.reduce((sum, s) => sum + s.boost, 0);
  return Math.min(raw, PHASE_BOOST_MAX);
}

export function evaluateExtractWorthiness(input: ExtractSuggestionInput): ExtractSuggestionResult {
  const combined = buildCombinedText(input);
  const evidence: ExtractSuggestionEvidence[] = [];
  const suppressions: ExtractSuggestionSuppression[] = [];
  const reasons: string[] = [];

  for (const rule of POSITIVE_RULES) {
    if (rule.test(input, combined)) {
      evidence.push({
        rule: rule.name,
        signal: rule.signal,
        weight: rule.weight,
        detail: rule.detail(input),
        suggested_type: rule.suggested_type,
      });
    }
  }

  for (const rule of NEGATIVE_RULES) {
    if (rule.test(input, combined)) {
      evidence.push({
        rule: rule.name,
        signal: rule.signal,
        weight: rule.weight,
        detail: rule.detail(input),
        suggested_type: null,
      });
      suppressions.push({
        rule: rule.name,
        detail: rule.detail(input),
      });
    }
  }

  const positiveScore = evidence.filter((e) => e.signal === "positive").reduce((sum, e) => sum + e.weight, 0);
  const negativeScore = evidence.filter((e) => e.signal === "negative").reduce((sum, e) => sum + e.weight, 0);

  const phaseSignals = detectPhaseCompletionSignals(input, combined);
  const phaseBoost = computePhaseBoost(phaseSignals);

  const baseScore = positiveScore + negativeScore;
  const boostedScore = baseScore + phaseBoost;

  let should_extract: boolean;
  let confidence: number;

  if (boostedScore >= POSITIVE_THRESHOLD) {
    if (positiveScore <= 0 && phaseBoost > 0) {
      should_extract = false;
      confidence = clamp(0.3 + phaseBoost * 0.1, 0.1, 0.45);
      reasons.push("Phase completion detected but no content-value signals present; extraction suppressed.");
      suppressions.push({
        rule: "phase_completion_without_content_value",
        detail: "Phase-completion signals alone are insufficient without positive content evidence.",
      });
    } else {
      should_extract = true;
      confidence = clamp(boostedScore / MAX_CONFIDENCE_SCORE, 0.5, 0.95);
      if (phaseBoost > 0 && baseScore < POSITIVE_THRESHOLD) {
        reasons.push("Phase-completion signals boosted confidence past the extraction threshold.");
      } else {
        reasons.push("Positive signals exceed the extraction threshold.");
      }
      if (phaseBoost > 0) {
        reasons.push(`${phaseSignals.length} phase-completion signal(s) contributed +${phaseBoost.toFixed(1)} boost.`);
      }
    }
  } else if (boostedScore <= NEGATIVE_THRESHOLD) {
    should_extract = false;
    confidence = clamp(Math.abs(boostedScore) / MAX_NEGATIVE_CONFIDENCE_SCORE, 0.5, 0.95);
    reasons.push("Negative signals indicate low-value change.");
    if (phaseBoost > 0) {
      reasons.push("Phase-completion signals detected but insufficient to overcome negative evidence.");
    }
  } else {
    should_extract = false;
    confidence = clamp(0.3 + Math.abs(boostedScore) * 0.05, 0.1, 0.45);
    reasons.push("Signals are ambiguous; manual judgment recommended.");
    if (phaseBoost > 0) {
      reasons.push(`${phaseSignals.length} phase-completion signal(s) detected but total score remains ambiguous.`);
    }
  }

  const suggested_type = pickSuggestedType(evidence);

  if (should_extract && suggested_type) {
    reasons.push(`Strongest signal suggests extracting a "${suggested_type}" memory.`);
  }

  if (suppressions.length > 0 && should_extract) {
    reasons.push(`${suppressions.length} suppression signal(s) detected but overridden by stronger positive evidence.`);
  }

  const summary = buildSummary(should_extract, confidence, suggested_type, reasons, evidence, phaseSignals);

  return {
    should_extract,
    confidence,
    suggested_type,
    reasons,
    evidence,
    suppressions,
    phase_completion_signals: phaseSignals,
    summary,
  };
}

export function renderExtractSuggestionMarkdown(result: ExtractSuggestionResult): string {
  const lines: string[] = [
    "# Extract Suggestion",
    "",
    `**Should extract:** ${result.should_extract ? "yes" : "no"}`,
    `**Confidence:** ${(result.confidence * 100).toFixed(0)}%`,
    `**Suggested type:** ${result.suggested_type ?? "none"}`,
    "",
  ];

  if (result.reasons.length > 0) {
    lines.push("## Reasons");
    for (const reason of result.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }

  if (result.evidence.length > 0) {
    lines.push("## Evidence");
    for (const entry of result.evidence) {
      const signalMark = entry.signal === "positive" ? "+" : entry.signal === "negative" ? "-" : "~";
      lines.push(`- [${signalMark}${Math.abs(entry.weight).toFixed(1)}] ${entry.rule}: ${entry.detail}`);
    }
    lines.push("");
  }

  if (result.suppressions.length > 0) {
    lines.push("## Suppressions");
    for (const entry of result.suppressions) {
      lines.push(`- ${entry.rule}: ${entry.detail}`);
    }
    lines.push("");
  }

  if (result.phase_completion_signals.length > 0) {
    lines.push("## Phase Completion Signals");
    for (const entry of result.phase_completion_signals) {
      lines.push(`- [+${entry.boost.toFixed(1)}] ${entry.name} (${entry.category}): ${entry.detail}`);
    }
    lines.push("");
  }

  lines.push(`## Summary`);
  lines.push(result.summary);

  return lines.join("\n");
}

export function renderExtractSuggestionJson(result: ExtractSuggestionResult): string {
  return JSON.stringify(result, null, 2);
}

function buildCombinedText(input: ExtractSuggestionInput): string {
  return [
    input.task ?? "",
    input.sessionSummary ?? "",
    input.commitMessage ?? "",
    input.testResultSummary ?? "",
    input.diffStat ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function hasAnyPositiveContentSignal(text: string): boolean {
  return (
    DECISION_PATTERN.test(text) ||
    RISK_PATTERN.test(text) ||
    CONVENTION_PATTERN.test(text) ||
    PATTERN_PATTERN.test(text) ||
    GOAL_PATTERN.test(text) ||
    CAUSE_PATTERN.test(text) ||
    CONSTRAINT_PATTERN.test(text)
  );
}

function pickSuggestedType(evidence: ExtractSuggestionEvidence[]): MemoryType | null {
  const positiveWithType = evidence
    .filter((e) => e.signal === "positive" && e.suggested_type !== null)
    .sort((a, b) => b.weight - a.weight);

  return positiveWithType[0]?.suggested_type ?? null;
}

function countDistinctTopDirs(files: string[]): number {
  const dirs = new Set<string>();
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    const firstSlash = normalized.indexOf("/");
    if (firstSlash > 0) {
      dirs.add(normalized.slice(0, firstSlash).toLowerCase());
    } else {
      dirs.add(".");
    }
  }
  return dirs.size;
}

function parseDiffStatTotalLines(diffStat: string): number {
  if (!diffStat.trim()) {
    return 0;
  }

  let total = 0;
  const linePattern = /(\d+)\s+insertion|(\d+)\s+deletion/gu;
  for (const match of diffStat.matchAll(linePattern)) {
    total += Number(match[1] ?? match[2] ?? 0);
  }

  if (total > 0) {
    return total;
  }

  const numPattern = /\|\s+(\d+)/gu;
  for (const match of diffStat.matchAll(numPattern)) {
    total += Number(match[1] ?? 0);
  }

  return total;
}

function approximateTokenCount(text: string): number {
  let asciiChars = 0;
  let nonAsciiTokens = 0;

  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiTokens += 1;
    }
  }

  return Math.ceil(asciiChars / 4) + nonAsciiTokens;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildSummary(
  should_extract: boolean,
  confidence: number,
  suggested_type: MemoryType | null,
  reasons: string[],
  evidence: ExtractSuggestionEvidence[],
  phaseSignals: PhaseCompletionSignal[] = [],
): string {
  const positiveCount = evidence.filter((e) => e.signal === "positive").length;
  const negativeCount = evidence.filter((e) => e.signal === "negative").length;
  const phaseSuffix = phaseSignals.length > 0 ? ` ${phaseSignals.length} phase-completion signal(s).` : "";

  if (should_extract) {
    const typeHint = suggested_type ? ` as "${suggested_type}"` : "";
    return `Recommend extracting durable memory${typeHint} (${(confidence * 100).toFixed(0)}% confidence). ${positiveCount} positive signal(s), ${negativeCount} suppression(s).${phaseSuffix}`;
  }

  if (confidence >= 0.5) {
    return `Extraction not recommended (${(confidence * 100).toFixed(0)}% confidence). ${negativeCount} suppression signal(s) outweigh ${positiveCount} positive signal(s).${phaseSuffix}`;
  }

  return `Ambiguous signals (${(confidence * 100).toFixed(0)}% confidence). ${reasons[0] ?? "Consider manual judgment."}${phaseSuffix}`;
}
