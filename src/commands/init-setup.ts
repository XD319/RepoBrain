import { Command } from "commander";
import { stdout as output } from "node:process";
import { getWorkflowPreset, parseWorkflowMode } from "../config.js";
import { setupRepoBrain } from "../setup.js";
import { writeSteeringRules } from "../steering-rules.js";
import { initBrain } from "../store.js";
import type { WorkflowMode } from "../types.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("init")
    .description("Initialize .brain with a workflow preset and steering rules for agent sessions.")
    .option(
      "--workflow <mode>",
      "Workflow mode: ultra-safe-manual | recommended-semi-auto | automation-first",
      parseWorkflowMode,
    )
    .option("--steering-rules <target>", "Generate steering rules for claude, codex, cursor, all, or skip.")
    .option("--skip-steering-rules", "Do not generate steering rules during initialization.")
    .action(async (options: { workflow?: WorkflowMode; steeringRules?: string; skipSteeringRules?: boolean }) => {
      const projectRoot = process.cwd();
      await initBrain(projectRoot);
      const workflowMode = options.workflow ?? "recommended-semi-auto";
      await helpers.applyWorkflowPresetConfig(projectRoot, workflowMode);
      output.write("Initialized .brain workspace.\n");
      output.write("已初始化 .brain/ 目录。\n");
      const steeringChoice = helpers.resolveSteeringRulesChoice(options.steeringRules, options.skipSteeringRules);
      const writtenPaths = await writeSteeringRules(projectRoot, steeringChoice);
      if (writtenPaths.length > 0) {
        output.write(`已生成 steering rules: ${writtenPaths.join(", ")}\n`);
      }
      helpers.renderWorkflowSummaryLines(workflowMode).forEach((line) => output.write(`${line}\n`));
      helpers.renderSetupNextSteps(workflowMode).forEach((line) => output.write(`${line}\n`));
      output.write(`Initialized Project Brain in ${projectRoot}\n`);
    });

  program;

  program
    .command("setup")
    .description("Initialize RepoBrain, apply a workflow preset, and install the matching low-risk automation.")
    .option(
      "--workflow <mode>",
      "Workflow mode: ultra-safe-manual | recommended-semi-auto | automation-first",
      parseWorkflowMode,
    )
    .option("--steering-rules <target>", "Generate steering rules for claude, codex, cursor, all, or skip.")
    .option("--skip-steering-rules", "Do not generate steering rules during setup.")
    .option("--no-git-hook", "Skip installing the post-commit Git hook.")
    .action(
      async (options: {
        workflow?: WorkflowMode;
        steeringRules?: string;
        skipSteeringRules?: boolean;
        gitHook?: boolean;
      }) => {
        const projectRoot = process.cwd();
        const workflowMode = options.workflow ?? "recommended-semi-auto";
        const preset = getWorkflowPreset(workflowMode);
        const gitHook = options.gitHook === false ? false : preset.gitHookDefault;
        const result = await setupRepoBrain(projectRoot, { gitHook });
        await helpers.applyWorkflowPresetConfig(projectRoot, workflowMode);
        const steeringChoice = helpers.resolveSteeringRulesChoice(options.steeringRules, options.skipSteeringRules);
        const writtenPaths = await writeSteeringRules(projectRoot, steeringChoice);

        output.write(`Initialized RepoBrain in ${projectRoot}\n`);
        output.write(`- Brain directory: ${result.brainDir}\n`);
        helpers.renderWorkflowSummaryLines(workflowMode).forEach((line) => output.write(`- ${line}\n`));
        output.write(`- ${result.gitHook.message}\n`);
        if (writtenPaths.length > 0) {
          output.write(`- Steering rules: ${writtenPaths.join(", ")}\n`);
        }
        helpers.renderSetupNextSteps(workflowMode).forEach((line) => output.write(`- ${line}\n`));
      },
    );

  program;
}
