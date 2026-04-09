import { Command } from "commander";
import { stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { renderSchemaHealthSummary } from "../memory-schema.js";
import { loadAllMemories } from "../store.js";
import type { MemoryType } from "../types.js";
import { buildDashboardStatsViewModel, buildDashboardStatusViewModel } from "../tui/adapters/dashboard.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("list")
    .description("List all stored memories in the current project.")
    .option("--type <type>", "Filter memories by type.", helpers.parseMemoryTypeOption)
    .option("--goals", "List goal memories grouped by status.")
    .action(async (options: { type?: MemoryType; goals?: boolean }) => {
      const projectRoot = await helpers.resolveProjectRoot();
      const memories = await loadAllMemories(projectRoot);
      const filteredMemories = options.goals
        ? memories.filter((memory) => memory.type === "goal")
        : options.type
          ? memories.filter((memory) => memory.type === options.type)
          : memories;

      if (options.goals && options.type && options.type !== "goal") {
        throw new Error('Use "--type goal" with "--goals", or omit "--type".');
      }

      if (filteredMemories.length === 0) {
        output.write("No memories found.\n");
        return;
      }

      if (options.goals) {
        output.write(`${helpers.renderGoalList(filteredMemories)}\n`);
        return;
      }

      for (const memory of filteredMemories) {
        output.write(`${helpers.formatMemoryListLine(memory)}\n`);
      }
    });

  program;

  program
    .command("stats")
    .description("Show high-level memory counts for the current project.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const stats = await buildDashboardStatsViewModel(projectRoot);
      output.write(`Total memories: ${stats.totalMemories}\n`);
      output.write(`Last updated: ${stats.lastUpdated}\n`);
      output.write(`By type: ${helpers.formatCountMap(stats.byType)}\n`);
      output.write(`By importance: ${helpers.formatCountMap(stats.byImportance)}\n`);
      output.write(`By status: ${helpers.formatCountMap(stats.byStatus)}\n`);
      output.write(`${renderSchemaHealthSummary(stats.schemaSummary)}\n`);
    });

  program;

  program
    .command("status")
    .description("Show the current workflow mode, reminders, and recent RepoBrain activity.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const status = await buildDashboardStatusViewModel(projectRoot);
      output.write(`Project root: ${status.projectRoot}\n`);
      output.write(`Workflow: ${status.snapshot.workflow.label} (${status.snapshot.workflow.mode})\n`);
      output.write(
        `Trigger: ${status.config.triggerMode === "detect" ? "auto-detect" : "manual"} | Capture: ${status.config.captureMode} | Auto-approve: ${status.config.autoApproveSafeCandidates ? "yes" : "no"}\n`,
      );
      output.write(`Total memories: ${status.totalMemories}\n`);
      output.write(`Pending review: ${status.snapshot.candidateCount}\n`);
      output.write(`Pending reinforce: ${status.snapshot.pendingReinforceCount}\n`);
      output.write(`Pending cleanup: ${status.snapshot.cleanupCount}\n`);
      output.write(`Last updated: ${status.lastUpdated}\n`);
      output.write(`Last injected: ${status.lastInjectedAt}\n`);
      output.write(`Steering rules: ${status.steeringRulesStatusText}\n`);
      output.write(`${renderSchemaHealthSummary(status.schemaSummary)}\n`);
      if (status.reminders.length > 0) {
        output.write("Reminders:\n");
        status.reminders.forEach((line) => output.write(`- ${line}\n`));
      }
      output.write("Recent loaded memories:\n");
      output.write(`${helpers.formatMemoryList(status.recentLoadedMemories)}\n`);
      output.write("Recent captured memories:\n");
      output.write(`${helpers.formatMemoryList(status.recentCapturedMemories)}\n`);
      output.write("Suggested next steps:\n");
      status.snapshot.nextSteps.forEach((line) => output.write(`- ${line}\n`));
    });

  program;

  program
    .command("next")
    .description("Show the next recommended RepoBrain step for the current repo state.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const config = await loadConfig(projectRoot);
      const memories = await loadAllMemories(projectRoot);
      const snapshot = await helpers.buildWorkflowSnapshot(projectRoot, config, memories);

      output.write(`Workflow: ${snapshot.workflow.label} (${snapshot.workflow.mode})\n`);
      if (snapshot.nextSteps.length === 0) {
        output.write(
          'Next: run "brain start" for the first conversation in the next coding session, or "brain conversation-start" for a smart later-conversation refresh.\n',
        );
        return;
      }

      output.write(`Next: ${snapshot.nextSteps[0]}\n`);
      if (snapshot.nextSteps.length > 1) {
        output.write("After that:\n");
        snapshot.nextSteps.slice(1, 4).forEach((line) => output.write(`- ${line}\n`));
      }
    });
}
