import { Command } from "commander";
import { stdout as output } from "node:process";
import { buildSharePlan } from "../share.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
program
  .command("share [memoryId]")
  .description("Suggest git commands for sharing one memory or all active memories.")
  .option("--all-active", "Share all active memories in .brain.")
  .action(async (memoryId: string | undefined, options: { allActive?: boolean }) => {
    const projectRoot = await helpers.resolveProjectRoot();
    const plan = await buildSharePlan(projectRoot, {
      ...(options.allActive ? { allActive: true } : {}),
      ...(memoryId ? { memoryId } : {}),
    });

    output.write(`Share plan for ${plan.records.length} memory${plan.records.length === 1 ? "" : "ies"}:\n`);
    for (const entry of plan.records) {
      output.write(`- ${entry.relativePath.replace(/\\/g, "/")} | ${entry.memory.type} | ${entry.memory.title}\n`);
    }

    output.write("\nSuggested next commands:\n");
    for (const command of plan.addCommands) {
      output.write(`${command}\n`);
    }
    output.write(`git commit -m ${JSON.stringify(plan.commitMessage)}\n`);
  });

program
}