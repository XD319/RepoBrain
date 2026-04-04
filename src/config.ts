import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { BrainConfig, ExtractMode, WorkflowMode } from "./types.js";
import { EXTRACT_MODES, WORKFLOW_MODES } from "./types.js";

export interface WorkflowPreset {
  mode: WorkflowMode;
  label: string;
  audience: string;
  automationLevel: string;
  risk: string;
  extractMode: ExtractMode;
  sweepOnInject: boolean;
  gitHookDefault: boolean;
  autoApproveSafeCandidates: boolean;
}

export const WORKFLOW_PRESETS: Record<WorkflowMode, WorkflowPreset> = {
  "ultra-safe-manual": {
    mode: "ultra-safe-manual",
    label: "Ultra-safe manual",
    audience: "Teams that want every durable write and cleanup step to stay manual.",
    automationLevel: "No automatic extraction or cleanup.",
    risk: "Lowest automation risk; highest command count.",
    extractMode: "manual",
    sweepOnInject: false,
    gitHookDefault: false,
    autoApproveSafeCandidates: false,
  },
  "recommended-semi-auto": {
    mode: "recommended-semi-auto",
    label: "Recommended semi-auto",
    audience: "Most repos. Good default for first-time setup and day-to-day work.",
    automationLevel: "Session-end extraction suggests candidates; review and approve stay human-controlled.",
    risk: "Low risk with fewer repeated commands.",
    extractMode: "suggest",
    sweepOnInject: false,
    gitHookDefault: true,
    autoApproveSafeCandidates: false,
  },
  "automation-first": {
    mode: "automation-first",
    label: "Automation-first",
    audience: "Teams already comfortable with RepoBrain and willing to auto-accept clear low-risk writes.",
    automationLevel: "Clear accepts can go active automatically; ambiguous items still stay in review.",
    risk: "Higher automation; keep an eye on status and pending reminders.",
    extractMode: "auto",
    sweepOnInject: true,
    gitHookDefault: true,
    autoApproveSafeCandidates: true,
  },
};

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  workflowMode: "recommended-semi-auto",
  maxInjectTokens: 1200,
  extractMode: WORKFLOW_PRESETS["recommended-semi-auto"].extractMode,
  language: "zh-CN",
  staleDays: 90,
  sweepOnInject: WORKFLOW_PRESETS["recommended-semi-auto"].sweepOnInject,
  injectDiversity: true,
  injectExplainMaxItems: 4,
  autoApproveSafeCandidates: WORKFLOW_PRESETS["recommended-semi-auto"].autoApproveSafeCandidates,
};

const DEPRECATED_REMOTE_REVIEW_KEY_PATTERNS = [
  /(?:^|_)provider$/i,
  /(?:^|_)model$/i,
  /api[_-]?key$/i,
  /^review(?:er)?(?:[_-]?(?:provider|model|api[_-]?key|llm|remote.*))$/i,
  /^(?:llm|remote)(?:[_-].+)?$/i,
] as const;

export function getBrainDir(projectRoot: string): string {
  return path.join(projectRoot, ".brain");
}

export function getConfigPath(projectRoot: string): string {
  return path.join(getBrainDir(projectRoot), "config.yaml");
}

export async function hasBrain(projectRoot: string): Promise<boolean> {
  try {
    await access(getBrainDir(projectRoot), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findProjectRoot(startDir: string): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (await hasBrain(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export async function loadConfig(projectRoot: string): Promise<BrainConfig> {
  const configPath = getConfigPath(projectRoot);

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseSimpleYaml(raw);
    const workflowMode = parsed.workflowMode ?? DEFAULT_BRAIN_CONFIG.workflowMode;
    const preset = getWorkflowPreset(workflowMode);
    return {
      ...DEFAULT_BRAIN_CONFIG,
      ...parsed,
      workflowMode,
      extractMode: parsed.explicitKeys.has("extractMode")
        ? (parsed.extractMode ?? DEFAULT_BRAIN_CONFIG.extractMode)
        : preset.extractMode,
      sweepOnInject: parsed.explicitKeys.has("sweepOnInject")
        ? (parsed.sweepOnInject ?? DEFAULT_BRAIN_CONFIG.sweepOnInject)
        : preset.sweepOnInject,
      autoApproveSafeCandidates: parsed.explicitKeys.has("autoApproveSafeCandidates")
        ? (parsed.autoApproveSafeCandidates ?? DEFAULT_BRAIN_CONFIG.autoApproveSafeCandidates)
        : preset.autoApproveSafeCandidates,
      ...(parsed.warnings ? { warnings: parsed.warnings } : {}),
    };
  } catch {
    return { ...DEFAULT_BRAIN_CONFIG };
  }
}

export async function writeDefaultConfig(projectRoot: string): Promise<void> {
  const configPath = getConfigPath(projectRoot);
  await writeFile(configPath, serializeSimpleYaml(DEFAULT_BRAIN_CONFIG), "utf8");
}

export async function writeConfig(projectRoot: string, config: BrainConfig): Promise<void> {
  const configPath = getConfigPath(projectRoot);
  await writeFile(configPath, serializeSimpleYaml(config), "utf8");
}

export function getWorkflowPreset(mode: WorkflowMode): WorkflowPreset {
  return WORKFLOW_PRESETS[mode];
}

export function parseWorkflowMode(value: string): WorkflowMode {
  const normalized = value.trim().toLowerCase() as WorkflowMode;
  if (WORKFLOW_MODES.includes(normalized)) {
    return normalized;
  }

  throw new Error(
    `Unsupported workflow mode "${value}". Expected one of: ${WORKFLOW_MODES.join(", ")}.`,
  );
}

function parseSimpleYaml(raw: string): Partial<BrainConfig> & {
  explicitKeys: Set<string>;
} {
  const result: Partial<BrainConfig> = {};
  const deprecatedKeys = new Set<string>();
  const warnings: string[] = [];
  const explicitKeys = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    explicitKeys.add(key);

    if (isDeprecatedRemoteReviewConfigKey(key)) {
      deprecatedKeys.add(key);
      continue;
    }

    if (key === "workflowMode") {
      try {
        result.workflowMode = parseWorkflowMode(value);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    if (key === "maxInjectTokens") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        result.maxInjectTokens = parsed;
      }
      continue;
    }

    if (key === "extractMode") {
      const normalized = value.toLowerCase() as ExtractMode;
      if (EXTRACT_MODES.includes(normalized)) {
        result.extractMode = normalized;
      }
      continue;
    }

    if (key === "autoExtract") {
      result.extractMode = value.toLowerCase() === "true" ? "auto" : "manual";
      continue;
    }

    if (key === "language" && value) {
      result.language = value;
      continue;
    }

    if (key === "staleDays") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        result.staleDays = parsed;
      } else {
        warnings.push(
          `Ignoring invalid config value staleDays=${value}. Expected a positive integer; using default ${DEFAULT_BRAIN_CONFIG.staleDays}.`,
        );
      }
      continue;
    }

    if (key === "sweepOnInject") {
      if (value.toLowerCase() === "true") {
        result.sweepOnInject = true;
      } else if (value.toLowerCase() === "false") {
        result.sweepOnInject = false;
      } else {
        warnings.push(
          `Ignoring invalid config value sweepOnInject=${value}. Expected true or false; using default ${DEFAULT_BRAIN_CONFIG.sweepOnInject}.`,
        );
      }
      continue;
    }

    if (key === "injectDiversity") {
      if (value.toLowerCase() === "true") {
        result.injectDiversity = true;
      } else if (value.toLowerCase() === "false") {
        result.injectDiversity = false;
      } else {
        warnings.push(
          `Ignoring invalid config value injectDiversity=${value}. Expected true or false; using default ${DEFAULT_BRAIN_CONFIG.injectDiversity}.`,
        );
      }
      continue;
    }

    if (key === "injectExplainMaxItems") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        result.injectExplainMaxItems = parsed;
      } else {
        warnings.push(
          `Ignoring invalid config value injectExplainMaxItems=${value}. Expected a positive integer; using default ${DEFAULT_BRAIN_CONFIG.injectExplainMaxItems}.`,
        );
      }
      continue;
    }

    if (key === "autoApproveSafeCandidates") {
      if (value.toLowerCase() === "true") {
        result.autoApproveSafeCandidates = true;
      } else if (value.toLowerCase() === "false") {
        result.autoApproveSafeCandidates = false;
      } else {
        warnings.push(
          `Ignoring invalid config value autoApproveSafeCandidates=${value}. Expected true or false; using default ${DEFAULT_BRAIN_CONFIG.autoApproveSafeCandidates}.`,
        );
      }
    }
  }

  if (deprecatedKeys.size > 0) {
    warnings.push(
      `Ignoring deprecated remote review config fields: ${Array.from(deprecatedKeys).sort((left, right) => left.localeCompare(right)).join(", ")}. RepoBrain Core only uses the local deterministic review pipeline.`,
    );
  }

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return {
    ...result,
    explicitKeys,
  };
}

export function renderConfigWarnings(config: BrainConfig): string[] {
  return config.warnings ?? [];
}

function serializeSimpleYaml(config: BrainConfig): string {
  const preset = getWorkflowPreset(config.workflowMode);
  return [
    "# Project Brain config",
    "# Workflow modes:",
    "# - ultra-safe-manual: keep inject/review/approve/sweep fully manual",
    "# - recommended-semi-auto: suggest candidates automatically, keep approval manual",
    "# - automation-first: auto-accept clear low-risk memories, still review ambiguous items",
    `workflowMode: ${config.workflowMode}`,
    `maxInjectTokens: ${config.maxInjectTokens}`,
    `extractMode: ${config.extractMode}`,
    `language: ${config.language}`,
    `staleDays: ${config.staleDays}`,
    `sweepOnInject: ${config.sweepOnInject ? "true" : "false"}`,
    `injectDiversity: ${config.injectDiversity ? "true" : "false"}`,
    `injectExplainMaxItems: ${config.injectExplainMaxItems}`,
    `autoApproveSafeCandidates: ${config.autoApproveSafeCandidates ? "true" : "false"}`,
    `# workflowSummary: ${preset.label} | ${preset.automationLevel}`,
    "",
  ].join("\n");
}

function isDeprecatedRemoteReviewConfigKey(key: string): boolean {
  return DEPRECATED_REMOTE_REVIEW_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
