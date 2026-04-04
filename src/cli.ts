#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";

import {
  getBrainDir,
  getWorkflowPreset,
  loadConfig,
  parseWorkflowMode,
  renderConfigWarnings,
  writeConfig,
} from "./config.js";
import { buildMemoryAudit, renderMemoryAuditResult } from "./audit-memory.js";
import {
  buildMemorySchemaReport,
  loadSchemaValidatedMemoryRecords,
  normalizeMemorySchemas,
  renderMemoryNormalizeReport,
  renderMemorySchemaReport,
  renderSchemaHealthSummary,
} from "./memory-schema.js";
import { extractMemories } from "./extract.js";
import { detectFailures } from "./failure-detector.js";
import { buildCommitExtractionInput } from "./git-commit.js";
import { buildInjection } from "./inject.js";
import { runMcpServer } from "./mcp/server.js";
import { clearPendingReinforcementEvents, loadPendingReinforcementState } from "./reinforce-pending.js";
import { reinforceMemories } from "./reinforce.js";
import { reviewCandidateMemories, reviewCandidateMemory } from "./reviewer.js";
import { buildSharePlan } from "./share.js";
import { setupRepoBrain } from "./setup.js";
import { getSteeringRulesStatus, writeSteeringRules } from "./steering-rules.js";
import {
  evaluateExtractWorthiness,
  renderExtractSuggestionJson,
  renderExtractSuggestionMarkdown,
} from "./extract-suggestion.js";
import type { ExtractSuggestionResult } from "./extract-suggestion.js";
import {
  buildSkillShortlist,
  collectGitDiffPaths,
  renderSkillShortlist,
  renderSkillShortlistJson,
  resolveSuggestedSkillPaths,
} from "./suggest-skills.js";
import type { PathSource } from "./suggest-skills.js";
import {
  buildTaskRoutingBundle,
  renderTaskRoutingBundle,
  renderTaskRoutingBundleJson,
} from "./task-routing.js";
import {
  applySweepAuto,
  archiveGoalMemory,
  deleteExpiredWorking,
  downgradeStaleMemory,
  previewMemoryLines,
  renderSweepDryRun,
  scanSweepCandidates,
  toDisplayPath,
} from "./sweep.js";
import {
  approveCandidateMemory,
  getMemoryStatus,
  initBrain,
  loadActivityState,
  loadAllMemories,
  loadStoredMemoryRecords,
  overwriteStoredMemory,
  saveMemory,
  supersedeMemoryPair,
  updateIndex,
  updateStoredMemoryStatus,
} from "./store.js";
import type { FailureEvent } from "./failure-detector.js";
import type {
  BrainConfig,
  CandidateMemoryReviewResult,
  Memory,
  MemoryActivityEntry,
  StoredMemoryRecord,
  MemoryType,
  WorkflowMode,
} from "./types.js";
import { MEMORY_TYPES } from "./types.js";

const program = new Command();

program
  .name("brain")
  .description("Repo-native project knowledge memory for coding agents.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize .brain with a workflow preset and steering rules for agent sessions.")
  .option("--workflow <mode>", "Workflow mode: ultra-safe-manual | recommended-semi-auto | automation-first", parseWorkflowMode)
  .option("--steering-rules <target>", "Generate steering rules for claude, codex, cursor, all, or skip.")
  .option("--skip-steering-rules", "Do not generate steering rules during initialization.")
  .action(async (options: { workflow?: WorkflowMode; steeringRules?: string; skipSteeringRules?: boolean }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);
    const workflowMode = options.workflow ?? "recommended-semi-auto";
    await applyWorkflowPresetConfig(projectRoot, workflowMode);
    output.write("Initialized .brain workspace.\n");
    output.write("已初始化 .brain/ 目录。\n");
    const steeringChoice = resolveSteeringRulesChoice(options.steeringRules, options.skipSteeringRules);
    const writtenPaths = await writeSteeringRules(projectRoot, steeringChoice);
    if (writtenPaths.length > 0) {
      output.write(`已生成 steering rules: ${writtenPaths.join(", ")}\n`);
    }
    renderWorkflowSummaryLines(workflowMode).forEach((line) => output.write(`${line}\n`));
    renderSetupNextSteps(workflowMode).forEach((line) => output.write(`${line}\n`));
    output.write(`Initialized Project Brain in ${projectRoot}\n`);
  });

program
  .command("setup")
  .description("Initialize RepoBrain, apply a workflow preset, and install the matching low-risk automation.")
  .option("--workflow <mode>", "Workflow mode: ultra-safe-manual | recommended-semi-auto | automation-first", parseWorkflowMode)
  .option("--steering-rules <target>", "Generate steering rules for claude, codex, cursor, all, or skip.")
  .option("--skip-steering-rules", "Do not generate steering rules during setup.")
  .option("--no-git-hook", "Skip installing the post-commit Git hook.")
  .action(async (options: { workflow?: WorkflowMode; steeringRules?: string; skipSteeringRules?: boolean; gitHook?: boolean }) => {
    const projectRoot = process.cwd();
    const workflowMode = options.workflow ?? "recommended-semi-auto";
    const preset = getWorkflowPreset(workflowMode);
    const gitHook = options.gitHook === false ? false : preset.gitHookDefault;
    const result = await setupRepoBrain(
      projectRoot,
      { gitHook },
    );
    await applyWorkflowPresetConfig(projectRoot, workflowMode);
    const steeringChoice = resolveSteeringRulesChoice(options.steeringRules, options.skipSteeringRules);
    const writtenPaths = await writeSteeringRules(projectRoot, steeringChoice);

    output.write(`Initialized RepoBrain in ${projectRoot}\n`);
    output.write(`- Brain directory: ${result.brainDir}\n`);
    renderWorkflowSummaryLines(workflowMode).forEach((line) => output.write(`- ${line}\n`));
    output.write(`- ${result.gitHook.message}\n`);
    if (writtenPaths.length > 0) {
      output.write(`- Steering rules: ${writtenPaths.join(", ")}\n`);
    }
    renderSetupNextSteps(workflowMode).forEach((line) => output.write(`- ${line}\n`));
  });

program
  .command("extract")
  .description("Extract long-lived repo knowledge from stdin and save it into .brain.")
  .option("--source <source>", "Memory source label", "session")
  .option("--type <type>", "Force a memory type for extracted entries.", parseMemoryTypeOption)
  .option("--candidate", "Save extracted memories as candidates for later review.")
  .action(async (options: { source: Memory["source"]; type?: MemoryType; candidate?: boolean }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);

    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
    const stdinText = await readStdin();
    await runExtractionWorkflow(projectRoot, config, stdinText, options);
  });

program
  .command("extract-commit")
  .description("Extract repo knowledge from a richer git commit context for the latest commit or a target revision.")
  .option("--rev <revision>", "Git revision to analyze", "HEAD")
  .option("--candidate", "Save extracted memories as candidates for later review.")
  .action(async (options: { rev?: string; candidate?: boolean }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);

    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
    const commitContext = await buildCommitExtractionInput(projectRoot, options.rev?.trim() || "HEAD");
    await runExtractionWorkflow(projectRoot, config, commitContext, options.candidate
      ? { source: "git-commit", candidate: true }
      : { source: "git-commit" });
  });

program
  .command("inject")
  .description("Build session-start injection text from current .brain memories.")
  .option("--task <task>", "Current task description used for task-aware memory selection.")
  .option(
    "--path <path>",
    "Target path to prioritize related memories. Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option(
    "--module <module>",
    "Module or subsystem keywords to prioritize. Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option("--no-context", "Skip Git-context scoring and use the legacy injection ordering.")
  .option("--explain", "Append per-memory Git-context scores as an HTML comment.")
  .option("--include-working", "Include active working memories in the injected output.")
  .action(async (options: {
    task?: string;
    path: string[];
    module: string[];
    context?: boolean;
    explain?: boolean;
    includeWorking?: boolean;
  }) => {
    const projectRoot = process.cwd();
    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
    if (config.sweepOnInject) {
      await initBrain(projectRoot);
      await runSweepAuto(projectRoot, config, (line) => process.stderr.write(`${line}\n`), true);
    }
    const injection = await buildInjection(projectRoot, config, {
      ...(options.task?.trim() ? { task: options.task.trim() } : {}),
      paths: options.path,
      modules: options.module,
      ...(options.context === false ? { noContext: true } : {}),
      ...(options.explain ? { explain: true } : {}),
      ...(options.includeWorking ? { includeWorking: true } : {}),
    });
    output.write(`${injection}\n`);
  });

program
  .command("sweep")
  .description("Clean stale, expired, duplicate, or archive-ready memories after score/review has told you what to inspect.")
  .option("--auto", "Apply all safe sweep rules without prompting.")
  .option("--dry-run", "Print the sweep report without changing any files.")
  .action(async (options: { auto?: boolean; dryRun?: boolean }) => {
    if (options.auto && options.dryRun) {
      throw new Error('Use either "--auto" or "--dry-run", not both.');
    }

    const projectRoot = process.cwd();
    await initBrain(projectRoot);
    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));

    if (options.dryRun) {
      const result = await scanSweepCandidates(projectRoot, config);
      output.write(`${renderSweepDryRun(result)}\n`);
      return;
    }

    if (options.auto) {
      await runSweepAuto(projectRoot, config, (line) => output.write(`${line}\n`));
      return;
    }

    await runSweepInteractive(projectRoot, config);
  });

program
  .command("list")
  .description("List all stored memories in the current project.")
  .option("--type <type>", "Filter memories by type.", parseMemoryTypeOption)
  .option("--goals", "List goal memories grouped by status.")
  .action(async (options: { type?: MemoryType; goals?: boolean }) => {
    const projectRoot = process.cwd();
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
      output.write(`${renderGoalList(filteredMemories)}\n`);
      return;
    }

    for (const memory of filteredMemories) {
      output.write(`${formatMemoryListLine(memory)}\n`);
    }
  });

program
  .command("stats")
  .description("Show high-level memory counts for the current project.")
  .action(async () => {
    const projectRoot = process.cwd();
    const [{ records, schema }] = await Promise.all([
      loadSchemaValidatedMemoryRecords(projectRoot),
    ]);
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
    output.write(`By type: ${formatCountMap(byType)}\n`);
    output.write(`By importance: ${formatCountMap(byImportance)}\n`);
    output.write(`By status: ${formatCountMap(byStatus)}\n`);
    output.write(`${renderSchemaHealthSummary(schema.summary)}\n`);
  });

program
  .command("status")
  .description("Show the current workflow mode, reminders, and recent RepoBrain activity.")
  .action(async () => {
    const projectRoot = process.cwd();
    const [{ records, schema }] = await Promise.all([
      loadSchemaValidatedMemoryRecords(projectRoot),
    ]);
    const memories = records.map((entry) => entry.memory);
    const activity = await loadActivityState(projectRoot);
    const steeringRules = await getSteeringRulesStatus(projectRoot);
    const config = await loadConfig(projectRoot);
    const snapshot = await buildWorkflowSnapshot(projectRoot, config, memories);
    const recentCapturedMemories = memories.slice(0, 5);

    output.write(`Project root: ${projectRoot}\n`);
    output.write(`Workflow: ${snapshot.workflow.label} (${snapshot.workflow.mode})\n`);
    output.write(`Total memories: ${memories.length}\n`);
    output.write(`Pending review: ${snapshot.candidateCount}\n`);
    output.write(`Pending reinforce: ${snapshot.pendingReinforceCount}\n`);
    output.write(`Pending cleanup: ${snapshot.cleanupCount}\n`);
    output.write(`Last updated: ${memories[0]?.date ?? "N/A"}\n`);
    output.write(`Last injected: ${activity.lastInjectedAt ?? "N/A"}\n`);
    output.write(`Steering rules: ${formatSteeringRulesStatus(steeringRules)}\n`);
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
    output.write(`${formatMemoryList(activity.recentLoadedMemories)}\n`);
    output.write("Recent captured memories:\n");
    output.write(`${formatMemoryList(recentCapturedMemories)}\n`);
    output.write("Suggested next steps:\n");
    snapshot.nextSteps.forEach((line) => output.write(`- ${line}\n`));
  });

program
  .command("next")
  .description("Show the next recommended RepoBrain step for the current repo state.")
  .action(async () => {
    const projectRoot = process.cwd();
    const config = await loadConfig(projectRoot);
    const memories = await loadAllMemories(projectRoot);
    const snapshot = await buildWorkflowSnapshot(projectRoot, config, memories);

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

const goalProgram = program
  .command("goal")
  .description("Manage goal memories in the current project.");

goalProgram
  .command("done <keyword>")
  .description("Mark a goal memory as done by matching a title keyword.")
  .action(async (keyword: string) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const query = keyword.trim().toLowerCase();

    if (!query) {
      throw new Error("Provide a keyword to match a goal title.");
    }

    const matches = records.filter((entry) =>
      entry.memory.type === "goal" && entry.memory.title.toLowerCase().includes(query),
    );

    if (matches.length === 0) {
      throw new Error(`No goal memory matched "${keyword}".`);
    }

    if (matches.length > 1) {
      const suggestions = matches.map((entry) => `- ${getStoredMemoryId(entry)} (${entry.memory.title})`);
      throw new Error(
        [`Multiple goal memories matched "${keyword}". Use a more specific keyword:`, ...suggestions].join("\n"),
      );
    }

    const [match] = matches;
    if (!match) {
      throw new Error(`No goal memory matched "${keyword}".`);
    }

    const today = getTodayDate();
    await overwriteStoredMemory({
      ...match,
      memory: {
        ...match.memory,
        status: "done",
        updated: today,
      },
    });

    await updateIndex(projectRoot);
    output.write(`Marked goal as done: ${match.memory.title} (${getStoredMemoryId(match)})\n`);
  });

program
  .command("review")
  .description("Inspect candidate memories before approval; pairs naturally with brain approve --safe.")
  .action(async () => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const candidates = getCandidateRecords(records);

    if (candidates.length === 0) {
      output.write("No candidate memories waiting for review.\n");
      return;
    }

    output.write(`Candidate memories: ${candidates.length}\n`);
    const safeCandidates = candidates.filter((entry) =>
      isSafeCandidateReview(
        reviewCandidateMemory(
          entry.memory,
          records.filter((record) => record.filePath !== entry.filePath),
        ),
      ),
    );
    for (const entry of candidates) {
      output.write(
        `- ${getStoredMemoryId(entry)} | ${entry.memory.type} | ${entry.memory.importance} | ${entry.memory.title}\n`,
      );
    }
    output.write(
      `Next: run "brain approve --safe" for ${safeCandidates.length} low-risk candidate memor${safeCandidates.length === 1 ? "y" : "ies"}, then "brain approve <id>" for anything that still needs manual judgment.\n`,
    );
  });

program
  .command("approve [memoryId]")
  .description("Promote candidate memories to active; use --safe for the normal low-risk review pass.")
  .option("--all", "Approve all candidate memories.")
  .option("--safe", "Approve only candidates that still review as low-risk novel memories.")
  .action(async (memoryId: string | undefined, options: { all?: boolean; safe?: boolean }) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const resolution = options.safe
      ? resolveSafeCandidateRecords(records, memoryId, options.all)
      : { matches: resolveCandidateRecords(records, memoryId, options.all), skipped: [] as SafeCandidateRecord[] };
    const matches = resolution.matches;

    if (options.safe && matches.length === 0) {
      const suffix =
        resolution.skipped.length > 0
          ? ` ${resolution.skipped.length} candidate memor${resolution.skipped.length === 1 ? "y still requires" : "ies still require"} manual review.`
          : "";
      output.write(`No safe candidate memories found.${suffix}\n`);
      return;
    }

    for (const entry of matches) {
      await approveCandidateMemory(entry, projectRoot);
    }

    await updateIndex(projectRoot);
    output.write(
      `Approved ${matches.length} ${options.safe ? "safe " : ""}candidate memor${matches.length === 1 ? "y" : "ies"}.\n`,
    );

    if (options.safe && resolution.skipped.length > 0) {
      output.write(
        `${resolution.skipped.length} candidate memor${resolution.skipped.length === 1 ? "y still requires" : "ies still require"} manual review.\n`,
      );
    }
  });

program
  .command("dismiss [memoryId]")
  .description("Dismiss one candidate memory, or all candidates with --all.")
  .option("--all", "Dismiss all candidate memories.")
  .action(async (memoryId: string | undefined, options: { all?: boolean }) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const matches = resolveCandidateRecords(records, memoryId, options.all);

    for (const entry of matches) {
      await updateStoredMemoryStatus(entry, "stale");
    }

    await updateIndex(projectRoot);
    output.write(`Dismissed ${matches.length} candidate memor${matches.length === 1 ? "y" : "ies"}.\n`);
  });

program
  .command("supersede <newMemoryFile> <oldMemoryFile>")
  .description("Link a newer memory to an older one and mark the older memory as stale.")
  .option("--yes", "Overwrite an existing supersede relationship without prompting.")
  .action(async (newMemoryFile: string, oldMemoryFile: string, options: { yes?: boolean }) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const newRecord = resolveStoredMemoryByFile(records, newMemoryFile);
    const oldRecord = resolveStoredMemoryByFile(records, oldMemoryFile);

    if (newRecord.filePath === oldRecord.filePath) {
      throw new Error("Choose two different memory files for supersede.");
    }

    const newRelativePath = toBrainRelativePath(newRecord.relativePath);
    const oldRelativePath = toBrainRelativePath(oldRecord.relativePath);
    const nextVersion = (oldRecord.memory.version ?? 1) + 1;
    const relationshipState = describeSupersedeState(newRecord, oldRecord, newRelativePath, oldRelativePath);

    if (relationshipState.alreadyLinked) {
      output.write(
        `[brain] 该取代关系已存在\n  新记忆: ${newRelativePath} (v${newRecord.memory.version ?? nextVersion})\n  旧记忆: ${oldRelativePath} → 已标记为 stale\n`,
      );
      return;
    }

    if (relationshipState.hasExistingRelationship) {
      output.write(`[brain] 当前已存在取代关系:\n`);
      for (const line of relationshipState.details) {
        output.write(`  ${line}\n`);
      }

      if (!options.yes) {
        const confirmed = await confirmSupersedeOverwrite();
        if (!confirmed) {
          output.write("[brain] supersede cancelled.\n");
          return;
        }
      }
    }

    const result = await supersedeMemoryPair(newRecord, oldRecord);
    await updateIndex(projectRoot);
    output.write(
      `✓ [brain] 已建立取代关系\n  新记忆: ${newRelativePath}  (v${result.newVersion})\n  旧记忆: ${oldRelativePath}  → 已标记为 stale\n`,
    );
  });

program
  .command("lineage [memoryFile]")
  .description("Render memory lineage trees from the current .brain store.")
  .action(async (memoryFile: string | undefined) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const rendered = renderMemoryLineage(records, memoryFile);
    output.write(`${rendered}\n`);
  });

program
  .command("share [memoryId]")
  .description("Suggest git commands for sharing one memory or all active memories.")
  .option("--all-active", "Share all active memories in .brain.")
  .action(async (memoryId: string | undefined, options: { allActive?: boolean }) => {
    const projectRoot = process.cwd();
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
  .command("route")
  .alias("start")
  .description(
    "Build a session/task routing bundle by combining inject context and suggest-skills output. " +
    'Use "brain route --task \\"fix refund bug\\"" or the alias "brain start".',
  )
  .option("--task <task>", "Task description to route.")
  .option(
    "--path <path>",
    "Override changed paths (skips git diff auto-detection). Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option(
    "--module <module>",
    "Module or subsystem keywords to prioritize during inject. Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option("--json", 'Print the combined bundle as JSON. Equivalent to "--format json".')
  .option("--format <format>", 'Output format: "markdown" or "json".', "markdown")
  .action(async (options: {
    task?: string;
    path: string[];
    module: string[];
    json?: boolean;
    format?: string;
  }) => {
    const projectRoot = process.cwd();
    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
    if (config.sweepOnInject) {
      await initBrain(projectRoot);
      await runSweepAuto(projectRoot, config, (line) => process.stderr.write(`${line}\n`), true);
    }

    const task = options.task?.trim() || (await readOptionalStdin());
    if (!task) {
      throw new Error('Provide a task with "--task" (or stdin) before running "brain route".');
    }

    const resolvedPaths = resolveSuggestedSkillPaths(projectRoot, options.path);
    const bundle = await buildTaskRoutingBundle(projectRoot, config, {
      task,
      paths: resolvedPaths.paths,
      path_source: resolvedPaths.path_source,
      modules: options.module,
      warnings: resolvedPaths.warnings,
    });

    const format = resolveSuggestSkillsOutputFormat(options);
    output.write(
      format === "json"
        ? `${renderTaskRoutingBundleJson(bundle)}\n`
        : `${renderTaskRoutingBundle(bundle)}\n`,
    );
  });

program
  .command("suggest-skills")
  .description(
    "Suggest a skill shortlist from the current task, changed paths, and matched memories. " +
    "When --path is omitted, paths are auto-collected from git diff --name-only HEAD. " +
    'Simplest usage: brain suggest-skills --task "fix refund bug"',
  )
  .option("--task <task>", "Task description to match against skill_trigger_tasks.")
  .option(
    "--path <path>",
    "Override changed paths (skips git diff auto-detection). Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option("--json", 'Print the result as JSON. Equivalent to "--format json".')
  .option("--format <format>", 'Output format: "markdown" or "json".', "markdown")
  .action(async (options: { task?: string; path: string[]; json?: boolean; format?: string }) => {
    const projectRoot = process.cwd();
    const task = options.task?.trim() || (await readOptionalStdin());
    const resolvedPaths = resolveSuggestedSkillPaths(projectRoot, options.path);
    const paths = resolvedPaths.paths;
    const pathSource: PathSource = resolvedPaths.path_source;

    const result = await buildSkillShortlist(projectRoot, {
      ...(task ? { task } : {}),
      paths,
      path_source: pathSource,
    });

    const format = resolveSuggestSkillsOutputFormat(options);
    output.write(
      format === "json"
        ? `${renderSkillShortlistJson(result)}\n`
        : `${renderSkillShortlist(result)}\n`,
    );
  });

program
  .command("suggest-extract")
  .description(
    "Evaluate whether the current session or change is worth extracting as durable memory. " +
    "Uses local deterministic rules only.",
  )
  .option("--task <task>", "Current task description.")
  .option(
    "--path <path>",
    "Override changed paths (skips git diff auto-detection). Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option("--rev <revision>", "Git revision for commit context.", "HEAD")
  .option("--test-summary <text>", "Optional test result summary text.")
  .option("--json", 'Print the result as JSON. Equivalent to "--format json".')
  .option("--format <format>", 'Output format: "markdown" or "json".', "markdown")
  .action(async (options: {
    task?: string;
    path: string[];
    rev?: string;
    testSummary?: string;
    json?: boolean;
    format?: string;
  }) => {
    const projectRoot = process.cwd();
    const task = options.task?.trim() || undefined;
    const sessionSummary = (await readOptionalStdin())?.trim() || undefined;
    const changedFiles = resolveChangedFiles(projectRoot, options.path);
    const commitContext = await safeLoadCommitContext(projectRoot, options.rev ?? "HEAD");

    const result = evaluateExtractWorthiness({
      task,
      sessionSummary,
      changedFiles,
      commitMessage: commitContext.commitMessage,
      diffStat: commitContext.diffStat,
      testResultSummary: options.testSummary?.trim() || undefined,
      source: commitContext.commitMessage ? "git-commit" : "session",
    });

    const format = resolveSuggestSkillsOutputFormat(options);
    output.write(
      format === "json"
        ? `${renderExtractSuggestionJson(result)}\n`
        : `${renderExtractSuggestionMarkdown(result)}\n`,
    );
  });

program
  .command("capture")
  .description(
    "Evaluate whether the current session or change is worth extracting, " +
    "and save as candidate memory when recommended. " +
    "Combines suggest-extract detection with the extract pipeline.",
  )
  .option("--task <task>", "Current task description.")
  .option(
    "--path <path>",
    "Override changed paths (skips git diff auto-detection). Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .option("--rev <revision>", "Git revision for commit context.", "HEAD")
  .option("--test-summary <text>", "Optional test result summary text.")
  .option("--source <source>", "Memory source label.", "session")
  .option("--type <type>", "Force a memory type for extracted entries (overrides suggested_type).", parseMemoryTypeOption)
  .option("--force-candidate", "Save as candidate even when signals are ambiguous (not clearly positive).")
  .option("--json", 'Print the capture result as JSON. Equivalent to "--format json".')
  .option("--format <format>", 'Output format: "markdown" or "json".', "markdown")
  .action(async (options: {
    task?: string;
    path: string[];
    rev?: string;
    testSummary?: string;
    source: Memory["source"];
    type?: MemoryType;
    forceCandidate?: boolean;
    json?: boolean;
    format?: string;
  }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);

    const task = options.task?.trim() || undefined;
    const sessionSummary = (await readOptionalStdin())?.trim() || undefined;
    const changedFiles = resolveChangedFiles(projectRoot, options.path);
    const commitContext = await safeLoadCommitContext(projectRoot, options.rev ?? "HEAD");

    const suggestion = evaluateExtractWorthiness({
      task,
      sessionSummary,
      changedFiles,
      commitMessage: commitContext.commitMessage,
      diffStat: commitContext.diffStat,
      testResultSummary: options.testSummary?.trim() || undefined,
      source: commitContext.commitMessage ? "git-commit" : "session",
    });

    const shouldProceed = suggestion.should_extract || (options.forceCandidate && suggestion.confidence < 0.5);

    if (!shouldProceed) {
      const format = resolveSuggestSkillsOutputFormat(options);
      const captureResult: CaptureResult = {
        action: "skipped",
        reason: suggestion.summary,
        suggestion,
        saved_paths: [],
      };

      if (format === "json") {
        output.write(`${JSON.stringify(captureResult, null, 2)}\n`);
      } else {
        output.write("[capture] Not recommended for extraction.\n");
        output.write(`Reason: ${suggestion.summary}\n`);
        if (suggestion.evidence.length > 0) {
          output.write("Evidence:\n");
          for (const e of suggestion.evidence) {
            const mark = e.signal === "positive" ? "+" : e.signal === "negative" ? "-" : "~";
            output.write(`  [${mark}${Math.abs(e.weight).toFixed(1)}] ${e.rule}: ${e.detail}\n`);
          }
        }
        if (!options.forceCandidate) {
          output.write('Tip: use "--force-candidate" to save as candidate despite ambiguous signals.\n');
        }
      }
      return;
    }

    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));

    const rawInput = buildCaptureExtractionInput(task, sessionSummary, commitContext, changedFiles, options.testSummary);
    const resolvedType = options.type ?? suggestion.suggested_type ?? undefined;

    const savedPaths = await runExtractionWorkflow(projectRoot, config, rawInput, {
      source: options.source ?? "session",
      ...(resolvedType ? { type: resolvedType } : {}),
      candidate: true,
    });

    const format = resolveSuggestSkillsOutputFormat(options);
    const captureResult: CaptureResult = {
      action: savedPaths.length > 0 ? "saved_as_candidate" : "extraction_empty",
      reason: suggestion.summary,
      suggestion,
      saved_paths: savedPaths,
    };

    if (format === "json") {
      output.write(`${JSON.stringify(captureResult, null, 2)}\n`);
    } else if (savedPaths.length === 0) {
      output.write("[capture] Extraction recommended but no memories were produced from the input.\n");
      output.write(`Suggestion: ${suggestion.summary}\n`);
    }
  });

program
  .command("lint-memory")
  .description("Lint memory frontmatter schema health without modifying files.")
  .option("--json", "Print the schema report as JSON.")
  .action(async (options: { json?: boolean }) => {
    const projectRoot = process.cwd();
    const result = await buildMemorySchemaReport(projectRoot);
    output.write(
      options.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderMemorySchemaReport(result)}\n`,
    );
  });

program
  .command("normalize-memory")
  .description("Normalize compatible memory frontmatter in place and report any manual-fix schema issues.")
  .option("--json", "Print the normalization result as JSON.")
  .action(async (options: { json?: boolean }) => {
    const projectRoot = process.cwd();
    const result = await normalizeMemorySchemas(projectRoot);
    await updateIndex(projectRoot);
    output.write(
      options.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderMemoryNormalizeReport(result)}\n`,
    );
  });

program
  .command("audit-memory")
  .description("Audit stored memories for stale, conflict, low-signal, and overscoped entries.")
  .option("--json", "Print the audit result as JSON.")
  .action(async (options: { json?: boolean }) => {
    const projectRoot = process.cwd();
    const result = await buildMemoryAudit(projectRoot);
    output.write(
      options.json ? `${JSON.stringify(result, null, 2)}\n` : `${renderMemoryAuditResult(result)}\n`,
    );
  });

program
  .command("reinforce")
  .description("Apply queued reinforcement suggestions, or analyze stdin for repeated failures and then reinforce memories.")
  .option("--source <source>", "Input source label for analysis context", "session")
  .option("--pending", "Apply pending reinforcement suggestions saved by the session-end workflow.")
  .option("--yes", "Skip confirmation and apply reinforcement immediately.")
  .action(async (options: { source: "session" | "git-commit"; pending?: boolean; yes?: boolean }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);

    const records = await loadStoredMemoryRecords(projectRoot);
    const pendingState = await loadPendingReinforcementState(projectRoot);
    const stdinText = options.pending ? "" : await readStdin();
    if (!options.pending && !stdinText.trim()) {
      if (pendingState.events.length > 0) {
        throw new Error('Provide stdin, or run "brain reinforce --pending" to apply queued reinforcement suggestions.');
      }
      throw new Error("Provide a session summary or commit message over stdin.");
    }

    const events = options.pending
      ? pendingState.events
      : detectFailures(
          options.source === "git-commit" ? `Source: git-commit\n\n${stdinText}` : stdinText,
          records.map((entry) => ({
            ...entry.memory,
            filePath: entry.filePath,
            relativePath: entry.relativePath,
          })),
        );

    if (events.length === 0 && options.pending) {
      output.write("[brain] No pending reinforcement suggestions were queued.\n");
      return;
    }

    if (events.length === 0) {
      output.write("[brain] 本次 session 未发现需要强化的记忆 ✓\n");
      return;
    }

    output.write(`Detected ${events.length} failure event${events.length === 1 ? "" : "s"}:\n`);
    for (const [index, event] of events.entries()) {
      output.write(`${renderFailureEventLine(index + 1, event)}\n`);
    }

    if (!options.yes) {
      const confirmed = await confirmReinforcement();
      if (!confirmed) {
        output.write("[brain] reinforcement cancelled.\n");
        return;
      }
    }

    const result = await reinforceMemories(events, getBrainDir(projectRoot));
    if (options.pending) {
      await clearPendingReinforcementEvents(projectRoot);
    }
    await updateIndex(projectRoot);
    output.write(
      `[brain] reinforcement complete: boosted=${result.boosted.length}, rewritten=${result.rewritten.length}, extracted=${result.extracted.length}\n`,
    );
  });

program
  .command("score")
  .description("Find low-quality or outdated memories before running brain sweep to clean them up.")
  .option("--mark-all", "Mark all matched memories as stale without prompting.")
  .option("--delete-all", "Delete all matched memories without prompting.")
  .option("--json", "Print matched memories as JSON and do not prompt.")
  .action(async (options: { markAll?: boolean; deleteAll?: boolean; json?: boolean }) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const candidates = buildScoreCandidates(records);

    if (candidates.length === 0) {
      output.write(options.json ? `${JSON.stringify([], null, 2)}\n` : "No memories matched the current score review rules.\n");
      return;
    }

    if (options.markAll && options.deleteAll) {
      throw new Error('Choose only one of "--mark-all" or "--delete-all".');
    }

    if (options.json) {
      output.write(`${JSON.stringify(candidates.map(toScoreCandidateJson), null, 2)}\n`);
      return;
    }

    output.write(`${renderScoreTable(candidates)}\n`);

    let marked = 0;
    let deleted = 0;
    let skipped = 0;
    let quit = false;

    if (options.markAll) {
      for (const candidate of candidates) {
        await updateStoredMemoryStatus(candidate.record, "stale");
        marked += 1;
      }

      await updateIndex(projectRoot);
      output.write(`Summary: marked=${marked}, deleted=${deleted}, skipped=${skipped}\n`);
      return;
    }

    if (options.deleteAll) {
      for (const candidate of candidates) {
        await rm(candidate.record.filePath, { force: true });
        deleted += 1;
      }

      await updateIndex(projectRoot);
      output.write(`Summary: marked=${marked}, deleted=${deleted}, skipped=${skipped}\n`);
      return;
    }

    const promptAction = await createScoreActionPrompter();

    try {
      for (const candidate of candidates) {
        const action = await promptAction(path.basename(candidate.record.filePath));
        if (action === "q") {
          quit = true;
          break;
        }

        if (action === "s") {
          await updateStoredMemoryStatus(candidate.record, "stale");
          marked += 1;
          continue;
        }

        if (action === "d") {
          await rm(candidate.record.filePath, { force: true });
          deleted += 1;
          continue;
        }

        skipped += 1;
      }
    } finally {
      await promptAction.close();
    }

    if (marked > 0 || deleted > 0) {
      await updateIndex(projectRoot);
    }

    if (quit) {
      output.write("Score review exited early.\n");
    }

    output.write(`Summary: marked=${marked}, deleted=${deleted}, skipped=${skipped}\n`);
  });

program
  .command("mcp")
  .description("Run RepoBrain as a minimal MCP stdio server.")
  .action(async () => {
    await runMcpServer(process.cwd());
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function runExtractionWorkflow(
  projectRoot: string,
  config: BrainConfig,
  rawInput: string,
  options: {
    source: Memory["source"];
    type?: MemoryType;
    candidate?: boolean;
  },
): Promise<string[]> {
  const memories = (await extractMemories(rawInput, config, projectRoot))
    .map((memory) => applyExtractedMemoryDefaults(memory, options.type));
  const existingRecords = await loadStoredMemoryRecords(projectRoot);
  const reviewedCandidates = reviewCandidateMemories(memories, existingRecords);
  const savedPaths: string[] = [];
  const deferredCandidates: string[] = [];
  const rejectedCandidates: string[] = [];

  for (const entry of reviewedCandidates) {
    const { memory, review } = entry;
    const toSave: Memory = {
      ...memory,
      ...(options.source ? { source: options.source } : {}),
    };

    if (review.decision === "reject") {
      rejectedCandidates.push(memory.title);
      continue;
    }

    const resolvedStatus =
      options.candidate || review.decision !== "accept" ? ("candidate" as const) : undefined;
    const savedPath = await saveMemory(
      resolvedStatus
        ? {
            ...toSave,
            status: resolvedStatus,
          }
        : toSave,
      projectRoot,
    );
    savedPaths.push(savedPath);

    if (review.decision !== "accept") {
      deferredCandidates.push(memory.title);
    }
  }

  await updateIndex(projectRoot);
  output.write(`Reviewed ${reviewedCandidates.length} extracted memor${reviewedCandidates.length === 1 ? "y" : "ies"}.\n`);
  for (const entry of reviewedCandidates) {
    output.write(
      `- ${entry.review.decision} | targets=${entry.review.target_memory_ids.join(", ") || "-"} | reason=${entry.review.reason} | ${entry.memory.title}\n`,
    );
  }

  output.write(
    `Saved ${savedPaths.length} memor${savedPaths.length === 1 ? "y" : "ies"}${options.candidate ? " as candidates" : ""}.\n`,
  );
  for (const savedPath of savedPaths) {
    output.write(`- ${savedPath}\n`);
  }

  if (deferredCandidates.length > 0) {
    output.write(
      `${deferredCandidates.length} memor${deferredCandidates.length === 1 ? "y" : "ies"} were kept as candidates because the review decision requires confirmation.\n`,
    );
  }

  if (rejectedCandidates.length > 0) {
    output.write(
      `${rejectedCandidates.length} memor${rejectedCandidates.length === 1 ? "y" : "ies"} were rejected and not written.\n`,
    );
  }

  return savedPaths;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function runSweepAuto(
  projectRoot: string,
  config: BrainConfig,
  writeLine: (line: string) => void,
  quietWhenNoActions = false,
): Promise<void> {
  const result = await applySweepAuto(projectRoot, config);
  result.lines.forEach((line) => writeLine(line));

  if (!quietWhenNoActions || result.changed || result.scan.duplicatePairs.length > 0) {
    writeLine("brain sweep 扫描完成");
    writeLine(`过期 working 记忆: ${result.scan.expiredWorking.length}`);
    writeLine(`陈旧记忆: ${result.scan.staleMemories.length}`);
    writeLine(`可疑重复对: ${result.scan.duplicatePairs.length}`);
    writeLine(`已完成 goal: ${result.scan.archiveGoals.length}`);
  }
}

async function runSweepInteractive(projectRoot: string, config: BrainConfig): Promise<void> {
  const terminal = await createPromptTerminal();
  if (!terminal) {
    throw new Error('Interactive sweep requires a TTY. Re-run with "--auto" or "--dry-run".');
  }

  const rl = createInterface({
    input: terminal.input,
    output: terminal.output,
  });

  let changed = false;
  const deletedPaths = new Set<string>();

  try {
    const result = await scanSweepCandidates(projectRoot, config);
    const today = getTodayDate();

    for (const entry of result.expiredWorking) {
      const answer = (await rl.question(`? 删除已过期的 working 记忆 "${entry.record.memory.title}"？[Y/n] `))
        .trim()
        .toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") {
        await deleteExpiredWorking(entry);
        changed = true;
        output.write(`[EXPIRED]  已删除 ${toDisplayPath(entry.record)}\n`);
      }
    }

    for (const entry of result.staleMemories) {
      const answer = (
        await rl.question(
          `? 降权 ${entry.daysSinceUpdated} 天未更新的记忆 "${entry.record.memory.title}"（${entry.record.memory.importance} → ${entry.nextImportance}）？[Y/n] `,
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") {
        await downgradeStaleMemory(entry, today);
        changed = true;
        output.write(`[STALE]    已降权 ${toDisplayPath(entry.record)}\n`);
      }
    }

    for (const entry of result.duplicatePairs) {
      if (deletedPaths.has(entry.left.filePath) || deletedPaths.has(entry.right.filePath)) {
        continue;
      }

      output.write("? 发现可能重复的记忆：\n");
      output.write(`[1] ${toDisplayPath(entry.left, false)}: "${entry.left.memory.title}"\n`);
      for (const line of previewMemoryLines(entry.left)) {
        output.write(`    ${line}\n`);
      }
      output.write(`[2] ${toDisplayPath(entry.right, false)}: "${entry.right.memory.title}"\n`);
      for (const line of previewMemoryLines(entry.right)) {
        output.write(`    ${line}\n`);
      }

      const answer = (
        await rl.question("操作: (1) 保留两者  (2) 删除 [1]  (3) 删除 [2]  (4) 跳过 ")
      )
        .trim()
        .toLowerCase();

      if (answer === "2") {
        await rm(entry.left.filePath, { force: true });
        deletedPaths.add(entry.left.filePath);
        changed = true;
        output.write(`[POSSIBLE-DUP] 已删除 ${toDisplayPath(entry.left)}\n`);
      } else if (answer === "3") {
        await rm(entry.right.filePath, { force: true });
        deletedPaths.add(entry.right.filePath);
        changed = true;
        output.write(`[POSSIBLE-DUP] 已删除 ${toDisplayPath(entry.right)}\n`);
      }
    }

    for (const entry of result.archiveGoals) {
      if (deletedPaths.has(entry.record.filePath)) {
        continue;
      }

      const answer = (
        await rl.question(`? 将已完成 30+ 天的目标 "${entry.record.memory.title}" 归档到 .brain/archive/？[Y/n] `)
      )
        .trim()
        .toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") {
        const archivedPath = await archiveGoalMemory(projectRoot, entry);
        changed = true;
        output.write(
          `[ARCHIVE]  已归档 ${toDisplayPath(entry.record)} → ${path.relative(projectRoot, archivedPath).replace(/\\/g, "/")}\n`,
        );
      }
    }

    if (changed) {
      await updateIndex(projectRoot);
    }
  } finally {
    rl.close();
    terminal.close();
  }
}

async function promptSteeringRulesChoice(): Promise<"claude" | "codex" | "cursor" | "all" | "both" | "skip"> {
  const rl = createInterface({
    input,
    output,
  });

  try {
    output.write("? 你使用哪个 AI 编码工具？（用于生成 steering rules）\n");
    output.write("1. Claude Code（生成 .claude/rules/brain-session.md）\n");
    output.write("2. Codex（补充 .codex/brain-session.md）\n");
    output.write("3. Cursor（生成 .cursor/rules/brain-session.mdc）\n");
    output.write("4. 全部\n");
    output.write("5. 跳过\n");

    while (true) {
      const answer = (await rl.question("选择 [5]: ")).trim().toLowerCase();
      if (!answer || answer === "5" || answer === "skip") {
        return "skip";
      }
      if (answer === "1" || answer === "claude" || answer === "claude code") {
        return "claude";
      }
      if (answer === "2" || answer === "codex") {
        return "codex";
      }
      if (answer === "3" || answer === "cursor") {
        return "cursor";
      }
      if (answer === "4" || answer === "all" || answer === "both" || answer === "全部") {
        return "all";
      }

      output.write('请输入 1-5，或输入 "claude" / "codex" / "cursor" / "all" / "skip"。\n');
    }
  } finally {
    rl.close();
  }
}

interface WorkflowSnapshot {
  workflow: ReturnType<typeof getWorkflowPreset>;
  candidateCount: number;
  safeCandidateCount: number;
  pendingReinforceCount: number;
  cleanupCount: number;
  reminders: string[];
  nextSteps: string[];
}

async function applyWorkflowPresetConfig(projectRoot: string, workflowMode: WorkflowMode): Promise<void> {
  const currentConfig = await loadConfig(projectRoot);
  const preset = getWorkflowPreset(workflowMode);
  await writeConfig(projectRoot, {
    ...currentConfig,
    workflowMode,
    extractMode: preset.extractMode,
    sweepOnInject: preset.sweepOnInject,
  });
}

function resolveSteeringRulesChoice(
  value: string | undefined,
  skip: boolean | undefined,
): "claude" | "codex" | "cursor" | "all" | "both" | "skip" {
  if (skip) {
    return "skip";
  }

  if (!value) {
    return "all";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "claude" || normalized === "codex" || normalized === "cursor" ||
    normalized === "all" || normalized === "both" || normalized === "skip"
  ) {
    return normalized;
  }

  throw new Error('Use "--steering-rules claude", "--steering-rules codex", "--steering-rules cursor", "--steering-rules all", or "--skip-steering-rules".');
}

function renderWorkflowSummaryLines(workflowMode: WorkflowMode): string[] {
  const preset = getWorkflowPreset(workflowMode);
  return [
    `Workflow: ${preset.label} (${preset.mode})`,
    `Automation: ${preset.automationLevel}`,
    `Fit: ${preset.audience}`,
    `Risk: ${preset.risk}`,
  ];
}

function renderSetupNextSteps(workflowMode: WorkflowMode): string[] {
  const preset = getWorkflowPreset(workflowMode);
  const steps = [
    'Start each session with "brain inject".',
    'End sessions by extracting candidates with "brain extract" or let the hook queue them for review.',
    'Use "brain review" and "brain approve --safe" as the normal daily promotion loop.',
  ];

  if (preset.mode === "ultra-safe-manual") {
    steps[1] = 'End sessions with "brain extract" or "brain extract-commit" because this mode keeps extraction manual.';
  }

  if (preset.mode === "automation-first") {
    steps.push('Check "brain status" regularly because this mode auto-applies the clearest low-risk paths.');
  }

  return steps;
}

function formatSteeringRulesStatus(status: {
  claudeConfigured: boolean;
  codexConfigured: boolean;
  cursorConfigured: boolean;
}): string {
  const configured: string[] = [];
  if (status.claudeConfigured) {
    configured.push("claude");
  }
  if (status.codexConfigured) {
    configured.push("codex");
  }
  if (status.cursorConfigured) {
    configured.push("cursor");
  }

  return configured.length > 0 ? configured.join(", ") : 'missing (run "brain init --steering-rules all")';
}

async function buildWorkflowSnapshot(
  projectRoot: string,
  config: BrainConfig,
  memories: Memory[],
): Promise<WorkflowSnapshot> {
  const records = await loadStoredMemoryRecords(projectRoot);
  const candidateRecords = getCandidateRecords(records);
  const safeCandidateCount = candidateRecords.filter((entry) =>
    isSafeCandidateReview(
      reviewCandidateMemory(
        entry.memory,
        records.filter((record) => record.filePath !== entry.filePath),
      ),
    ),
  ).length;
  const pendingReinforcement = await loadPendingReinforcementState(projectRoot);
  const sweepResult = await scanSweepCandidates(projectRoot, config).catch(() => null);
  const cleanupCount = sweepResult
    ? sweepResult.expiredWorking.length +
      sweepResult.staleMemories.length +
      sweepResult.archiveGoals.length +
      sweepResult.duplicatePairs.length
    : buildScoreCandidates(records).length;
  const reminders: string[] = [];
  const nextSteps: string[] = [];
  const workflow = getWorkflowPreset(config.workflowMode);

  if (candidateRecords.length > 0) {
    reminders.push(
      `You have ${candidateRecords.length} candidate memor${candidateRecords.length === 1 ? "y" : "ies"} waiting for review.`,
    );
    nextSteps.push(
      safeCandidateCount > 0
        ? `run "brain review" and then "brain approve --safe" for ${safeCandidateCount} low-risk candidate memor${safeCandidateCount === 1 ? "y" : "ies"}`
        : 'run "brain review" to inspect the pending candidate queue before approving anything',
    );
  }

  if (pendingReinforcement.events.length > 0) {
    reminders.push(
      `You have ${pendingReinforcement.events.length} reinforcement suggestion${pendingReinforcement.events.length === 1 ? "" : "s"} waiting to be applied.`,
    );
    nextSteps.push(
      `run "brain reinforce --pending" to apply ${pendingReinforcement.events.length} queued reinforcement suggestion${pendingReinforcement.events.length === 1 ? "" : "s"}`,
    );
  }

  if (cleanupCount > 0) {
    reminders.push(
      `You have ${cleanupCount} stale, expired, duplicate, or archive-ready memor${cleanupCount === 1 ? "y" : "ies"} to clean up.`,
    );
    nextSteps.push('run "brain score" or "brain sweep --dry-run" to inspect cleanup candidates');
  }

  if (memories.length === 0) {
    nextSteps.push('capture your first durable lesson with "brain extract" after the next meaningful task');
  }

  if (nextSteps.length === 0) {
    nextSteps.push('run "brain inject" before the next coding session');
  }

  return {
    workflow,
    candidateCount: candidateRecords.length,
    safeCandidateCount,
    pendingReinforceCount: pendingReinforcement.events.length,
    cleanupCount,
    reminders,
    nextSteps,
  };
}

async function readOptionalStdin(): Promise<string | undefined> {
  if (input.isTTY) {
    return undefined;
  }

  const stdinText = (await readStdin()).trim();
  return stdinText || undefined;
}

function collectValues(value: string, previous: string[]): string[] {
  return [
    ...previous,
    ...value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ];
}

function resolveSuggestSkillsOutputFormat(options: {
  json?: boolean;
  format?: string;
}): "markdown" | "json" {
  const format = options.format?.trim().toLowerCase() || "markdown";
  if (format !== "markdown" && format !== "json") {
    throw new Error('Use "--format markdown" or "--format json".');
  }

  if (options.json && format !== "json" && options.format) {
    throw new Error('Use either "--json" or "--format json", not both with different values.');
  }

  return options.json ? "json" : format;
}

function parseMemoryTypeOption(value: string): MemoryType {
  const normalized = value.trim().toLowerCase();
  if (MEMORY_TYPES.includes(normalized as MemoryType)) {
    return normalized as MemoryType;
  }

  throw new Error(`Unsupported memory type "${value}". Expected one of: ${MEMORY_TYPES.join(", ")}.`);
}

function applyExtractedMemoryDefaults(memory: Memory, forcedType?: MemoryType): Memory {
  const type = forcedType ?? memory.type;
  const today = getTodayDate();
  const nextMemory: Memory = {
    ...memory,
    type,
    created: memory.created ?? today,
    updated: today,
  };

  if (type === "working" && !nextMemory.expires) {
    nextMemory.expires = addDays(today, 7);
  }

  if (type === "goal" && !nextMemory.status) {
    nextMemory.status = "active";
  }

  return nextMemory;
}

function getTodayDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00`);
  base.setDate(base.getDate() + days);
  return getTodayDate(base);
}

function formatCountMap(map: Map<string, number>): string {
  return Array.from(map.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function formatMemoryListLine(memory: Memory): string {
  const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
  const status = getMemoryStatus(memory);
  return `${memory.date} | ${memory.type} | ${memory.importance} | ${status} | ${memory.title}${tags}`;
}

function renderGoalList(memories: Memory[]): string {
  const grouped = new Map<string, Memory[]>();

  for (const memory of memories) {
    const status = getMemoryStatus(memory);
    const bucket = grouped.get(status) ?? [];
    bucket.push(memory);
    grouped.set(status, bucket);
  }

  return Array.from(grouped.entries())
    .sort(([leftStatus], [rightStatus]) => compareGoalStatus(leftStatus, rightStatus))
    .map(([status, entries]) => {
      const lines = entries.map((memory) => `- ${formatMemoryListLine(memory)}`);
      return [`[${status}]`, ...lines].join("\n");
    })
    .join("\n");
}

function compareGoalStatus(left: string, right: string): number {
  const order = ["active", "done", "stale", "candidate", "superseded"];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);

  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) {
      return 1;
    }

    if (rightIndex === -1) {
      return -1;
    }

    return leftIndex - rightIndex;
  }

  return left.localeCompare(right);
}

function formatMemoryList(memories: Array<Memory | MemoryActivityEntry>): string {
  if (memories.length === 0) {
    return "- None.";
  }

  return memories
    .map((memory) => {
      const status =
        "status" in memory && typeof memory.status === "string" ? ` | ${memory.status}` : "";
      return `- ${memory.type} | ${memory.importance}${status} | ${memory.title} (${memory.date})`;
    })
    .join("\n");
}

function resolveStoredMemoryByFile(records: StoredMemoryRecord[], rawQuery: string): StoredMemoryRecord {
  const query = rawQuery.trim();
  if (!query) {
    throw new Error('Provide a memory file path like "decisions/use-tsup.md".');
  }

  const matches = records.filter((entry) => matchesStoredMemoryFile(entry, query));
  const firstMatch = matches[0];
  if (matches.length === 1 && firstMatch) {
    return firstMatch;
  }

  if (matches.length > 1) {
    throw new Error(
      [
        `Multiple memory files matched "${rawQuery}".`,
        "Use a more specific path under .brain/:",
        ...matches.map((entry) => `- ${toBrainRelativePath(entry.relativePath)}`),
      ].join("\n"),
    );
  }

  throw new Error(
    `Memory file "${rawQuery}" was not found. Run "brain list" to inspect available memories.`,
  );
}

function matchesStoredMemoryFile(entry: StoredMemoryRecord, rawQuery: string): boolean {
  const query = normalizeMemoryPathQuery(rawQuery);
  const brainRelativePath = normalizeMemoryPathQuery(toBrainRelativePath(entry.relativePath));
  const undatedRelativePath = normalizeMemoryPathQuery(toUndatedBrainRelativePath(entry.relativePath));
  const fileName = normalizeMemoryPathQuery(path.basename(entry.relativePath));
  const fileStem = normalizeMemoryPathQuery(path.basename(entry.relativePath, path.extname(entry.relativePath)));

  return (
    brainRelativePath === query ||
    undatedRelativePath === query ||
    fileName === query ||
    fileStem === query
  );
}

function normalizeMemoryPathQuery(value: string): string {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.brain\//, "")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function toBrainRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.brain\//, "");
}

function toUndatedBrainRelativePath(relativePath: string): string {
  const normalized = toBrainRelativePath(relativePath);
  const directory = path.posix.dirname(normalized);
  const fileName = path.posix.basename(normalized);
  const undecorated = fileName
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/-\d{9}(?:-\d+)?\.md$/, ".md");

  return directory === "." ? undecorated : `${directory}/${undecorated}`;
}

function describeSupersedeState(
  newRecord: StoredMemoryRecord,
  oldRecord: StoredMemoryRecord,
  desiredNewPath: string,
  desiredOldPath: string,
): {
  alreadyLinked: boolean;
  hasExistingRelationship: boolean;
  details: string[];
} {
  const details: string[] = [];
  const currentNewSupersedes = newRecord.memory.supersedes;
  const currentOldSupersededBy = oldRecord.memory.superseded_by;

  if (currentNewSupersedes && currentNewSupersedes !== desiredOldPath) {
    details.push(`新记忆当前 supersedes: ${currentNewSupersedes}`);
  }

  if (currentOldSupersededBy && currentOldSupersededBy !== desiredNewPath) {
    details.push(`旧记忆当前 superseded_by: ${currentOldSupersededBy}`);
  }

  return {
    alreadyLinked:
      currentNewSupersedes === desiredOldPath &&
      currentOldSupersededBy === desiredNewPath &&
      oldRecord.memory.stale === true,
    hasExistingRelationship: details.length > 0,
    details,
  };
}

function renderMemoryLineage(records: StoredMemoryRecord[], rawQuery?: string): string {
  const lineageNodes = new Map<string, StoredMemoryRecord>();
  const supersedesByNode = new Map<string, string | null>();
  const supersededByNode = new Map<string, string[]>();

  for (const record of records) {
    const pathKey = toBrainRelativePath(record.relativePath);
    const hasLineage = Boolean(record.memory.supersedes || record.memory.superseded_by);
    if (!hasLineage) {
      continue;
    }

    lineageNodes.set(pathKey, record);
    supersedesByNode.set(pathKey, record.memory.supersedes ?? null);
    supersededByNode.set(pathKey, []);
  }

  const matchedRecord = rawQuery ? resolveStoredMemoryByFile(records, rawQuery) : null;
  if (lineageNodes.size === 0) {
    if (matchedRecord) {
      return `Memory "${toBrainRelativePath(matchedRecord.relativePath)}" has no lineage relationships.`;
    }

    return "No memory lineage found.";
  }

  for (const [pathKey, record] of lineageNodes.entries()) {
    const supersedes = record.memory.supersedes;
    if (!supersedes) {
      continue;
    }

    const target = lineageNodes.get(supersedes);
    if (!target) {
      throw new Error(
        `Memory lineage reference "${supersedes}" from "${pathKey}" does not exist. Run "brain list" to inspect available memories.`,
      );
    }

    const incoming = supersededByNode.get(supersedes);
    if (incoming) {
      incoming.push(pathKey);
    }
  }

  detectLineageCycles(lineageNodes, supersedesByNode);

  const roots = Array.from(lineageNodes.keys())
    .filter((pathKey) => (supersededByNode.get(pathKey) ?? []).length === 0)
    .sort((left, right) => compareLineageRecords(lineageNodes.get(left), lineageNodes.get(right)));

  const selectedRoots = matchedRecord
    ? filterLineageRootsByQuery(roots, lineageNodes, toBrainRelativePath(matchedRecord.relativePath))
    : roots;

  if (selectedRoots.length === 0) {
    if (matchedRecord) {
      const matchedPath = toBrainRelativePath(matchedRecord.relativePath);
      if (!lineageNodes.has(matchedPath)) {
        return `Memory "${matchedPath}" has no lineage relationships.`;
      }
    }

    return "No memory lineage found.";
  }

  return selectedRoots
    .map((rootPath) => renderLineageNode(rootPath, lineageNodes, supersedesByNode, "", true))
    .join("\n\n");
}

function filterLineageRootsByQuery(
  roots: string[],
  lineageNodes: Map<string, StoredMemoryRecord>,
  matchedPath: string,
): string[] {
  return roots.filter((rootPath) => lineageContains(rootPath, matchedPath, supersedesByNodeFromRecords(lineageNodes)));
}

function supersedesByNodeFromRecords(
  lineageNodes: Map<string, StoredMemoryRecord>,
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const [pathKey, record] of lineageNodes.entries()) {
    result.set(pathKey, record.memory.supersedes ?? null);
  }
  return result;
}

function lineageContains(
  currentPath: string,
  targetPath: string,
  supersedesByNode: Map<string, string | null>,
): boolean {
  let cursor: string | null = currentPath;

  while (cursor) {
    if (cursor === targetPath) {
      return true;
    }

    cursor = supersedesByNode.get(cursor) ?? null;
  }

  return false;
}

function detectLineageCycles(
  lineageNodes: Map<string, StoredMemoryRecord>,
  supersedesByNode: Map<string, string | null>,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (pathKey: string): void => {
    if (visited.has(pathKey)) {
      return;
    }

    if (visiting.has(pathKey)) {
      throw new Error(`Memory lineage contains a cycle involving "${pathKey}".`);
    }

    visiting.add(pathKey);
    const next = supersedesByNode.get(pathKey) ?? null;
    if (next && lineageNodes.has(next)) {
      visit(next);
    }
    visiting.delete(pathKey);
    visited.add(pathKey);
  };

  for (const pathKey of lineageNodes.keys()) {
    visit(pathKey);
  }
}

function renderLineageNode(
  pathKey: string,
  lineageNodes: Map<string, StoredMemoryRecord>,
  supersedesByNode: Map<string, string | null>,
  prefix: string,
  isRoot: boolean,
): string {
  const record = lineageNodes.get(pathKey);
  if (!record) {
    throw new Error(`Missing lineage node "${pathKey}".`);
  }

  const currentLine = `${prefix}${isRoot ? "" : "└── supersedes: "}${formatLineageRecord(record)}`;
  const parentPath = supersedesByNode.get(pathKey) ?? null;

  if (!parentPath) {
    return currentLine;
  }

  return `${currentLine}\n${renderLineageNode(parentPath, lineageNodes, supersedesByNode, `${prefix}${isRoot ? "" : "    "}`, false)}`;
}

function formatLineageRecord(record: StoredMemoryRecord): string {
  const version = record.memory.version ?? 1;
  const status = record.memory.stale || record.memory.superseded_by ? "✗ 已过期" : "✓ 有效";
  return `[${record.memory.type}] ${toUndatedBrainRelativePath(record.relativePath)}  v${version} · score:${record.memory.score} · ${status}`;
}

function compareLineageRecords(
  left: StoredMemoryRecord | undefined,
  right: StoredMemoryRecord | undefined,
): number {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return right.memory.date.localeCompare(left.memory.date);
}

function getCandidateRecords(records: StoredMemoryRecord[]): StoredMemoryRecord[] {
  return records.filter((entry) => getMemoryStatus(entry.memory) === "candidate");
}

interface SafeCandidateRecord {
  record: StoredMemoryRecord;
  review: CandidateMemoryReviewResult;
}

function resolveCandidateRecords(
  records: StoredMemoryRecord[],
  rawQuery: string | undefined,
  all: boolean | undefined,
): StoredMemoryRecord[] {
  const candidates = getCandidateRecords(records);
  if (candidates.length === 0) {
    throw new Error("No candidate memories found.");
  }

  if (all) {
    return candidates;
  }

  const query = rawQuery?.trim();
  if (!query) {
    throw new Error('Provide a candidate id or use "--all".');
  }

  const matches = candidates.filter((entry) => matchesStoredMemory(entry, query));
  if (matches.length === 0) {
    throw new Error(`No candidate memory matched "${query}".`);
  }

  if (matches.length > 1) {
    const suggestions = matches.map((entry) => `- ${getStoredMemoryId(entry)} (${entry.memory.title})`);
    throw new Error(
      [`Multiple candidate memories matched "${query}". Use a more specific id:`, ...suggestions].join("\n"),
    );
  }

  return matches;
}

function resolveSafeCandidateRecords(
  records: StoredMemoryRecord[],
  rawQuery: string | undefined,
  all: boolean | undefined,
): {
  matches: StoredMemoryRecord[];
  skipped: SafeCandidateRecord[];
} {
  const candidates = getCandidateRecords(records);
  if (candidates.length === 0) {
    throw new Error("No candidate memories found.");
  }

  const evaluations = candidates.map((record) => ({
    record,
    review: reviewCandidateMemory(
      record.memory,
      records.filter((entry) => entry.filePath !== record.filePath),
    ),
  }));
  const safeMatches = evaluations.filter((entry) => isSafeCandidateReview(entry.review));
  const skipped = evaluations.filter((entry) => !isSafeCandidateReview(entry.review));

  if (all || !rawQuery?.trim()) {
    return {
      matches: safeMatches.map((entry) => entry.record),
      skipped,
    };
  }

  const query = rawQuery.trim();
  const target = evaluations.filter(({ record }) => matchesStoredMemory(record, query));
  if (target.length === 0) {
    throw new Error(`No candidate memory matched "${query}".`);
  }

  if (target.length > 1) {
    const suggestions = target.map(({ record }) => `- ${getStoredMemoryId(record)} (${record.memory.title})`);
    throw new Error(
      [`Multiple candidate memories matched "${query}". Use a more specific id:`, ...suggestions].join("\n"),
    );
  }

  const [selected] = target;
  if (!selected) {
    throw new Error(`No candidate memory matched "${query}".`);
  }

  if (!isSafeCandidateReview(selected.review)) {
    throw new Error(
      `Candidate "${getStoredMemoryId(selected.record)}" still requires manual review (${selected.review.decision}: ${selected.review.reason}).`,
    );
  }

  return {
    matches: [selected.record],
    skipped: evaluations
      .filter((entry) => entry.record.filePath !== selected.record.filePath && !isSafeCandidateReview(entry.review)),
  };
}

function isSafeCandidateReview(review: CandidateMemoryReviewResult): boolean {
  return review.decision === "accept" && review.reason === "novel_memory";
}

function matchesStoredMemory(entry: StoredMemoryRecord, rawQuery: string): boolean {
  const query = normalizeIdentifier(rawQuery);
  const relativePath = normalizeIdentifier(entry.relativePath);
  const fileName = normalizeIdentifier(path.basename(entry.filePath, path.extname(entry.filePath)));
  const candidateId = normalizeIdentifier(getStoredMemoryId(entry));
  const title = normalizeIdentifier(entry.memory.title);

  return (
    relativePath.includes(query) ||
    fileName === query ||
    candidateId === query ||
    title.includes(query)
  );
}

function getStoredMemoryId(entry: StoredMemoryRecord): string {
  return path.basename(entry.filePath, path.extname(entry.filePath));
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-");
}

type ScoreAction = "s" | "d" | "k" | "q";

interface ScoreCandidate {
  record: StoredMemoryRecord;
  triggers: string[];
}

interface ScoreCandidateJson {
  file: string;
  type: Memory["type"];
  score: number;
  hit_count: number;
  last_used: string | null;
  triggers: string[];
}

function renderFailureEventLine(index: number, event: FailureEvent): string {
  const details = [
    `${index}. [${event.kind}] ${event.description}`,
    `action=${event.suggestedAction}`,
  ];

  if (event.relatedMemoryFile) {
    details.push(`file=${event.relatedMemoryFile}`);
  }

  return `- ${details.join(" | ")}`;
}

function buildScoreCandidates(
  records: StoredMemoryRecord[],
  now: Date = new Date(),
): ScoreCandidate[] {
  return records
    .map((record) => ({
      record,
      triggers: getScoreTriggers(record.memory, now),
    }))
    .filter((entry) => entry.triggers.length > 0)
    .sort(compareScoreCandidates);
}

function getScoreTriggers(memory: Memory, now: Date): string[] {
  const triggers: string[] = [];
  const nowTime = now.getTime();

  if (memory.last_used) {
    const lastUsedTime = Date.parse(memory.last_used);
    if (!Number.isNaN(lastUsedTime)) {
      const ageInDays = (nowTime - lastUsedTime) / (1000 * 60 * 60 * 24);
      if (ageInDays > 180) {
        triggers.push("A:last_used>180d");
      }
    }
  }

  if (memory.score < 30) {
    triggers.push("B:score<30");
  }

  if (memory.hit_count > 5 && memory.score < 50) {
    triggers.push("C:high-hit-low-score");
  }

  return triggers;
}

function renderScoreTable(candidates: ScoreCandidate[]): string {
  const headers = ["File", "Type", "Score", "Hit Count", "Last Used", "Trigger"];
  const rows = candidates.map((candidate) => [
    path.basename(candidate.record.filePath),
    candidate.record.memory.type,
    String(candidate.record.memory.score),
    String(candidate.record.memory.hit_count),
    candidate.record.memory.last_used ?? "-",
    candidate.triggers.join(", "),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => truncateTableValue(row[index] ?? "").length),
    ),
  );

  return [
    formatTableRow(headers, widths),
    formatTableRow(widths.map((width) => "-".repeat(width)), widths),
    ...rows.map((row) => formatTableRow(row, widths)),
  ].join("\n");
}

function compareScoreCandidates(left: ScoreCandidate, right: ScoreCandidate): number {
  const severityDiff = getScoreSeverity(right) - getScoreSeverity(left);
  if (severityDiff !== 0) {
    return severityDiff;
  }

  const scoreDiff = left.record.memory.score - right.record.memory.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const leftLastUsed = Date.parse(left.record.memory.last_used ?? "");
  const rightLastUsed = Date.parse(right.record.memory.last_used ?? "");
  const leftHasLastUsed = !Number.isNaN(leftLastUsed);
  const rightHasLastUsed = !Number.isNaN(rightLastUsed);

  if (leftHasLastUsed && rightHasLastUsed && leftLastUsed !== rightLastUsed) {
    return leftLastUsed - rightLastUsed;
  }

  if (leftHasLastUsed !== rightHasLastUsed) {
    return leftHasLastUsed ? -1 : 1;
  }

  return left.record.relativePath.localeCompare(right.record.relativePath);
}

function getScoreSeverity(candidate: ScoreCandidate): number {
  const weights = candidate.triggers.map((trigger) => {
    if (trigger.startsWith("C:")) {
      return 3;
    }

    if (trigger.startsWith("B:")) {
      return 2;
    }

    if (trigger.startsWith("A:")) {
      return 1;
    }

    return 0;
  });

  return weights.length > 0 ? Math.max(...weights) : 0;
}

function formatTableRow(values: string[], widths: number[]): string {
  return values
    .map((value, index) => truncateTableValue(value).padEnd(widths[index] ?? value.length))
    .join(" | ");
}

function truncateTableValue(value: string, maxLength: number = 40): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function toScoreCandidateJson(candidate: ScoreCandidate): ScoreCandidateJson {
  return {
    file: path.basename(candidate.record.filePath),
    type: candidate.record.memory.type,
    score: candidate.record.memory.score,
    hit_count: candidate.record.memory.hit_count,
    last_used: candidate.record.memory.last_used,
    triggers: candidate.triggers,
  };
}

async function promptScoreAction(
  rl: ReturnType<typeof createInterface>,
  fileName: string,
): Promise<ScoreAction> {
  while (true) {
    const answer = (await rl.question(`Action for ${fileName} [s/d/k/q]: `)).trim().toLowerCase();
    if (answer === "s" || answer === "d" || answer === "k" || answer === "q") {
      return answer;
    }

    output.write('Choose one of "s", "d", "k", or "q".\n');
  }
}

async function createScoreActionPrompter(): Promise<{
  (fileName: string): Promise<ScoreAction>;
  close(): Promise<void>;
}> {
  if (!input.isTTY) {
    const queuedAnswers = (await readStdin())
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    let index = 0;

    const prompter = async (_fileName: string): Promise<ScoreAction> => {
      while (index < queuedAnswers.length) {
        const answer = queuedAnswers[index];
        index += 1;
        if (answer === "s" || answer === "d" || answer === "k" || answer === "q") {
          return answer;
        }
      }

      return "q";
    };

    prompter.close = async () => undefined;
    return prompter;
  }

  const rl = createInterface({
    input,
    output,
  });
  const prompter = (fileName: string) => promptScoreAction(rl, fileName);
  prompter.close = async () => {
    rl.close();
  };
  return prompter;
}

async function confirmReinforcement(): Promise<boolean> {
  const terminal = await createPromptTerminal();
  if (!terminal) {
    throw new Error('Interactive confirmation requires a TTY. Re-run with "--yes" to skip prompts.');
  }

  const rl = createInterface({
    input: terminal.input,
    output: terminal.output,
  });

  try {
    const answer = (await rl.question("Apply these reinforcement actions? [y/N]: ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
    terminal.close();
  }
}

async function confirmSupersedeOverwrite(): Promise<boolean> {
  const terminal = await createPromptTerminal();
  if (!terminal) {
    throw new Error('Existing supersede links require confirmation. Re-run with "--yes" to overwrite without prompting.');
  }

  const rl = createInterface({
    input: terminal.input,
    output: terminal.output,
  });

  try {
    const answer = (await rl.question("Overwrite the current supersede relationship? [y/N]: ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
    terminal.close();
  }
}

async function createPromptTerminal(): Promise<{
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  close(): void;
} | null> {
  if (input.isTTY) {
    return {
      input,
      output,
      close() {
        return;
      },
    };
  }

  const inputPath = process.platform === "win32" ? "CONIN$" : "/dev/tty";
  const outputPath = process.platform === "win32" ? "CONOUT$" : "/dev/tty";

  try {
    const ttyInput = createReadStream(inputPath);
    const ttyOutput = createWriteStream(outputPath);
    return {
      input: ttyInput,
      output: ttyOutput,
      close() {
        ttyInput.destroy();
        ttyOutput.end();
      },
    };
  } catch {
    return null;
  }
}

function resolveChangedFiles(projectRoot: string, explicitPaths: string[]): string[] {
  const normalizedExplicit = explicitPaths
    .flatMap((p) => p.split(",").map((s) => s.trim()).filter(Boolean))
    .map((p) => p.replace(/\\/g, "/"));

  if (normalizedExplicit.length > 0) {
    return normalizedExplicit;
  }

  return collectGitDiffPaths(projectRoot);
}

async function safeLoadCommitContext(
  projectRoot: string,
  revision: string,
): Promise<{ commitMessage?: string; diffStat?: string }> {
  try {
    const raw = await buildCommitExtractionInput(projectRoot, revision);
    const commitMessageMatch = raw.match(/Subject:\s*(.+)/);
    const bodyMatch = raw.match(/Body:\n([\s\S]*?)(?=\n## |$)/);
    const commitMessage = [
      commitMessageMatch?.[1]?.trim() ?? "",
      bodyMatch?.[1]?.trim() ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    const diffStatMatch = raw.match(/## Diff stat\n([\s\S]*?)$/);
    const diffStat = diffStatMatch?.[1]?.trim() ?? undefined;
    return {
      ...(commitMessage ? { commitMessage } : {}),
      ...(diffStat ? { diffStat } : {}),
    };
  } catch {
    return {};
  }
}

interface CaptureResult {
  action: "skipped" | "saved_as_candidate" | "extraction_empty";
  reason: string;
  suggestion: ExtractSuggestionResult;
  saved_paths: string[];
}

function buildCaptureExtractionInput(
  task: string | undefined,
  sessionSummary: string | undefined,
  commitContext: { commitMessage?: string; diffStat?: string },
  changedFiles: string[],
  testSummary: string | undefined,
): string {
  const sections: string[] = [];

  if (task) {
    sections.push(`Task: ${task}`);
  }

  if (sessionSummary) {
    sections.push(`Session summary:\n${sessionSummary}`);
  }

  if (commitContext.commitMessage) {
    sections.push(`Commit message:\n${commitContext.commitMessage}`);
  }

  if (changedFiles.length > 0) {
    sections.push(`Changed files:\n${changedFiles.join("\n")}`);
  }

  if (commitContext.diffStat) {
    sections.push(`Diff stat:\n${commitContext.diffStat}`);
  }

  if (testSummary) {
    sections.push(`Test results:\n${testSummary}`);
  }

  return sections.join("\n\n");
}
