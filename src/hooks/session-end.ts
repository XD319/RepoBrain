#!/usr/bin/env node

import { stdin as input, stderr } from "node:process";

import { findProjectRoot, loadConfig, renderConfigWarnings } from "../config.js";
import { extractMemories } from "../extract.js";
import { reviewCandidateMemories } from "../reviewer.js";
import { appendErrorLog, initBrain, loadStoredMemoryRecords, saveMemory, updateIndex } from "../store.js";
import type { Memory } from "../types.js";

async function main(): Promise<void> {
  const projectRoot = (await findProjectRoot(process.cwd())) ?? process.cwd();

  try {
    await initBrain(projectRoot);
    const config = await loadConfig(projectRoot);
    renderConfigWarnings(config).forEach((warning) => debugLog(warning));
    const summary = await readStdin();

    if (!summary.trim()) {
      return;
    }

    if (config.extractMode === "manual") {
      return;
    }

    const memories = await extractMemories(summary, config, projectRoot);
    const existingRecords = await loadStoredMemoryRecords(projectRoot);
    const reviewedCandidates = reviewCandidateMemories(memories, existingRecords);

    for (const entry of reviewedCandidates) {
      const { memory, review } = entry;
      if (review.decision === "reject") {
        debugLog(
          `Rejected extracted memory "${memory.title}" (${review.reason})`,
        );
        continue;
      }

      const toSave: Memory = {
        ...memory,
        ...(memory.source ? {} : { source: "session" }),
        ...(
          config.extractMode === "suggest" || review.decision !== "accept"
            ? { status: "candidate" as const }
            : { status: "active" as const }
        ),
      };
      await saveMemory(toSave, projectRoot);

      if (review.decision !== "accept") {
        debugLog(
          `Deferred extracted memory "${memory.title}" as candidate (${review.decision}: ${review.reason}; targets=${review.target_memory_ids.join(", ") || "-"})`,
        );
      }
    }

    await updateIndex(projectRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendErrorLog(projectRoot, `session-end hook failed: ${message}`);
    debugLog(message);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function debugLog(message: string): void {
  if (process.env.PROJECT_BRAIN_VERBOSE === "1") {
    stderr.write(`[repobrain] ${message}\n`);
  }
}

main().catch(async (error: unknown) => {
  const projectRoot = (await findProjectRoot(process.cwd())) ?? process.cwd();
  const message = error instanceof Error ? error.message : String(error);
  await appendErrorLog(projectRoot, `session-end hook crashed: ${message}`);
  debugLog(message);
  process.exitCode = 0;
});
