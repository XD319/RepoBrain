import { Command } from "commander";
import { stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { loadSchemaValidatedMemoryRecords, renderSchemaHealthSummary } from "../memory-schema.js";
import { getSteeringRulesStatus } from "../steering-rules.js";
import { getMemoryStatus, loadActivityState, loadAllMemories } from "../store.js";
import type { MemoryType } from "../types.js";
import { MEMORY_TYPES } from "../types.js";
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
      const [{ records, schema }] = await Promise.all([loadSchemaValidatedMemoryRecords(projectRoot)]);
      const memories = records.map((entry) => entry.memory);
      const byType = new Map<string, number>(MEMORY_TYPES.map((type) => [type, 0]));
      const byImportance = new Map<string, number>();
      const byStatus = new Map<string, number>();

      for (const memory of memories) {
        byType.set(memory.type, (byType.get(memory.type) ?? 0) + 1);
        byImportance.set(memory.importance, (byImportance.get(memory.importance) ?? 0) + 1);
        const status = getMemoryStatus(memory);
        byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
      }

      output.write(`Total memories: ${memories.length}\n`);
      output.write(`Last updated: ${memories[0]?.date ?? "N/A"}\n`);
      output.write(`By type: ${helpers.formatCountMap(byType)}\n`);
      output.write(`By importance: ${helpers.formatCountMap(byImportance)}\n`);
      output.write(`By status: ${helpers.formatCountMap(byStatus)}\n`);
      output.write(`${renderSchemaHealthSummary(schema.summary)}\n`);
    });

  program;

  program
    .command("status")
    .description("Show the current workflow mode, reminders, and recent RepoBrain activity.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const [{ records, schema }] = await Promise.all([loadSchemaValidatedMemoryRecords(projectRoot)]);
      const memories = records.map((entry) => entry.memory);
      const activity = await loadActivityState(projectRoot);
      const steeringRules = await getSteeringRulesStatus(projectRoot);
      const config = await loadConfig(projectRoot);
      const snapshot = await helpers.buildWorkflowSnapshot(projectRoot, config, memories);
      const recentCapturedMemories = memories.slice(0, 5);

      output.write(`Project root: ${projectRoot}\n`);
      output.write(`Workflow: ${snapshot.workflow.label} (${snapshot.workflow.mode})\n`);
      output.write(
        `Trigger: ${config.triggerMode === "detect" ? "auto-detect" : "manual"} | Capture: ${config.captureMode} | Auto-approve: ${config.autoApproveSafeCandidates ? "yes" : "no"}\n`,
      );
      output.write(`Total memories: ${memories.length}\n`);
      output.write(`Pending review: ${snapshot.candidateCount}\n`);
      output.write(`Pending reinforce: ${snapshot.pendingReinforceCount}\n`);
      output.write(`Pending cleanup: ${snapshot.cleanupCount}\n`);
      output.write(`Last updated: ${memories[0]?.date ?? "N/A"}\n`);
      output.write(`Last injected: ${activity.lastInjectedAt ?? "N/A"}\n`);
      output.write(`Steering rules: ${helpers.formatSteeringRulesStatus(steeringRules)}\n`);
      output.write(`${renderSchemaHealthSummary(schema.summary)}\n`);
      const statusReminders = [...snapshot.reminders];
      if (schema.summary.files_with_errors > 0) {
        statusReminders.unshift('run "brain lint-memory" to inspect schema errors before the next share or audit');
      } else if (schema.summary.fixable_files > 0) {
        statusReminders.unshift('run "brain normalize-memory" to apply safe frontmatter normalization');
      }
      if (statusReminders.length > 0) {
        output.write("Reminders:\n");
        statusReminders.forEach((line) => output.write(`- ${line}\n`));
      }
      if (false && steeringRules.claudeConfigured) {
        output.write("✓ Claude Code steering rules 已配置\n");
      }
      if (false && steeringRules.codexConfigured) {
        output.write("✓ Codex steering rules 已配置\n");
      }
      if (false && !steeringRules.claudeConfigured && !steeringRules.codexConfigured) {
        output.write("⚠ 未配置 steering rules，运行 brain init 可生成（建议配置后 Agent 会自动使用记忆）\n");
      }
      output.write("Recent loaded memories:\n");
      output.write(`${helpers.formatMemoryList(activity.recentLoadedMemories)}\n`);
      output.write("Recent captured memories:\n");
      output.write(`${helpers.formatMemoryList(recentCapturedMemories)}\n`);
      output.write("Suggested next steps:\n");
      snapshot.nextSteps.forEach((line) => output.write(`- ${line}\n`));
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
        output.write('Next: run "brain inject" before the next coding session.\n');
        return;
      }

      output.write(`Next: ${snapshot.nextSteps[0]}\n`);
      if (snapshot.nextSteps.length > 1) {
        output.write("After that:\n");
        snapshot.nextSteps.slice(1, 4).forEach((line) => output.write(`- ${line}\n`));
      }
    });
}
