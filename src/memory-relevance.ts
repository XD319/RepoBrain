import type { Importance, InvocationMode, Memory, RiskLevel } from "./types.js";

export interface MemorySelectionOptions {
  task?: string;
  paths?: string[];
  modules?: string[];
}

export interface MemorySelectionMatch {
  score: number;
  reasons: string[];
}

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

export function scoreMemoryForSelection(memory: Memory, rawOptions: MemorySelectionOptions): MemorySelectionMatch {
  const options = normalizeSelectionOptions(rawOptions);
  const reasons: string[] = [];
  let score = IMPORTANCE_WEIGHT[memory.importance];

  const pathScopeReasons = matchPathPatterns(options.paths ?? [], memory.path_scope ?? [], "path scope");
  const pathTriggerReasons = matchPathPatterns(
    options.paths ?? [],
    memory.skill_trigger_paths ?? [],
    "skill trigger path",
  );
  const taskTriggerReasons = options.task
    ? matchTaskTriggers(options.task, memory.skill_trigger_tasks ?? [], "task trigger")
    : [];
  const taskKeywordReason = options.task ? buildTaskKeywordReason(options.task, memory) : null;
  const moduleReason = buildModuleReason(options.modules ?? [], memory);

  if (pathScopeReasons.length > 0) {
    reasons.push(...pathScopeReasons);
    score += pathScopeReasons.length * 8;
  }

  if (pathTriggerReasons.length > 0) {
    reasons.push(...pathTriggerReasons);
    score += pathTriggerReasons.length * 7;
  }

  if (taskTriggerReasons.length > 0) {
    reasons.push(...taskTriggerReasons);
    score += taskTriggerReasons.length * 7;
  }

  if (taskKeywordReason) {
    reasons.push(taskKeywordReason);
    score += 5;
  }

  if (moduleReason) {
    reasons.push(moduleReason);
    score += 4;
  }

  if (reasons.length > 0) {
    score += RISK_WEIGHT[memory.risk_level ?? "low"];
    score += INVOCATION_WEIGHT[memory.invocation_mode ?? "optional"];

    if (hasRoutingMetadata(memory)) {
      score += 2;
    }
  }

  return {
    score,
    reasons,
  };
}

export function matchTaskTriggers(task: string, triggers: string[], label: string = "task"): string[] {
  const normalizedTask = normalizeText(task);
  if (!normalizedTask) {
    return [];
  }

  return triggers
    .filter((trigger) => isTaskTriggerMatch(normalizedTask, normalizeText(trigger)))
    .map((trigger) => `${label}: ${trigger}`);
}

export function matchPathPatterns(paths: string[], patterns: string[], label: string = "path"): string[] {
  if (paths.length === 0) {
    return [];
  }

  const reasons: string[] = [];

  for (const pattern of patterns) {
    const matchedPaths = paths.filter((item) => isPathTriggerMatch(item, pattern));
    if (matchedPaths.length === 0) {
      continue;
    }

    reasons.push(`${label}: ${toDisplayPath(pattern)} -> ${matchedPaths.join(", ")}`);
  }

  return reasons;
}

export function normalizePaths(values: string[]): string[] {
  return values.map((value) => normalizePath(value)).filter(Boolean);
}

export function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").toLowerCase();
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTerms(values: string[]): string[] {
  return values.map((value) => normalizeText(value)).filter(Boolean);
}

function buildTaskKeywordReason(task: string, memory: Memory): string | null {
  const taskTokens = new Set(normalizeText(task).split(" ").filter(Boolean));
  if (taskTokens.size === 0) {
    return null;
  }

  const memoryTokens = new Set(
    normalizeText([memory.title, memory.summary, memory.tags.join(" "), extractScopeText(memory.detail)].join(" "))
      .split(" ")
      .filter(Boolean),
  );

  const matched = Array.from(taskTokens)
    .filter((token) => token.length >= 3 && memoryTokens.has(token))
    .slice(0, 3);
  if (matched.length === 0) {
    return null;
  }

  return `task keywords: ${matched.join(", ")}`;
}

function buildModuleReason(modules: string[], memory: Memory): string | null {
  if (modules.length === 0) {
    return null;
  }

  const haystack = normalizeText(
    [
      memory.title,
      memory.summary,
      memory.tags.join(" "),
      (memory.path_scope ?? []).join(" "),
      (memory.skill_trigger_paths ?? []).join(" "),
      extractScopeText(memory.detail),
    ].join(" "),
  );

  if (!haystack) {
    return null;
  }

  const matched = modules.filter((item) => haystack.includes(item)).slice(0, 3);
  if (matched.length === 0) {
    return null;
  }

  return `module scope: ${matched.join(", ")}`;
}

function extractScopeText(detail: string): string {
  return detail
    .replace(/^##\s+\w+\s*/m, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function hasRoutingMetadata(memory: Memory): boolean {
  return Boolean(
    (memory.path_scope ?? []).length > 0 ||
    (memory.recommended_skills ?? []).length > 0 ||
    (memory.required_skills ?? []).length > 0 ||
    (memory.suppressed_skills ?? []).length > 0 ||
    (memory.skill_trigger_paths ?? []).length > 0 ||
    (memory.skill_trigger_tasks ?? []).length > 0 ||
    (memory.invocation_mode ?? "optional") !== "optional" ||
    (memory.risk_level ?? "low") !== "low",
  );
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

function toDisplayPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
