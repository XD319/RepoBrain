#!/usr/bin/env node

import { stdin as input, stderr } from "node:process";

import { findProjectRoot, loadConfig, renderConfigWarnings } from "../config.js";
import { extractMemories } from "../extract.js";
import { detectFailures } from "../failure-detector.js";
import { savePendingReinforcementEvents } from "../reinforce-pending.js";
import { isSafeForAutoApproval, reviewCandidateMemories, reviewCandidateMemory } from "../reviewer.js";
import { appendErrorLog, approveCandidateMemory, getMemoryStatus, initBrain, loadStoredMemoryRecords, saveMemory, updateIndex } from "../store.js";
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

    if (config.triggerMode === "manual") {
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

      const useCandidate = config.captureMode === "candidate" || config.captureMode === "reviewable" || review.decision !== "accept";
      const toSave: Memory = {
        ...memory,
        ...(memory.source ? {} : { source: "session" }),
        ...(useCandidate ? { status: "candidate" as const } : { status: "active" as const }),
      };
      await saveMemory(toSave, projectRoot);

      if (review.decision !== "accept") {
        debugLog(
          `Deferred extracted memory "${memory.title}" as candidate (${review.decision}: ${review.reason}; targets=${review.target_memory_ids.join(", ") || "-"})`,
        );
      }
    }

    if (config.autoApproveSafeCandidates) {
      const postExtractRecords = await loadStoredMemoryRecords(projectRoot);
      const candidates = postExtractRecords.filter(
        (entry) => getMemoryStatus(entry.memory) === "candidate",
      );
      let autoPromoted = 0;
      for (const record of candidates) {
        const review = reviewCandidateMemory(
          record.memory,
          postExtractRecords.filter((entry) => entry.filePath !== record.filePath),
        );
        if (isSafeForAutoApproval(record.memory, review)) {
          await approveCandidateMemory(record, projectRoot);
          autoPromoted += 1;
          debugLog(`Auto-promoted safe candidate "${record.memory.title}"`);
        }
      }
      if (autoPromoted > 0) {
        debugLog(`Auto-promoted ${autoPromoted} safe candidate(s) to active.`);
      }
    }

    const latestRecords = await loadStoredMemoryRecords(projectRoot);
    const failureEvents = detectFailures(
      summary,
      latestRecords.map((entry) => ({
        ...entry.memory,
        filePath: entry.filePath,
        relativePath: entry.relativePath,
      })),
    );
    if (failureEvents.length > 0) {
      await savePendingReinforcementEvents(projectRoot, failureEvents);
      debugLog(`Queued ${failureEvents.length} reinforcement suggestion(s) for later review.`);
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
