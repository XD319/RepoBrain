import { Command } from "commander";
import { stdout as output } from "node:process";
import { loadConfig, renderConfigWarnings } from "../config.js";
import { buildInjection } from "../inject.js";
import { initBrain } from "../store.js";
import { INJECT_LAYERS, type InjectLayer } from "../types.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("inject")
    .description("Build session-start injection text from current .brain memories.")
    .option("--task <task>", "Current task description used for task-aware memory selection.")
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
      "--ids <ids>",
      "Expand specific memory ids. Accepts repeated values or a comma-separated list.",
      helpers.collectValues,
      [] as string[],
    )
    .option("--no-context", "Skip Git-context scoring and use the legacy injection ordering.")
    .option("--explain", "Append per-memory Git-context scores as an HTML comment.")
    .option("--include-working", "Include active working memories in the injected output.")
    .option(
      "--layer <layer>",
      `Inject output layer: ${INJECT_LAYERS.join(" | ")}. Default: summary.`,
      parseInjectLayer,
      "summary",
    )
    .option("--no-session", "Skip `.brain/runtime/session-profile.json` overlay (durable memories only).")
    .action(
      async (options: {
        task?: string;
        path: string[];
        module: string[];
        ids: string[];
        context?: boolean;
        explain?: boolean;
        includeWorking?: boolean;
        layer: InjectLayer;
        noSession?: boolean;
      }) => {
        const projectRoot = await helpers.resolveProjectRoot();
        const config = await loadConfig(projectRoot);
        renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
        if (config.sweepOnInject) {
          await initBrain(projectRoot);
          await helpers.runSweepAuto(projectRoot, config, (line) => process.stderr.write(`${line}\n`), true);
        }
        const injection = await buildInjection(projectRoot, config, {
          ...(options.task?.trim() ? { task: options.task.trim() } : {}),
          paths: options.path,
          modules: options.module,
          ids: options.ids,
          ...(options.context === false ? { noContext: true } : {}),
          ...(options.explain ? { explain: true } : {}),
          ...(options.includeWorking ? { includeWorking: true } : {}),
          layer: options.layer,
          ...(options.noSession ? { includeSessionProfile: false } : {}),
        });
        output.write(`${injection}\n`);
      },
    );

  program;
}

function parseInjectLayer(value: string): InjectLayer {
  const normalized = value.trim().toLowerCase();
  if (normalized === "index" || normalized === "summary" || normalized === "full") {
    return normalized;
  }

  throw new Error(`Invalid value for "--layer": "${value}". Expected one of: ${INJECT_LAYERS.join(", ")}.`);
}
