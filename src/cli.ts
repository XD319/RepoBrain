#!/usr/bin/env node

import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";

import { loadConfig } from "./config.js";
import { extractMemories } from "./extract.js";
import { buildInjection } from "./inject.js";
import { runMcpServer } from "./mcp/server.js";
import { buildSharePlan } from "./share.js";
import { initBrain, loadActivityState, loadAllMemories, saveMemory, updateIndex } from "./store.js";
import type { Memory, MemoryActivityEntry } from "./types.js";

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
  .action(async (options: { source: Memory["source"] }) => {
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
      };

      const savedPath = await saveMemory(toSave, projectRoot);
      savedPaths.push(savedPath);
    }

    await updateIndex(projectRoot);
    output.write(`Extracted ${memories.length} memories.\n`);
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
      output.write(
        `${memory.date} | ${memory.type} | ${memory.importance} | ${memory.title}${tags}\n`,
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

    for (const memory of memories) {
      byType.set(memory.type, (byType.get(memory.type) ?? 0) + 1);
      byImportance.set(memory.importance, (byImportance.get(memory.importance) ?? 0) + 1);
    }

    output.write(`Total memories: ${memories.length}\n`);
    output.write(`Last updated: ${memories[0]?.date ?? "N/A"}\n`);
    output.write(`By type: ${formatCountMap(byType)}\n`);
    output.write(`By importance: ${formatCountMap(byImportance)}\n`);
  });

program
  .command("status")
  .description("Show recent Project Brain activity for the current project.")
  .action(async () => {
    const projectRoot = process.cwd();
    const memories = await loadAllMemories(projectRoot);
    const activity = await loadActivityState(projectRoot);
    const recentCapturedMemories = memories.slice(0, 5);

    output.write(`Project root: ${projectRoot}\n`);
    output.write(`Total memories: ${memories.length}\n`);
    output.write(`Last updated: ${memories[0]?.date ?? "N/A"}\n`);
    output.write(`Last injected: ${activity.lastInjectedAt ?? "N/A"}\n`);
    output.write("Recent loaded memories:\n");
    output.write(`${formatMemoryList(activity.recentLoadedMemories)}\n`);
    output.write("Recent captured memories:\n");
    output.write(`${formatMemoryList(recentCapturedMemories)}\n`);
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
    .map((memory) => `- ${memory.type} | ${memory.importance} | ${memory.title} (${memory.date})`)
    .join("\n");
}
