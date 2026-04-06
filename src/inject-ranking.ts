import { computeInjectPriorityReport } from "./memory-priority.js";
import type { GitContext } from "./inject.js";
import type { Memory, MemoryArea, RiskLevel } from "./types.js";

export interface MemorySelectionOptions {
  task?: string;
  paths?: string[];
  modules?: string[];
}

export interface InjectScoreComponent {
  key:
    | "task_phrase_match"
    | "task_keyword_overlap"
    | "module_overlap"
    | "path_scope_match"
    | "skill_trigger_path_match"
    | "git_changed_files_match"
    | "branch_tag_hint"
    | "importance_adjustment"
    | "risk_adjustment"
    | "recency_adjustment"
    | "hit_count_adjustment"
    | "quality_adjustment";
  label: string;
  score: number;
  detail: string;
}

export interface InjectScoreReport {
  contextScore: number;
  priorityScore: number;
  totalScore: number;
  reasons: string[];
  components: InjectScoreComponent[];
  coverage: {
    modules: string[];
    paths: string[];
    risks: string[];
    types: string[];
  };
  signatures: string[];
}

export interface RankedMemoryCandidate {
  relativePath: string;
  memory: Memory;
  report: InjectScoreReport;
  tokenCost: number;
}

export interface DiversitySelectionDecision {
  diversityBonus: number;
  redundancyPenalty: number;
  novelty: string[];
  redundancy: string[];
  utilityScore: number;
}

const DEFAULT_AREA_PATH_HINTS: Record<MemoryArea, string[]> = {
  auth: ["src/auth/**", "src/security/**", "auth/**"],
  api: ["src/api/**", "src/routes/**", "src/controllers/**", "api/**"],
  db: ["src/db/**", "src/database/**", "migrations/**", "prisma/**"],
  infra: ["infra/**", ".github/**", "scripts/**", "src/cli/**", "config/**"],
  ui: ["src/ui/**", "src/web/**", "src/components/**", "app/**"],
  testing: ["test/**", "tests/**", "__tests__/**", "fixtures/**"],
  general: [],
};

const RISK_SELECTION_BONUS: Record<RiskLevel, number> = {
  high: 6,
  medium: 4,
  low: 2,
};

const TASK_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "before",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function hasSelectionContext(options: MemorySelectionOptions): boolean {
  return Boolean(
    options.task?.trim() ||
    (options.paths ?? []).some((value) => value.trim()) ||
    (options.modules ?? []).some((value) => value.trim()),
  );
}

export function normalizeSelectionOptions(options: MemorySelectionOptions): MemorySelectionOptions {
  const task = options.task?.trim();
  const paths = normalizePaths(options.paths ?? []);
  const modules = normalizeTerms(options.modules ?? []);

  return {
    ...(task ? { task } : {}),
    paths,
    modules,
  };
}

export function buildInjectScoreReport(
  memory: Memory,
  rawOptions: MemorySelectionOptions,
  gitContext: GitContext,
): InjectScoreReport {
  const options = normalizeSelectionOptions(rawOptions);
  const components: InjectScoreComponent[] = [];
  const reasons: string[] = [];

  const taskPhrase = buildTaskPhraseComponent(memory, options.task);
  pushComponent(components, reasons, taskPhrase);

  const taskKeywords = buildTaskKeywordComponent(memory, options.task);
  pushComponent(components, reasons, taskKeywords);

  const moduleOverlap = buildModuleComponent(memory, options.modules ?? []);
  pushComponent(components, reasons, moduleOverlap);

  const pathScope = buildPathComponent(
    "path_scope_match",
    "Path Scope Match",
    options.paths ?? [],
    memory.path_scope ?? [],
  );
  pushComponent(components, reasons, pathScope);

  const skillTriggerPath = buildPathComponent(
    "skill_trigger_path_match",
    "Skill Trigger Path Match",
    options.paths ?? [],
    memory.skill_trigger_paths ?? [],
  );
  pushComponent(components, reasons, skillTriggerPath);

  const gitChangedFiles = buildGitChangedFilesComponent(memory, gitContext);
  pushComponent(components, reasons, gitChangedFiles);

  const branchHint = buildBranchHintComponent(memory, gitContext.branchName);
  pushComponent(components, reasons, branchHint);

  const priority = computeInjectPriorityReport(memory);
  const priorityComponents: InjectScoreComponent[] = [
    {
      key: "importance_adjustment",
      label: "Importance Adjustment",
      score: priority.importanceAdjustment,
      detail: `importance=${memory.importance}`,
    },
    {
      key: "risk_adjustment",
      label: "Risk Adjustment",
      score: priority.riskAdjustment,
      detail: `risk=${memory.risk_level ?? "low"}`,
    },
    {
      key: "recency_adjustment",
      label: "Recency Adjustment",
      score: priority.recencyAdjustment,
      detail: priority.recencyLabel,
    },
    {
      key: "hit_count_adjustment",
      label: "Hit Count Adjustment",
      score: priority.hitCountAdjustment,
      detail: `hit_count=${memory.hit_count}`,
    },
    {
      key: "quality_adjustment",
      label: "Quality Adjustment",
      score: priority.qualityAdjustment,
      detail: `score=${memory.score}`,
    },
  ];

  components.push(...priorityComponents);

  const contextScore = roundScore(
    components
      .filter(
        (component) =>
          ![
            "importance_adjustment",
            "risk_adjustment",
            "recency_adjustment",
            "hit_count_adjustment",
            "quality_adjustment",
          ].includes(component.key),
      )
      .reduce((sum, component) => sum + component.score, 0),
  );
  const priorityScore = roundScore(priority.total);
  const totalScore = roundScore(contextScore + priorityScore);

  return {
    contextScore,
    priorityScore,
    totalScore,
    reasons,
    components,
    coverage: {
      modules: collectModuleCoverage(memory),
      paths: collectPathCoverage(memory),
      risks: [memory.risk_level ?? "low"],
      types: [memory.type],
    },
    signatures: collectSignatures(memory),
  };
}

export function explainSelectionDecision(
  candidate: RankedMemoryCandidate,
  selected: RankedMemoryCandidate[],
): DiversitySelectionDecision {
  const novelty: string[] = [];
  let diversityBonus = 0;

  if (!hasCoverage(selected, candidate.report.coverage.modules, "modules")) {
    novelty.push(`new module coverage: ${candidate.report.coverage.modules.join(", ") || "general"}`);
    diversityBonus += 8;
  }

  if (!hasCoverage(selected, candidate.report.coverage.paths, "paths")) {
    novelty.push(`new path scope: ${candidate.report.coverage.paths.join(", ") || "unscoped"}`);
    diversityBonus += 6;
  }

  if (!hasCoverage(selected, candidate.report.coverage.types, "types")) {
    novelty.push(`new memory type: ${candidate.report.coverage.types.join(", ")}`);
    diversityBonus += 3;
  }

  if (!hasCoverage(selected, candidate.report.coverage.risks, "risks")) {
    const risk = candidate.memory.risk_level ?? "low";
    novelty.push(`new risk surface: ${risk}`);
    diversityBonus += RISK_SELECTION_BONUS[risk];
  }

  let redundancyPenalty = 0;
  const redundancy: string[] = [];
  for (const prior of selected) {
    const similarity = computeSimilarity(candidate, prior);
    if (similarity < 0.35) {
      continue;
    }

    const penalty = roundScore(similarity * 14);
    redundancyPenalty += penalty;
    redundancy.push(`${prior.memory.title} (${penalty.toFixed(1)})`);
  }

  const utilityScore = roundScore(candidate.report.totalScore + diversityBonus - redundancyPenalty);

  return {
    diversityBonus: roundScore(diversityBonus),
    redundancyPenalty: roundScore(redundancyPenalty),
    novelty,
    redundancy,
    utilityScore,
  };
}

export function formatCompactReasons(reasons: string[], limit: number = 2): string[] {
  const preferredLabels = [
    "Task Phrase Match",
    "Module Overlap",
    "Path Scope Match",
    "Skill Trigger Path Match",
    "Git Changed Files Match",
    "Branch / Tag Hint",
    "Task Keyword Overlap",
  ];
  const selected: string[] = [];

  for (const label of preferredLabels) {
    const match = reasons.find((reason) => reason.startsWith(`${label}:`));
    if (match && !selected.includes(match)) {
      selected.push(match);
    }

    if (selected.length >= Math.max(1, limit)) {
      return selected;
    }
  }

  for (const reason of reasons) {
    if (!selected.includes(reason)) {
      selected.push(reason);
    }

    if (selected.length >= Math.max(1, limit)) {
      return selected;
    }
  }

  return selected;
}

export function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").toLowerCase();
}

function buildTaskPhraseComponent(memory: Memory, task: string | undefined): InjectScoreComponent | null {
  if (!task) {
    return null;
  }

  const matches = (memory.skill_trigger_tasks ?? []).filter((trigger) =>
    isTaskTriggerMatch(normalizeText(task), normalizeText(trigger)),
  );
  if (matches.length === 0) {
    return null;
  }

  const score = Math.min(34, 26 + (matches.length - 1) * 4);
  return {
    key: "task_phrase_match",
    label: "Task Phrase Match",
    score,
    detail: matches.slice(0, 3).join(", "),
  };
}

function buildTaskKeywordComponent(memory: Memory, task: string | undefined): InjectScoreComponent | null {
  if (!task) {
    return null;
  }

  const taskTokens = tokenizeText(task).filter((token) => token.length >= 3 && !TASK_STOP_WORDS.has(token));
  if (taskTokens.length === 0) {
    return null;
  }

  const memoryTokens = new Set(
    tokenizeText([memory.title, memory.summary, memory.tags.join(" "), extractScopeText(memory.detail)].join(" ")),
  );
  const matched = unique(taskTokens.filter((token) => memoryTokens.has(token))).slice(0, 4);
  if (matched.length === 0) {
    return null;
  }

  return {
    key: "task_keyword_overlap",
    label: "Task Keyword Overlap",
    score: matched.length * 4,
    detail: matched.join(", "),
  };
}

function buildModuleComponent(memory: Memory, modules: string[]): InjectScoreComponent | null {
  if (modules.length === 0) {
    return null;
  }

  const memoryModules = new Set(collectModuleCoverage(memory));
  const matched = unique(modules.filter((module) => memoryModules.has(module))).slice(0, 4);
  if (matched.length === 0) {
    return null;
  }

  return {
    key: "module_overlap",
    label: "Module Overlap",
    score: Math.min(16, 10 + (matched.length - 1) * 2),
    detail: matched.join(", "),
  };
}

function buildPathComponent(
  key: "path_scope_match" | "skill_trigger_path_match",
  label: string,
  candidatePaths: string[],
  patterns: string[],
): InjectScoreComponent | null {
  if (candidatePaths.length === 0 || patterns.length === 0) {
    return null;
  }

  const matchedPatterns = patterns
    .map((pattern) => ({
      pattern,
      matchedPaths: candidatePaths.filter((candidatePath) => isPathTriggerMatch(candidatePath, pattern)),
    }))
    .filter((entry) => entry.matchedPaths.length > 0);

  if (matchedPatterns.length === 0) {
    return null;
  }

  return {
    key,
    label,
    score: key === "path_scope_match" ? matchedPatterns.length * 12 : matchedPatterns.length * 10,
    detail: matchedPatterns
      .slice(0, 3)
      .map((entry) => `${toDisplayPath(entry.pattern)} -> ${entry.matchedPaths.join(", ")}`)
      .join(" | "),
  };
}

function buildGitChangedFilesComponent(memory: Memory, gitContext: GitContext): InjectScoreComponent | null {
  const changedFiles = normalizePaths(gitContext.changedFiles ?? []);
  if (changedFiles.length === 0) {
    return null;
  }

  const directPatterns = unique([...(memory.files ?? []), ...(memory.path_scope ?? [])]);
  const directMatches = directPatterns
    .map((pattern) => ({
      pattern,
      matchedFiles: changedFiles.filter((filePath) => isPathTriggerMatch(filePath, pattern)),
    }))
    .filter((entry) => entry.matchedFiles.length > 0);

  const areaPatterns = resolveAreaPathHints(memory.area);
  const areaMatches = areaPatterns
    .map((pattern) => ({
      pattern,
      matchedFiles: changedFiles.filter((filePath) => isPathTriggerMatch(filePath, pattern)),
    }))
    .filter((entry) => entry.matchedFiles.length > 0);

  if (directMatches.length === 0 && areaMatches.length === 0) {
    return null;
  }

  const score = Math.min(26, directMatches.length * 12 + areaMatches.length * 6);
  const detailParts: string[] = [];

  if (directMatches.length > 0) {
    detailParts.push(
      `direct=${directMatches
        .slice(0, 2)
        .map((entry) => `${toDisplayPath(entry.pattern)} -> ${entry.matchedFiles.join(", ")}`)
        .join(" | ")}`,
    );
  }

  if (areaMatches.length > 0) {
    detailParts.push(
      `area=${areaMatches
        .slice(0, 2)
        .map((entry) => `${toDisplayPath(entry.pattern)} -> ${entry.matchedFiles.join(", ")}`)
        .join(" | ")}`,
    );
  }

  return {
    key: "git_changed_files_match",
    label: "Git Changed Files Match",
    score,
    detail: detailParts.join(" ; "),
  };
}

function buildBranchHintComponent(memory: Memory, branchName: string): InjectScoreComponent | null {
  const normalizedBranch = normalizeText(branchName);
  if (!normalizedBranch) {
    return null;
  }

  const branchTokens = new Set(tokenizeText(branchName));
  const memoryHints = new Set(tokenizeText([memory.tags.join(" "), memory.title, memory.area ?? ""].join(" ")));
  const matched = unique(Array.from(branchTokens).filter((token) => token.length >= 3 && memoryHints.has(token))).slice(
    0,
    3,
  );
  if (matched.length === 0) {
    return null;
  }

  return {
    key: "branch_tag_hint",
    label: "Branch / Tag Hint",
    score: matched.length * 4,
    detail: `${branchName} -> ${matched.join(", ")}`,
  };
}

function collectModuleCoverage(memory: Memory): string[] {
  const pathHints = [...(memory.path_scope ?? []), ...(memory.skill_trigger_paths ?? []), ...(memory.files ?? [])]
    .flatMap((value) => normalizePath(value).split("/"))
    .filter((segment) => segment.length >= 3 && !segment.includes("*"));
  return unique(
    [
      ...(memory.tags ?? []).map((tag) => normalizeText(tag)),
      ...(memory.area ? [memory.area] : []),
      ...pathHints,
    ].filter(Boolean),
  ).slice(0, 6);
}

function collectPathCoverage(memory: Memory): string[] {
  return unique(
    [
      ...(memory.path_scope ?? []).map(pathFamilyFromPattern),
      ...(memory.files ?? []).map(pathFamilyFromPattern),
      ...(memory.area ? resolveAreaPathHints(memory.area).map(pathFamilyFromPattern) : []),
    ].filter(Boolean),
  ).slice(0, 4);
}

function collectSignatures(memory: Memory): string[] {
  return unique([
    ...collectModuleCoverage(memory).map((value) => `module:${value}`),
    ...collectPathCoverage(memory).map((value) => `path:${value}`),
    `type:${memory.type}`,
    `risk:${memory.risk_level ?? "low"}`,
    ...(memory.area ? [`area:${memory.area}`] : []),
    ...(memory.tags ?? []).slice(0, 4).map((tag) => `tag:${normalizeText(tag)}`),
  ]);
}

function hasCoverage(
  selected: RankedMemoryCandidate[],
  values: string[],
  key: keyof InjectScoreReport["coverage"],
): boolean {
  if (values.length === 0) {
    return selected.length > 0;
  }

  const selectedValues = new Set(selected.flatMap((entry) => entry.report.coverage[key]));
  return values.some((value) => selectedValues.has(value));
}

function computeSimilarity(left: RankedMemoryCandidate, right: RankedMemoryCandidate): number {
  const leftSet = new Set(left.report.signatures);
  const rightSet = new Set(right.report.signatures);
  const overlap = Array.from(leftSet).filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union === 0 ? 0 : overlap / union;
}

function resolveAreaPathHints(area: MemoryArea | undefined): string[] {
  if (!area) {
    return [];
  }

  return DEFAULT_AREA_PATH_HINTS[area] ?? [];
}

function pathFamilyFromPattern(pattern: string): string {
  const normalized = normalizePath(pattern).replace(/[*?].*$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(0, 2).join("/") || normalized;
}

function extractScopeText(detail: string): string {
  return detail
    .replace(/^##\s+\w+\s*/m, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function pushComponent(
  components: InjectScoreComponent[],
  reasons: string[],
  component: InjectScoreComponent | null,
): void {
  if (!component || component.score <= 0) {
    return;
  }

  components.push(component);
  reasons.push(`${component.label}: ${component.detail}`);
}

function isTaskTriggerMatch(normalizedTask: string, normalizedTrigger: string): boolean {
  if (!normalizedTrigger) {
    return false;
  }

  if (normalizedTask.includes(normalizedTrigger) || normalizedTrigger.includes(normalizedTask)) {
    return true;
  }

  const taskTokens = new Set(normalizedTask.split(" ").filter(Boolean));
  const triggerTokens = normalizedTrigger.split(" ").filter(Boolean);
  if (triggerTokens.length === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of triggerTokens) {
    if (taskTokens.has(token)) {
      overlap += 1;
    }
  }

  const minimumOverlap =
    triggerTokens.length >= 4 ? Math.ceil(triggerTokens.length * 0.6) : Math.min(triggerTokens.length, 2);

  return overlap >= minimumOverlap;
}

function isPathTriggerMatch(candidatePath: string, pattern: string): boolean {
  const normalizedPath = normalizePath(candidatePath);
  const normalizedPattern = normalizePath(pattern);
  if (!normalizedPattern) {
    return false;
  }

  if (hasGlobSyntax(normalizedPattern)) {
    const regex = globToRegExp(normalizedPattern);
    return regex.test(normalizedPath);
  }

  if (normalizedPath === normalizedPattern) {
    return true;
  }

  if (normalizedPattern.endsWith("/")) {
    return normalizedPath.startsWith(normalizedPattern);
  }

  return normalizedPath.includes(normalizedPattern);
}

function hasGlobSyntax(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function globToRegExp(pattern: string): RegExp {
  let regexSource = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const nextCharacter = pattern[index + 1];
    if (character === undefined) {
      continue;
    }

    if (character === "*" && nextCharacter === "*") {
      regexSource += ".*";
      index += 1;
      continue;
    }

    if (character === "*") {
      regexSource += "[^\\n]*";
      continue;
    }

    if (character === "?") {
      regexSource += "[^/]";
      continue;
    }

    regexSource += escapeRegExp(character);
  }

  regexSource += "$";
  return new RegExp(regexSource, "i");
}

function normalizePaths(values: string[]): string[] {
  return values.map((value) => normalizePath(value)).filter(Boolean);
}

function normalizeTerms(values: string[]): string[] {
  return values.map((value) => normalizeText(value)).filter(Boolean);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeText(value: string): string[] {
  return normalizeText(value).split(" ").filter(Boolean);
}

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
