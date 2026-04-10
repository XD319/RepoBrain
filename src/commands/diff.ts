import { Command } from "commander";
import { stdout as output } from "node:process";

import { buildMemoryDiff, renderMemoryDiff, renderMemoryDiffJson } from "../memory-diff.js";
import { BrainUserError } from "../errors.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("diff")
    .description("Show what changed in the memory store since the last inject or a specific time window.")
    .option("--since <date>", "ISO date or datetime start for the diff window.")
    .option("--since-days <n>", "Show changes from the last N days.", parseSinceDays)
    .option("--format <format>", "Output format: text | json.", "text")
    .action(async (options: { since?: string; sinceDays?: number; format: string }) => {
      const format = parseFormat(options.format);
      const projectRoot = await helpers.resolveProjectRoot();
      const result = await buildMemoryDiff(projectRoot, {
        ...(options.since ? { since: options.since } : {}),
        ...(options.sinceDays !== undefined ? { sinceDays: options.sinceDays } : {}),
      });
      output.write(`${format === "json" ? renderMemoryDiffJson(result) : renderMemoryDiff(result)}\n`);
    });
}

function parseFormat(value: string): "text" | "json" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "text" || normalized === "json") {
    return normalized;
  }
  throw new BrainUserError(`Invalid value for "--format": "${value}". Expected "text" or "json".`);
}

function parseSinceDays(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BrainUserError(`Invalid value for "--since-days": "${value}". Expected a positive integer.`);
  }
  return parsed;
}
