import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { BrainConfig, ExtractMode } from "./types.js";
import { EXTRACT_MODES } from "./types.js";

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  maxInjectTokens: 1200,
  extractMode: "suggest",
  language: "zh-CN",
  staleDays: 90,
  sweepOnInject: false,
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
    return {
      ...DEFAULT_BRAIN_CONFIG,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_BRAIN_CONFIG };
  }
}

export async function writeDefaultConfig(projectRoot: string): Promise<void> {
  const configPath = getConfigPath(projectRoot);
  await writeFile(configPath, serializeSimpleYaml(DEFAULT_BRAIN_CONFIG), "utf8");
}

function parseSimpleYaml(raw: string): Partial<BrainConfig> {
  const result: Partial<BrainConfig> = {};
  const deprecatedKeys = new Set<string>();
  const warnings: string[] = [];

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

    if (isDeprecatedRemoteReviewConfigKey(key)) {
      deprecatedKeys.add(key);
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

  return result;
}

export function renderConfigWarnings(config: BrainConfig): string[] {
  return config.warnings ?? [];
}

function serializeSimpleYaml(config: BrainConfig): string {
  return [
    "# Project Brain config",
    `maxInjectTokens: ${config.maxInjectTokens}`,
    `extractMode: ${config.extractMode}`,
    `language: ${config.language}`,
    `staleDays: ${config.staleDays}`,
    `sweepOnInject: ${config.sweepOnInject ? "true" : "false"}`,
    "",
  ].join("\n");
}

function isDeprecatedRemoteReviewConfigKey(key: string): boolean {
  return DEPRECATED_REMOTE_REVIEW_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
