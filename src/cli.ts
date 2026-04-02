#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";

import { getBrainDir, loadConfig, renderConfigWarnings } from "./config.js";
import { buildMemoryAudit, renderMemoryAuditResult } from "./audit-memory.js";
import { extractMemories } from "./extract.js";
import { detectFailures } from "./failure-detector.js";
import { buildInjection } from "./inject.js";
import { runMcpServer } from "./mcp/server.js";
import { reinforceMemories } from "./reinforce.js";
import { reviewCandidateMemories } from "./reviewer.js";
import { buildSharePlan } from "./share.js";
import { buildSkillShortlist, renderSkillShortlist } from "./suggest-skills.js";
import {
  approveCandidateMemory,
  getMemoryStatus,
  initBrain,
  loadActivityState,
  loadAllMemories,
  loadStoredMemoryRecords,
  saveMemory,
  supersedeMemoryPair,
  updateIndex,
  updateStoredMemoryStatus,
} from "./store.js";
import type { FailureEvent } from "./failure-detector.js";
import type { Memory, MemoryActivityEntry, StoredMemoryRecord } from "./types.js";

const program = new Command();

program
  .name("brain")
  .description("Repo-native project knowledge memory for coding agents.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize the .brain workspace in the current project.")
  .action(async () => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);
    output.write(`Initialized Project Brain in ${projectRoot}\n`);
  });

program
  .command("extract")
  .description("Extract long-lived repo knowledge from stdin and save it into .brain.")
  .option("--source <source>", "Memory source label", "session")
  .option("--candidate", "Save extracted memories as candidates for later review.")
  .action(async (options: { source: Memory["source"]; candidate?: boolean }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);

    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
    const stdinText = await readStdin();
    const memories = await extractMemories(stdinText, config, projectRoot);
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
  .action(async (options: { task?: string; path: string[]; module: string[] }) => {
    const projectRoot = process.cwd();
    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));
    const injection = await buildInjection(projectRoot, config, {
      ...(options.task?.trim() ? { task: options.task.trim() } : {}),
      paths: options.path,
      modules: options.module,
    });
    output.write(`${injection}\n`);
  });

program
  .command("list")
  .description("List all stored memories in the current project.")
  .action(async () => {
    const projectRoot = process.cwd();
    const memories = await loadAllMemories(projectRoot);

    if (memories.length === 0) {
      output.write("No memories found.\n");
      return;
    }

    for (const memory of memories) {
      const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
      const status = getMemoryStatus(memory);
      output.write(
        `${memory.date} | ${memory.type} | ${memory.importance} | ${status} | ${memory.title}${tags}\n`,
      );
    }
  });

program
  .command("stats")
  .description("Show high-level memory counts for the current project.")
  .action(async () => {
    const projectRoot = process.cwd();
    const memories = await loadAllMemories(projectRoot);
    const byType = new Map<string, number>();
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
  });

program
  .command("status")
  .description("Show recent Project Brain activity for the current project.")
  .action(async () => {
    const projectRoot = process.cwd();
    const memories = await loadAllMemories(projectRoot);
    const activity = await loadActivityState(projectRoot);
    const recentCapturedMemories = memories.slice(0, 5);
    const candidateCount = memories.filter((memory) => getMemoryStatus(memory) === "candidate").length;

    output.write(`Project root: ${projectRoot}\n`);
    output.write(`Total memories: ${memories.length}\n`);
    output.write(`Pending review: ${candidateCount}\n`);
    output.write(`Last updated: ${memories[0]?.date ?? "N/A"}\n`);
    output.write(`Last injected: ${activity.lastInjectedAt ?? "N/A"}\n`);
    output.write("Recent loaded memories:\n");
    output.write(`${formatMemoryList(activity.recentLoadedMemories)}\n`);
    output.write("Recent captured memories:\n");
    output.write(`${formatMemoryList(recentCapturedMemories)}\n`);
  });

program
  .command("review")
  .description("List candidate memories waiting for approval.")
  .action(async () => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const candidates = getCandidateRecords(records);

    if (candidates.length === 0) {
      output.write("No candidate memories waiting for review.\n");
      return;
    }

    output.write(`Candidate memories: ${candidates.length}\n`);
    for (const entry of candidates) {
      output.write(
        `- ${getStoredMemoryId(entry)} | ${entry.memory.type} | ${entry.memory.importance} | ${entry.memory.title}\n`,
      );
    }
  });

program
  .command("approve [memoryId]")
  .description("Approve one candidate memory, or all candidates with --all.")
  .option("--all", "Approve all candidate memories.")
  .action(async (memoryId: string | undefined, options: { all?: boolean }) => {
    const projectRoot = process.cwd();
    const records = await loadStoredMemoryRecords(projectRoot);
    const matches = resolveCandidateRecords(records, memoryId, options.all);

    for (const entry of matches) {
      await approveCandidateMemory(entry, projectRoot);
    }

    await updateIndex(projectRoot);
    output.write(`Approved ${matches.length} candidate memor${matches.length === 1 ? "y" : "ies"}.\n`);
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
  .command("suggest-skills")
  .description("Suggest a skill shortlist from the current task, changed paths, and matched memories.")
  .option("--task <task>", "Task description to match against skill_trigger_tasks.")
  .option(
    "--path <path>",
    "Changed path to match against skill_trigger_paths. Repeat or pass a comma-separated list.",
    collectValues,
    [] as string[],
  )
  .action(async (options: { task?: string; path: string[] }) => {
    const projectRoot = process.cwd();
    const task = options.task?.trim() || (await readOptionalStdin());
    const result = await buildSkillShortlist(projectRoot, {
      ...(task ? { task } : {}),
      paths: options.path,
    });

    output.write(`${renderSkillShortlist(result)}\n`);
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
  .description("Analyze stdin for repeated failures, then reinforce affected memories.")
  .option("--source <source>", "Input source label for analysis context", "session")
  .option("--yes", "Skip confirmation and apply reinforcement immediately.")
  .action(async (options: { source: "session" | "git-commit"; yes?: boolean }) => {
    const projectRoot = process.cwd();
    await initBrain(projectRoot);

    const stdinText = await readStdin();
    if (!stdinText.trim()) {
      throw new Error("Provide a session summary or commit message over stdin.");
    }

    const records = await loadStoredMemoryRecords(projectRoot);
    const analysisText =
      options.source === "git-commit" ? `Source: git-commit\n\n${stdinText}` : stdinText;
    const events = detectFailures(
      analysisText,
      records.map((entry) => ({
        ...entry.memory,
        filePath: entry.filePath,
        relativePath: entry.relativePath,
      })),
    );

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
    await updateIndex(projectRoot);
    output.write(
      `[brain] reinforcement complete: boosted=${result.boosted.length}, rewritten=${result.rewritten.length}, extracted=${result.extracted.length}\n`,
    );
  });

program
  .command("score")
  .description("Review low-quality or outdated memories and optionally mark them stale or delete them.")
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
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

function formatCountMap(map: Map<string, number>): string {
  return Array.from(map.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
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

function getCandidateRecords(records: StoredMemoryRecord[]): StoredMemoryRecord[] {
  return records.filter((entry) => getMemoryStatus(entry.memory) === "candidate");
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
