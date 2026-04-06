import path from "node:path";

import type { Memory, StoredMemoryRecord } from "./types.js";
import { getMemoryStatus, loadStoredMemoryRecords } from "./store.js";

export interface SharePlan {
  records: StoredMemoryRecord[];
  commitMessage: string;
  addCommands: string[];
}

export async function buildSharePlan(
  projectRoot: string,
  options: { allActive?: boolean; memoryId?: string },
): Promise<SharePlan> {
  const records = await loadStoredMemoryRecords(projectRoot);
  const activeRecords = records.filter((entry) => getMemoryStatus(entry.memory) === "active");

  if (options.allActive) {
    if (activeRecords.length === 0) {
      throw new Error("No active memories found.");
    }

    return createSharePlan(projectRoot, activeRecords);
  }

  const memoryId = options.memoryId?.trim();
  if (!memoryId) {
    throw new Error('Provide a memory id or use "--all-active".');
  }

  const matches = matchStoredMemories(activeRecords, memoryId);
  if (matches.length === 0) {
    throw new Error(`No active memory matched "${memoryId}".`);
  }

  if (matches.length > 1) {
    const suggestions = matches.map((entry) => `- ${getCandidateId(entry)} (${entry.memory.title})`);
    throw new Error([`Multiple memories matched "${memoryId}". Use a more specific id:`, ...suggestions].join("\n"));
  }

  return createSharePlan(projectRoot, matches);
}

function createSharePlan(projectRoot: string, records: StoredMemoryRecord[]): SharePlan {
  const sortedRecords = [...records].sort((left, right) => right.memory.date.localeCompare(left.memory.date));
  const addCommands = sortedRecords.map((entry) => `git add ${quoteForShell(entry.relativePath)}`);

  return {
    records: sortedRecords,
    addCommands,
    commitMessage: buildCommitMessage(sortedRecords),
  };
}

function matchStoredMemories(records: StoredMemoryRecord[], rawQuery: string): StoredMemoryRecord[] {
  const query = normalizeIdentifier(rawQuery);

  return records.filter((entry) => {
    const relativePath = normalizeIdentifier(entry.relativePath);
    const fileName = normalizeIdentifier(path.basename(entry.filePath, path.extname(entry.filePath)));
    const candidateId = normalizeIdentifier(getCandidateId(entry));
    const title = normalizeIdentifier(entry.memory.title);

    return relativePath.includes(query) || fileName === query || candidateId === query || title.includes(query);
  });
}

function buildCommitMessage(records: StoredMemoryRecord[]): string {
  if (records.length === 1) {
    const [entry] = records;
    if (!entry) {
      return "brain: sync active memories";
    }

    return `brain: add ${entry.memory.type} - ${toCommitSummary(entry.memory.title)}`;
  }

  const typeCounts = new Map<string, number>();
  for (const entry of records) {
    typeCounts.set(entry.memory.type, (typeCounts.get(entry.memory.type) ?? 0) + 1);
  }

  const summary = Array.from(typeCounts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`)
    .join(", ");

  return `brain: sync active memories - ${summary}`;
}

function toCommitSummary(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 72);
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-");
}

function getCandidateId(entry: StoredMemoryRecord): string {
  return path.basename(entry.filePath, path.extname(entry.filePath));
}

function quoteForShell(value: string): string {
  return JSON.stringify(value.replace(/\\/g, "/"));
}
