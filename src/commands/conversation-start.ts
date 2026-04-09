import { Command } from "commander";
import { stdout as output } from "node:process";
import { loadConfig, renderConfigWarnings } from "../config.js";
import { buildConversationStart, renderConversationStart, renderConversationStartJson } from "../conversation-start.js";
import type { ConversationRefreshMode } from "../types.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("conversation-start")
    .description(
      "Smart conversation bootstrap: decide whether RepoBrain should run the full session bundle, reload compact context, or skip a redundant refresh.",
    )
    .option("--task <task>", "Current task description used for smart conversation refresh decisions.")
    .option(
      "--path <path>",
      "Target path to prioritize related memories. Repeat or pass a comma-separated list.",
      helpers.collectValues,
      [] as string[],
    )
    .option(
      "--module <module>",
      "Module or subsystem keywords to prioritize. Repeat or pass a comma-separated list.",
      helpers.collectValues,
      [] as string[],
    )
    .option(
      "--refresh-mode <mode>",
      'Conversation refresh mode: "always", "task-change", or "smart". Default: "smart".',
      parseConversationRefreshMode,
      "smart",
    )
    .option("--force", "Force a context refresh instead of allowing RepoBrain to skip a redundant reload.")
    .option("--json", 'Print the result as JSON. Equivalent to "--format json".')
    .option("--format <format>", 'Output format: "markdown" or "json".', "markdown")
    .option("--no-session", "Skip `.brain/runtime/session-profile.json` overlay (durable memories only).")
    .action(
      async (options: {
        task?: string;
        path: string[];
        module: string[];
        refreshMode?: ConversationRefreshMode;
        force?: boolean;
        json?: boolean;
        format?: string;
        noSession?: boolean;
      }) => {
        const projectRoot = await helpers.resolveProjectRoot();
        const config = await loadConfig(projectRoot);
        renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
        const result = await buildConversationStart(projectRoot, config, {
          ...(options.task?.trim() ? { task: options.task.trim() } : {}),
          paths: options.path,
          modules: options.module,
          refreshMode: options.refreshMode ?? "smart",
          forceRefresh: Boolean(options.force),
          ...(options.noSession ? { includeSessionProfile: false } : {}),
        });

        const format = helpers.resolveSuggestSkillsOutputFormat(options);
        output.write(`${format === "json" ? renderConversationStartJson(result) : renderConversationStart(result)}\n`);
      },
    );
}

function parseConversationRefreshMode(value: string): ConversationRefreshMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "always" || normalized === "task-change" || normalized === "smart") {
    return normalized;
  }

  throw new Error(`Invalid value for "--refresh-mode": "${value}". Expected one of: always, task-change, smart.`);
}
