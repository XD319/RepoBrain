import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBrainDir } from "../config.js";
import type { DerivedMemoryIndexCache, DerivedMemoryIndexEntry, Memory, StoredMemoryRecord } from "../types.js";
import { parseMemory } from "./serialize.js";

export const MEMORY_INDEX_CACHE_VERSION = 1;

export type MemoryIndexCacheStatus = "ready" | "missing" | "stale" | "corrupt" | "unsupported_version";

export interface MemoryIndexCacheLoadResult {
  status: MemoryIndexCacheStatus;
  cache: DerivedMemoryIndexCache | null;
  reason?: string;
}

export async function writeMemoryIndexCache(
  projectRoot: string,
  records: StoredMemoryRecord[],
): Promise<MemoryIndexCacheLoadResult> {
  const cache = await buildMemoryIndexCache(records);
  await writeFile(getMemoryIndexPath(projectRoot), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return {
    status: "ready",
    cache,
  };
}

export async function loadMemoryIndexCache(projectRoot: string): Promise<MemoryIndexCacheLoadResult> {
  const cachePath = getMemoryIndexPath(projectRoot);
  let raw: string;

  try {
    raw = await readFile(cachePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        status: "missing",
        cache: null,
        reason: "Derived memory index cache is missing.",
      };
    }

    return {
      status: "corrupt",
      cache: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: "corrupt",
      cache: null,
      reason: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }

  const cache = validateDerivedMemoryIndexCache(parsed);
  if (!cache) {
    return {
      status: "corrupt",
      cache: null,
      reason: "Cache schema validation failed.",
    };
  }

  if (cache.version !== MEMORY_INDEX_CACHE_VERSION) {
    return {
      status: "unsupported_version",
      cache: null,
      reason: `Cache version ${cache.version} is unsupported. Expected ${MEMORY_INDEX_CACHE_VERSION}.`,
    };
  }

  for (const entry of cache.entries) {
    const filePath = path.join(getBrainDir(projectRoot), entry.relativePath);
    try {
      const fileStat = await stat(filePath);
      if (fileStat.mtimeMs !== entry.source_mtime_ms) {
        return {
          status: "stale",
          cache: null,
          reason: `Memory "${entry.relativePath}" changed after the cache was written.`,
        };
      }
    } catch (error) {
      return {
        status: "stale",
        cache: null,
        reason: error instanceof Error ? error.message : `Memory "${entry.relativePath}" is missing.`,
      };
    }
  }

  return {
    status: "ready",
    cache,
  };
}

export async function loadStoredMemoryRecordsByBrainRelativePaths(
  projectRoot: string,
  relativePaths: string[],
): Promise<StoredMemoryRecord[]> {
  const brainDir = getBrainDir(projectRoot);
  const records = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\.brain\//, "");
      const filePath = path.join(brainDir, normalizedRelativePath);
      const content = await readFile(filePath, "utf8");
      return {
        filePath,
        relativePath: path.relative(projectRoot, filePath),
        memory: parseMemory(content, filePath),
      };
    }),
  );

  return records;
}

function getMemoryIndexPath(projectRoot: string): string {
  return path.join(getBrainDir(projectRoot), "memory-index.json");
}

async function buildMemoryIndexCache(records: StoredMemoryRecord[]): Promise<DerivedMemoryIndexCache> {
  const entries = await Promise.all(records.map((record) => buildDerivedMemoryIndexEntry(record)));
  return {
    version: MEMORY_INDEX_CACHE_VERSION,
    generated_at: new Date().toISOString(),
    entry_count: entries.length,
    entries: entries.sort((left, right) => right.date.localeCompare(left.date)),
  };
}

async function buildDerivedMemoryIndexEntry(record: StoredMemoryRecord): Promise<DerivedMemoryIndexEntry> {
  const fileStat = await stat(record.filePath);
  const relativePath = toBrainRelativePath(record.relativePath);
  const memory = record.memory;

  return {
    id: memoryFileStem(relativePath),
    relativePath,
    title: memory.title,
    summary: memory.summary,
    tags: memory.tags,
    risk_level: memory.risk_level ?? "low",
    path_scope: memory.path_scope ?? [],
    files: memory.files ?? [],
    token_size: approximateMemoryTokens(memory),
    updated_at: memory.updated ?? memory.created ?? memory.date.slice(0, 10),
    date: memory.date,
    type: memory.type,
    status: memory.status ?? "active",
    stale: memory.stale,
    review_state: memory.review_state ?? "unset",
    superseded_by: memory.superseded_by ?? null,
    valid_from: memory.valid_from ?? null,
    valid_until: memory.valid_until ?? null,
    expires: memory.expires ?? null,
    source_mtime_ms: fileStat.mtimeMs,
  };
}

function approximateMemoryTokens(memory: Memory): number {
  const text = [memory.title, memory.summary, memory.tags.join(" "), memory.path_scope?.join(" ") ?? ""].join(" ");
  let asciiChars = 0;
  let nonAsciiTokens = 0;

  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiTokens += 1;
    }
  }

  return Math.ceil(asciiChars / 4) + nonAsciiTokens;
}

function validateDerivedMemoryIndexCache(value: unknown): DerivedMemoryIndexCache | null {
  if (!isRecord(value)) {
    return null;
  }

  const version = value.version;
  const generated_at = value.generated_at;
  const entry_count = value.entry_count;
  const entries = value.entries;

  if (
    typeof version !== "number" ||
    typeof generated_at !== "string" ||
    typeof entry_count !== "number" ||
    !Array.isArray(entries)
  ) {
    return null;
  }

  const validatedEntries: DerivedMemoryIndexEntry[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) {
      return null;
    }

    if (
      typeof entry.id !== "string" ||
      typeof entry.relativePath !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.summary !== "string" ||
      !Array.isArray(entry.tags) ||
      typeof entry.risk_level !== "string" ||
      !Array.isArray(entry.path_scope) ||
      !Array.isArray(entry.files) ||
      typeof entry.token_size !== "number" ||
      typeof entry.updated_at !== "string" ||
      typeof entry.date !== "string" ||
      typeof entry.type !== "string" ||
      typeof entry.status !== "string" ||
      typeof entry.stale !== "boolean" ||
      typeof entry.review_state !== "string" ||
      !isNullableString(entry.superseded_by) ||
      !isNullableString(entry.valid_from) ||
      !isNullableString(entry.valid_until) ||
      !isNullableString(entry.expires) ||
      typeof entry.source_mtime_ms !== "number"
    ) {
      return null;
    }

    validatedEntries.push({
      id: entry.id,
      relativePath: entry.relativePath,
      title: entry.title,
      summary: entry.summary,
      tags: entry.tags.filter((value): value is string => typeof value === "string"),
      risk_level: entry.risk_level as DerivedMemoryIndexEntry["risk_level"],
      path_scope: entry.path_scope.filter((value): value is string => typeof value === "string"),
      files: entry.files.filter((value): value is string => typeof value === "string"),
      token_size: entry.token_size,
      updated_at: entry.updated_at,
      date: entry.date,
      type: entry.type as DerivedMemoryIndexEntry["type"],
      status: entry.status as DerivedMemoryIndexEntry["status"],
      stale: entry.stale,
      review_state: entry.review_state as DerivedMemoryIndexEntry["review_state"],
      superseded_by: entry.superseded_by,
      valid_from: entry.valid_from,
      valid_until: entry.valid_until,
      expires: entry.expires,
      source_mtime_ms: entry.source_mtime_ms,
    });
  }

  if (validatedEntries.length !== entry_count) {
    return null;
  }

  return {
    version,
    generated_at,
    entry_count,
    entries: validatedEntries,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function memoryFileStem(relativePath: string): string {
  const fileName = relativePath.split("/").at(-1) ?? "";
  return fileName.replace(/\.md$/i, "");
}

function toBrainRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.brain\//, "");
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "ENOENT";
}
