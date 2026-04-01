#!/usr/bin/env node

import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";

import { loadConfig } from "./config.js";
import { extractMemories } from "./extract.js";
import { buildInjection } from "./inject.js";
import { runMcpServer } from "./mcp/server.js";
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
  updateIndex,
  updateStoredMemoryStatus,
} from "./store.js";
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
    const stdinText = await readStdin();
    const memories = await extractMemories(stdinText, config, projectRoot);
    const savedPaths: string[] = [];

    for (const memory of memories) {
      const toSave: Memory = {
        ...memory,
        ...(options.source ? { source: options.source } : {}),
        ...(options.candidate ? { status: "candidate" as const } : {}),
      };

      const savedPath = await saveMemory(toSave, projectRoot);
      savedPaths.push(savedPath);
    }

    await updateIndex(projectRoot);
    output.write(
      `${options.candidate ? "Saved" : "Extracted"} ${memories.length} ${options.candidate ? "candidate " : ""}memories.\n`,
    );
    for (const savedPath of savedPaths) {
      output.write(`- ${savedPath}\n`);
    }
  });

program
  .command("inject")
  .description("Build session-start injection text from current .brain memories.")
  .action(async () => {
    const projectRoot = process.cwd();
    const config = await loadConfig(projectRoot);
    const injection = await buildInjection(projectRoot, config);
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
