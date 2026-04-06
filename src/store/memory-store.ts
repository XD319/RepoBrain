import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBrainDir } from "../config.js";
import { buildMemoryIdentity as buildScopedMemoryIdentity, slugifyMemoryTitle } from "../memory-identity.js";
import type { Memory, MemoryStatus, MemoryType, StoredMemoryRecord } from "../types.js";
import { MEMORY_TYPES } from "../types.js";
import { initBrain } from "./core.js";
import { parseMemory, serializeMemory } from "./serialize.js";
import {
  DEFAULT_MEMORY_VERSION,
  getMemoryStatus,
  normalizeMemory,
  validateMemory,
} from "./validate.js";
import { commitAtomicWriteOperations, createAtomicWriteOperation } from "./atomic-write.js";

const DIRECTORY_BY_TYPE: Record<MemoryType, string> = {
  decision: "decisions",
  gotcha: "gotchas",
  convention: "conventions",
  pattern: "patterns",
  working: "working",
  goal: "goals",
};

export async function saveMemory(memory: Memory, projectRoot: string): Promise<string> {
  const normalizedMemory = normalizeMemory(memory);
  validateMemory(normalizedMemory);
  await initBrain(projectRoot);
  if (getMemoryStatus(normalizedMemory) === "active") {
    await supersedeMatchingActiveMemories(normalizedMemory, projectRoot);
  }
  const directory = DIRECTORY_BY_TYPE[normalizedMemory.type];
  const fileName = `${normalizedMemory.date.slice(0, 10)}-${slugifyMemoryTitle(normalizedMemory.title)}.md`;
  const brainDir = getBrainDir(projectRoot);
  const content = serializeMemory(normalizedMemory);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const relativePath = path.join(directory, ensureUniqueFileNameSuffix(normalizedMemory, fileName, attempt));
    const filePath = path.join(brainDir, relativePath);
    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileAlreadyExistsError(error)) continue;
      throw error;
    }
  }
  throw new Error(`Failed to allocate a unique memory file name for "${normalizedMemory.title}".`);
}

export async function loadAllMemories(projectRoot: string): Promise<Memory[]> {
  const storedMemories = await loadStoredMemories(projectRoot);
  return storedMemories.map((entry) => entry.memory).sort((left, right) => right.date.localeCompare(left.date));
}

export async function loadStoredMemoryRecords(projectRoot: string): Promise<StoredMemoryRecord[]> {
  return loadStoredMemories(projectRoot);
}

export async function updateIndex(projectRoot: string): Promise<void> {
  const memories = await loadAllMemories(projectRoot);
  const brainDir = getBrainDir(projectRoot);
  const indexPath = path.join(brainDir, "index.md");
  const byType = new Map<MemoryType, Memory[]>(
    MEMORY_TYPES.map((type) => [type, memories.filter((memory) => memory.type === type)]),
  );
  const total = memories.length;
  const lastUpdated = memories[0]?.date ?? "N/A";
  const sections = MEMORY_TYPES.map((type) => {
    const title = titleForType(type);
    const items = byType.get(type) ?? [];
    if (items.length === 0) {
      return [`## ${title}`, "", "_No memories yet._", ""].join("\n");
    }
    const lines = items.map((memory) => {
      const tags = memory.tags.length > 0 ? ` | tags: ${memory.tags.join(", ")}` : "";
      const status = memory.status ? ` | status: ${memory.status}` : "";
      return `- [${memory.importance}] ${memory.title} (${memory.date}) - ${memory.summary}${tags}${status}`;
    });
    return [`## ${title}`, "", ...lines, ""].join("\n");
  });
  const content = [
    "# Project Brain Index",
    "",
    `Updated: ${new Date().toISOString()}`,
    `Total memories: ${total}`,
    `Last memory date: ${lastUpdated}`,
    "",
    ...sections,
  ].join("\n");
  await writeFile(indexPath, content, "utf8");
}

export async function overwriteStoredMemory(record: StoredMemoryRecord): Promise<void> {
  const normalizedMemory = normalizeMemory(record.memory);
  validateMemory(normalizedMemory);
  await writeFile(record.filePath, serializeMemory(normalizedMemory), "utf8");
}

export async function supersedeMemoryPair(
  newRecord: StoredMemoryRecord,
  oldRecord: StoredMemoryRecord,
): Promise<{ newVersion: number }> {
  const newRelativePath = toBrainRelativePath(newRecord.relativePath);
  const oldRelativePath = toBrainRelativePath(oldRecord.relativePath);
  const nextVersion = (oldRecord.memory.version ?? DEFAULT_MEMORY_VERSION) + 1;
  const nowIso = new Date().toISOString();
  const updatedNewMemory = normalizeMemory({
    ...newRecord.memory,
    supersedes: oldRelativePath,
    version: nextVersion,
    observed_at: newRecord.memory.observed_at ?? nowIso,
  });
  const updatedOldMemory = normalizeMemory({
    ...oldRecord.memory,
    superseded_by: newRelativePath,
    stale: true,
    valid_until: oldRecord.memory.valid_until ?? nowIso,
    supersession_reason: oldRecord.memory.supersession_reason ?? "Superseded by linked newer memory",
  });
  validateMemory(updatedNewMemory, `Memory file "${newRecord.filePath}"`);
  validateMemory(updatedOldMemory, `Memory file "${oldRecord.filePath}"`);
  await commitAtomicWriteOperations([
    createAtomicWriteOperation(newRecord.filePath, serializeMemory(updatedNewMemory)),
    createAtomicWriteOperation(oldRecord.filePath, serializeMemory(updatedOldMemory)),
  ]);
  return { newVersion: nextVersion };
}

export async function approveCandidateMemory(record: StoredMemoryRecord, projectRoot: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const promotedMemory: Memory = normalizeMemory({
    ...record.memory,
    status: "active",
    stale: false,
    observed_at: record.memory.observed_at ?? nowIso,
    review_state: "cleared",
    valid_from: record.memory.valid_from ?? nowIso.slice(0, 10),
  });
  await supersedeMatchingActiveMemories(promotedMemory, projectRoot, record.filePath);
  await overwriteStoredMemory({ ...record, memory: promotedMemory });
}

export async function updateStoredMemoryStatus(record: StoredMemoryRecord, status: MemoryStatus): Promise<void> {
  const nowIso = new Date().toISOString();
  const nextMemory: Memory = {
    ...record.memory,
    status,
    stale: status === "stale" ? true : record.memory.stale,
  };
  if (status === "stale") {
    nextMemory.valid_until = record.memory.valid_until ?? nowIso;
    nextMemory.supersession_reason = record.memory.supersession_reason ?? "Marked stale via brain dismiss or score workflow";
  }
  if (status === "superseded") {
    nextMemory.valid_until = record.memory.valid_until ?? nowIso;
    nextMemory.supersession_reason = record.memory.supersession_reason ?? "Marked superseded via brain status update";
  }
  await overwriteStoredMemory({ ...record, memory: normalizeMemory(nextMemory) });
}

export function buildMemoryIdentity(memory: Memory): string {
  return buildScopedMemoryIdentity(memory);
}

async function loadStoredMemories(projectRoot: string): Promise<StoredMemoryRecord[]> {
  const brainDir = getBrainDir(projectRoot);
  const memoriesByType = await Promise.all(
    MEMORY_TYPES.map(async (type) => {
      const directory = path.join(brainDir, DIRECTORY_BY_TYPE[type]);
      try {
        const files = await readdir(directory, { withFileTypes: true });
        const markdownFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
        const loaded = await Promise.all(
          markdownFiles.map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const content = await readFile(filePath, "utf8");
            const memory = parseMemory(content, filePath);
            return { filePath, relativePath: path.relative(projectRoot, filePath), memory };
          }),
        );
        return loaded;
      } catch (error) {
        if (isMissingDirectoryError(error)) return [];
        throw error;
      }
    }),
  );
  return memoriesByType.flat().sort((left, right) => right.memory.date.localeCompare(left.memory.date));
}

async function supersedeMatchingActiveMemories(
  memory: Memory,
  projectRoot: string,
  ignoredFilePath: string | null = null,
): Promise<void> {
  const existingMemories = await loadStoredMemories(projectRoot);
  const nextIdentity = buildScopedMemoryIdentity(memory);
  await Promise.all(
    existingMemories.map(async (entry) => {
      if (ignoredFilePath && entry.filePath === ignoredFilePath) return;
      if (getMemoryStatus(entry.memory) !== "active") return;
      if (buildScopedMemoryIdentity(entry.memory) !== nextIdentity) return;
      const nowIso = new Date().toISOString();
      const updatedMemory = normalizeMemory({
        ...entry.memory,
        status: "superseded",
        stale: true,
        valid_until: entry.memory.valid_until ?? nowIso,
        supersession_reason: entry.memory.supersession_reason ?? "Superseded by newer active memory with the same identity",
      });
      await writeFile(entry.filePath, serializeMemory(updatedMemory), "utf8");
    }),
  );
}

function toBrainRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.brain\//, "");
}

function ensureUniqueFileNameSuffix(memory: Memory, fileName: string, attempt = 0): string {
  const stamp = memory.date.replace(/[^\d]/g, "").slice(8, 17);
  const extension = path.extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const parts = [baseName];
  if (stamp) parts.push(stamp);
  if (attempt > 0) parts.push(String(attempt + 1));
  return `${parts.join("-")}${extension}`;
}

function titleForType(type: MemoryType): string {
  switch (type) {
    case "decision":
      return "Decisions";
    case "gotcha":
      return "Gotchas";
    case "convention":
      return "Conventions";
    case "pattern":
      return "Patterns";
    case "working":
      return "Working";
    case "goal":
      return "Goals";
  }
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "EEXIST";
}

function isMissingDirectoryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "ENOENT";
}
