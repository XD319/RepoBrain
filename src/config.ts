import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { BrainConfig } from "./types.js";

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  maxInjectTokens: 1200,
  autoExtract: false,
  language: "zh-CN",
};

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
    return {
      ...DEFAULT_BRAIN_CONFIG,
      ...parseSimpleYaml(raw),
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

    if (key === "maxInjectTokens") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        result.maxInjectTokens = parsed;
      }
      continue;
    }

    if (key === "autoExtract") {
      result.autoExtract = value.toLowerCase() === "true";
      continue;
    }

    if (key === "language" && value) {
      result.language = value;
    }
  }

  return result;
}

function serializeSimpleYaml(config: BrainConfig): string {
  return [
    "# Project Brain config",
    `maxInjectTokens: ${config.maxInjectTokens}`,
    `autoExtract: ${String(config.autoExtract)}`,
    `language: ${config.language}`,
    "",
  ].join("\n");
}
