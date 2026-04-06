import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getBrainDir } from "../config.js";
import type { BrainActivityState, Memory, MemoryActivityEntry, MemoryType } from "../types.js";
import { IMPORTANCE_LEVELS, MEMORY_TYPES } from "../types.js";
import { commitAtomicWriteOperations, createAtomicWriteOperation, type AtomicWriteOperation } from "./atomic-write.js";
import { loadStoredMemoryRecords } from "./memory-store.js";
import { serializeMemory } from "./serialize.js";
import { normalizeMemory, validateMemory } from "./validate.js";

export async function recordInjectedMemories(projectRoot: string, memories: Memory[]): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  await mkdir(brainDir, { recursive: true });
  const injectedAt = new Date().toISOString().slice(0, 10);
  const activityStatePath = getActivityStatePath(projectRoot);

  const operations: AtomicWriteOperation[] = [];
  if (memories.length > 0) {
    const touchedKeys = new Set(memories.map((memory) => getMemoryKey(memory)));
    const existingRecords = await loadStoredMemoryRecords(projectRoot);
    for (const entry of existingRecords) {
      if (!touchedKeys.has(getMemoryKey(entry.memory))) continue;
      const normalizedMemory = normalizeMemory({
        ...entry.memory,
        hit_count: entry.memory.hit_count + 1,
        last_used: injectedAt,
        stale: false,
      });
      validateMemory(normalizedMemory);
      operations.push(createAtomicWriteOperation(entry.filePath, serializeMemory(normalizedMemory)));
    }
  }

  const state: BrainActivityState = {
    lastInjectedAt: injectedAt,
    recentLoadedMemories: memories.slice(0, 5).map(toActivityEntry),
  };
  operations.push(createAtomicWriteOperation(activityStatePath, JSON.stringify(state, null, 2)));
  await commitAtomicWriteOperations(operations);
}

export async function loadActivityState(projectRoot: string): Promise<BrainActivityState> {
  try {
    const raw = await readFile(getActivityStatePath(projectRoot), "utf8");
    return parseActivityState(raw);
  } catch {
    return { recentLoadedMemories: [] };
  }
}

function getActivityStatePath(projectRoot: string): string {
  return path.join(getBrainDir(projectRoot), "activity.json");
}

function getMemoryKey(memory: Pick<Memory, "type" | "title" | "date">): string {
  return `${memory.type}|${memory.title}|${memory.date}`;
}

function toActivityEntry(memory: Memory): MemoryActivityEntry {
  return {
    type: memory.type,
    title: memory.title,
    importance: memory.importance,
    date: memory.date,
  };
}

function parseActivityState(raw: string): BrainActivityState {
  try {
    const parsed = JSON.parse(raw) as { lastInjectedAt?: unknown; recentLoadedMemories?: unknown };
    const recentLoadedMemories = Array.isArray(parsed.recentLoadedMemories)
      ? parsed.recentLoadedMemories.map((entry) => parseActivityEntry(entry)).filter((entry): entry is MemoryActivityEntry => entry !== null)
      : [];
    const lastInjectedAt = typeof parsed.lastInjectedAt === "string" && parsed.lastInjectedAt.trim() ? parsed.lastInjectedAt : null;
    return lastInjectedAt ? { lastInjectedAt, recentLoadedMemories } : { recentLoadedMemories };
  } catch {
    return { recentLoadedMemories: [] };
  }
}

function parseActivityEntry(value: unknown): MemoryActivityEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type : null;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const importance = typeof candidate.importance === "string" ? candidate.importance : null;
  const date = typeof candidate.date === "string" ? candidate.date.trim() : "";
  if (
    !type ||
    !title ||
    !importance ||
    !date ||
    !MEMORY_TYPES.includes(type as MemoryType) ||
    !IMPORTANCE_LEVELS.includes(importance as Memory["importance"])
  ) {
    return null;
  }
  return {
    type: type as MemoryType,
    title,
    importance: importance as Memory["importance"],
    date,
  };
}
