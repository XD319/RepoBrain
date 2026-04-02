import { mkdir, readdir, readFile, appendFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { getBrainDir, hasBrain, writeDefaultConfig } from "./config.js";
import {
  buildMemoryIdentity as buildScopedMemoryIdentity,
  slugifyMemoryTitle,
} from "./memory-identity.js";
import type {
  BrainActivityState,
  Memory,
  MemoryArea,
  MemoryActivityEntry,
  InvocationMode,
  MemorySource,
  MemoryStatus,
  MemoryOrigin,
  RiskLevel,
  StoredMemoryRecord,
  MemoryType,
} from "./types.js";
import {
  IMPORTANCE_LEVELS,
  INVOCATION_MODES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  MEMORY_SOURCES,
  MEMORY_ORIGINS,
  MEMORY_AREAS,
  RISK_LEVELS,
} from "./types.js";

const DIRECTORY_BY_TYPE: Record<MemoryType, string> = {
  decision: "decisions",
  gotcha: "gotchas",
  convention: "conventions",
  pattern: "patterns",
  working: "working",
  goal: "goals",
};

const ARRAY_FRONTMATTER_FIELDS = [
  "tags",
  "files",
  "related",
  "path_scope",
  "recommended_skills",
  "required_skills",
  "suppressed_skills",
  "skill_trigger_paths",
  "skill_trigger_tasks",
] as const;

type ArrayFrontmatterField = (typeof ARRAY_FRONTMATTER_FIELDS)[number];

const DEFAULT_INVOCATION_MODE: InvocationMode = "optional";
const DEFAULT_RISK_LEVEL: RiskLevel = "low";
const DEFAULT_MEMORY_SCORE = 60;
const DEFAULT_MEMORY_HIT_COUNT = 0;
const DEFAULT_MEMORY_LAST_USED: string | null = null;
const DEFAULT_MEMORY_STALE = false;
const DEFAULT_MEMORY_SUPERSEDES: string | null = null;
const DEFAULT_MEMORY_SUPERSEDED_BY: string | null = null;
const DEFAULT_MEMORY_VERSION = 1;
const DEFAULT_MEMORY_AREA: MemoryArea = "general";
const DEFAULT_GOAL_STATUS: MemoryStatus = "active";

export async function initBrain(projectRoot: string): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  const existedBeforeInit = await hasBrain(projectRoot);

  await mkdir(brainDir, { recursive: true });
  await Promise.all([
    mkdir(path.join(brainDir, "decisions"), { recursive: true }),
    mkdir(path.join(brainDir, "gotchas"), { recursive: true }),
    mkdir(path.join(brainDir, "conventions"), { recursive: true }),
    mkdir(path.join(brainDir, "patterns"), { recursive: true }),
    mkdir(path.join(brainDir, "working"), { recursive: true }),
    mkdir(path.join(brainDir, "goals"), { recursive: true }),
  ]);

  if (!existedBeforeInit) {
    await writeDefaultConfig(projectRoot);
  } else {
    try {
      await readFile(path.join(brainDir, "config.yaml"), "utf8");
    } catch {
      await writeDefaultConfig(projectRoot);
    }
  }

  await Promise.all([
    touchFile(path.join(brainDir, "errors.log")),
    updateIndex(projectRoot),
  ]);
}

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
    const relativePath = path.join(
      directory,
      ensureUniqueFileNameSuffix(normalizedMemory, fileName, attempt),
    );
    const filePath = path.join(brainDir, relativePath);

    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileAlreadyExistsError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to allocate a unique memory file name for "${normalizedMemory.title}".`);
}

export async function loadAllMemories(projectRoot: string): Promise<Memory[]> {
  const storedMemories = await loadStoredMemories(projectRoot);

  return storedMemories
    .map((entry) => entry.memory)
    .sort((left, right) => right.date.localeCompare(left.date));
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
            return {
              filePath,
              relativePath: path.relative(projectRoot, filePath),
              memory,
            };
          }),
        );

        return loaded;
      } catch (error) {
        if (isMissingDirectoryError(error)) {
          return [];
        }

        throw error;
      }
    }),
  );

  return memoriesByType
    .flat()
    .sort((left, right) => right.memory.date.localeCompare(left.memory.date));
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function appendErrorLog(projectRoot: string, message: string): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  await mkdir(brainDir, { recursive: true });
  await appendFile(
    path.join(brainDir, "errors.log"),
    `[${new Date().toISOString()}] ${message}\n`,
    "utf8",
  );
}

export async function recordInjectedMemories(
  projectRoot: string,
  memories: Memory[],
): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  await mkdir(brainDir, { recursive: true });
  const injectedAt = new Date().toISOString().slice(0, 10);
  const activityStatePath = getActivityStatePath(projectRoot);

  const operations: AtomicWriteOperation[] = [];
  if (memories.length > 0) {
    const touchedKeys = new Set(memories.map((memory) => getMemoryKey(memory)));
    const existingRecords = await loadStoredMemories(projectRoot);

    for (const entry of existingRecords) {
      if (!touchedKeys.has(getMemoryKey(entry.memory))) {
        continue;
      }

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
    return {
      recentLoadedMemories: [],
    };
  }
}

export function getMemoryStatus(memory: Memory): MemoryStatus {
  return memory.status ?? "active";
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

  const updatedNewMemory = normalizeMemory({
    ...newRecord.memory,
    supersedes: oldRelativePath,
    version: nextVersion,
  });
  const updatedOldMemory = normalizeMemory({
    ...oldRecord.memory,
    superseded_by: newRelativePath,
    stale: true,
  });

  validateMemory(updatedNewMemory, `Memory file "${newRecord.filePath}"`);
  validateMemory(updatedOldMemory, `Memory file "${oldRecord.filePath}"`);

  await commitAtomicWriteOperations([
    createAtomicWriteOperation(newRecord.filePath, serializeMemory(updatedNewMemory)),
    createAtomicWriteOperation(oldRecord.filePath, serializeMemory(updatedOldMemory)),
  ]);

  return {
    newVersion: nextVersion,
  };
}

export async function approveCandidateMemory(
  record: StoredMemoryRecord,
  projectRoot: string,
): Promise<void> {
  const promotedMemory: Memory = {
    ...record.memory,
    status: "active",
    stale: false,
  };

  await supersedeMatchingActiveMemories(promotedMemory, projectRoot, record.filePath);
  await overwriteStoredMemory({
    ...record,
    memory: promotedMemory,
  });
}

export async function updateStoredMemoryStatus(
  record: StoredMemoryRecord,
  status: MemoryStatus,
): Promise<void> {
  await overwriteStoredMemory({
    ...record,
    memory: {
      ...record.memory,
      status,
      stale: status === "stale" ? true : record.memory.stale,
    },
  });
}

function validateMemory(memory: Memory, context = "Memory"): void {
  if (!MEMORY_TYPES.includes(memory.type)) {
    throw new Error(`${context} has unsupported type "${memory.type}". Expected one of: ${MEMORY_TYPES.join(", ")}.`);
  }

  if (!IMPORTANCE_LEVELS.includes(memory.importance)) {
    throw new Error(
      `${context} has unsupported importance "${memory.importance}". Expected one of: ${IMPORTANCE_LEVELS.join(", ")}.`,
    );
  }

  if (memory.source && !MEMORY_SOURCES.includes(memory.source)) {
    throw new Error(
      `${context} has unsupported source "${memory.source}". Expected one of: ${MEMORY_SOURCES.join(", ")}.`,
    );
  }

  if (memory.status && !MEMORY_STATUSES.includes(memory.status)) {
    throw new Error(
      `${context} has unsupported status "${memory.status}". Expected one of: ${MEMORY_STATUSES.join(", ")}.`,
    );
  }

  if (memory.origin && !MEMORY_ORIGINS.includes(memory.origin)) {
    throw new Error(
      `${context} has unsupported origin "${memory.origin}". Expected one of: ${MEMORY_ORIGINS.join(", ")}.`,
    );
  }

  if (!INVOCATION_MODES.includes(memory.invocation_mode ?? DEFAULT_INVOCATION_MODE)) {
    throw new Error(
      `${context} has unsupported invocation_mode "${memory.invocation_mode}". Expected one of: ${INVOCATION_MODES.join(", ")}.`,
    );
  }

  if (!RISK_LEVELS.includes(memory.risk_level ?? DEFAULT_RISK_LEVEL)) {
    throw new Error(
      `${context} has unsupported risk_level "${memory.risk_level}". Expected one of: ${RISK_LEVELS.join(", ")}.`,
    );
  }

  if (memory.area && !MEMORY_AREAS.includes(memory.area)) {
    throw new Error(
      `${context} has unsupported area "${memory.area}". Expected one of: ${MEMORY_AREAS.join(", ")}.`,
    );
  }

  if (!memory.title.trim() || !memory.summary.trim() || !memory.detail.trim()) {
    throw new Error(`${context} requires non-empty title, summary, and detail.`);
  }

  if (!Number.isFinite(memory.score) || memory.score < 0 || memory.score > 100) {
    throw new Error(`${context} has invalid score "${memory.score}". Expected a number between 0 and 100.`);
  }

  if (!Number.isInteger(memory.hit_count) || memory.hit_count < 0) {
    throw new Error(`${context} has invalid hit_count "${memory.hit_count}". Expected a non-negative integer.`);
  }

  if (memory.last_used !== null && !isNonEmptyIsoDateString(memory.last_used)) {
    throw new Error(`${context} has invalid last_used "${memory.last_used}". Expected an ISO date string or null.`);
  }

  if (!isNonEmptyIsoDateString(memory.created_at)) {
    throw new Error(`${context} has invalid created_at "${memory.created_at}". Expected an ISO date string.`);
  }

  if (memory.created !== undefined && !isIsoDateOnly(memory.created)) {
    throw new Error(`${context} has invalid created "${memory.created}". Expected YYYY-MM-DD.`);
  }

  if (memory.updated !== undefined && !isIsoDateOnly(memory.updated)) {
    throw new Error(`${context} has invalid updated "${memory.updated}". Expected YYYY-MM-DD.`);
  }

  if (memory.expires !== undefined && !isIsoDateOnly(memory.expires)) {
    throw new Error(`${context} has invalid expires "${memory.expires}". Expected YYYY-MM-DD.`);
  }

  if (typeof memory.stale !== "boolean") {
    throw new Error(`${context} has invalid stale "${memory.stale}". Expected a boolean.`);
  }

  validateStringArray(memory.tags, "tags", context);
  validateStringArray(memory.files ?? [], "files", context);
  validateNullableRelativeBrainPath(memory.supersedes ?? DEFAULT_MEMORY_SUPERSEDES, "supersedes", context);
  validateNullableRelativeBrainPath(memory.superseded_by ?? DEFAULT_MEMORY_SUPERSEDED_BY, "superseded_by", context);
  validateVersion(memory.version ?? DEFAULT_MEMORY_VERSION, context);
  validateStringArray(memory.related ?? [], "related", context);
  validateStringArray(memory.path_scope ?? [], "path_scope", context);
  validateStringArray(memory.recommended_skills ?? [], "recommended_skills", context);
  validateStringArray(memory.required_skills ?? [], "required_skills", context);
  validateStringArray(memory.suppressed_skills ?? [], "suppressed_skills", context);
  validateStringArray(memory.skill_trigger_paths ?? [], "skill_trigger_paths", context);
  validateStringArray(memory.skill_trigger_tasks ?? [], "skill_trigger_tasks", context);
}

function serializeMemory(memory: Memory): string {
  const normalizedMemory = normalizeMemory(memory);
  const frontmatterLines = [
    "---",
    `type: ${quoteYaml(normalizedMemory.type)}`,
    `title: ${quoteYaml(normalizedMemory.title)}`,
    `summary: ${quoteYaml(normalizedMemory.summary)}`,
    "tags:",
    ...normalizedMemory.tags.map((tag) => `  - ${quoteYaml(tag)}`),
    `importance: ${quoteYaml(normalizedMemory.importance)}`,
    `score: ${normalizedMemory.score}`,
    `hit_count: ${normalizedMemory.hit_count}`,
    `last_used: ${quoteYamlNullable(normalizedMemory.last_used)}`,
    `created_at: ${quoteYaml(normalizedMemory.created_at)}`,
    `created: ${quoteYaml(normalizedMemory.created ?? isoDateOnlyFromKnownDate(normalizedMemory.created_at))}`,
    `updated: ${quoteYaml(normalizedMemory.updated ?? isoDateOnlyFromKnownDate(normalizedMemory.date))}`,
    `stale: ${normalizedMemory.stale ? "true" : "false"}`,
    `supersedes: ${quoteYamlNullable(normalizedMemory.supersedes ?? DEFAULT_MEMORY_SUPERSEDES)}`,
    `superseded_by: ${quoteYamlNullable(normalizedMemory.superseded_by ?? DEFAULT_MEMORY_SUPERSEDED_BY)}`,
    `version: ${normalizedMemory.version ?? DEFAULT_MEMORY_VERSION}`,
    `date: ${quoteYaml(normalizedMemory.date)}`,
  ];

  if (normalizedMemory.source) {
    frontmatterLines.push(`source: ${quoteYaml(normalizedMemory.source)}`);
  }

  if (normalizedMemory.status) {
    frontmatterLines.push(`status: ${quoteYaml(normalizedMemory.status)}`);
  }

  if (normalizedMemory.origin) {
    frontmatterLines.push(`origin: ${quoteYaml(normalizedMemory.origin)}`);
  }

  appendArrayField(frontmatterLines, "related", normalizedMemory.related ?? []);
  appendArrayField(frontmatterLines, "path_scope", normalizedMemory.path_scope ?? []);
  appendArrayField(frontmatterLines, "files", normalizedMemory.files ?? []);
  appendArrayField(frontmatterLines, "recommended_skills", normalizedMemory.recommended_skills ?? []);
  appendArrayField(frontmatterLines, "required_skills", normalizedMemory.required_skills ?? []);
  appendArrayField(frontmatterLines, "suppressed_skills", normalizedMemory.suppressed_skills ?? []);
  appendArrayField(frontmatterLines, "skill_trigger_paths", normalizedMemory.skill_trigger_paths ?? []);
  appendArrayField(frontmatterLines, "skill_trigger_tasks", normalizedMemory.skill_trigger_tasks ?? []);
  if (normalizedMemory.area) {
    frontmatterLines.push(`area: ${quoteYaml(normalizedMemory.area)}`);
  }
  if (normalizedMemory.expires) {
    frontmatterLines.push(`expires: ${quoteYaml(normalizedMemory.expires)}`);
  }
  frontmatterLines.push(`invocation_mode: ${quoteYaml(normalizedMemory.invocation_mode ?? DEFAULT_INVOCATION_MODE)}`);
  frontmatterLines.push(`risk_level: ${quoteYaml(normalizedMemory.risk_level ?? DEFAULT_RISK_LEVEL)}`);
  frontmatterLines.push("---", "", normalizedMemory.detail.trim(), "");

  return frontmatterLines.join("\n");
}

function parseMemory(content: string, filePath: string): Memory {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Memory file "${filePath}" is missing valid frontmatter.`);
  }

  const rawFrontmatter = match[1];
  const rawDetail = match[2];
  if (!rawFrontmatter || rawDetail === undefined) {
    throw new Error(`Memory file "${filePath}" is missing required frontmatter or body content.`);
  }

  const frontmatter = parseFrontmatter(rawFrontmatter);
  const type = frontmatter.type;
  const importance = frontmatter.importance;
  const source = frontmatter.source;
  const status = frontmatter.status;
  const origin = frontmatter.origin;

  if (!type || !importance || !frontmatter.title || !frontmatter.summary || !frontmatter.date) {
    throw new Error(
      `Memory file "${filePath}" must include type, title, summary, importance, and date in frontmatter.`,
    );
  }

  const memoryInput: Memory = {
    type: type as MemoryType,
    title: frontmatter.title,
    summary: frontmatter.summary,
    detail: rawDetail.trim(),
    tags: frontmatter.tags,
    importance: importance as Memory["importance"],
    date: frontmatter.date,
    score: frontmatter.score ?? DEFAULT_MEMORY_SCORE,
    hit_count: frontmatter.hit_count ?? DEFAULT_MEMORY_HIT_COUNT,
    last_used: frontmatter.last_used ?? DEFAULT_MEMORY_LAST_USED,
    created_at: frontmatter.created_at ?? frontmatter.date,
    stale: (frontmatter.stale ?? DEFAULT_MEMORY_STALE) as Memory["stale"],
    supersedes: frontmatter.supersedes ?? DEFAULT_MEMORY_SUPERSEDES,
    superseded_by: frontmatter.superseded_by ?? DEFAULT_MEMORY_SUPERSEDED_BY,
    version: frontmatter.version ?? DEFAULT_MEMORY_VERSION,
    files: frontmatter.files,
    related: frontmatter.related,
    path_scope: frontmatter.path_scope,
    recommended_skills: frontmatter.recommended_skills,
    required_skills: frontmatter.required_skills,
    suppressed_skills: frontmatter.suppressed_skills,
    skill_trigger_paths: frontmatter.skill_trigger_paths,
    skill_trigger_tasks: frontmatter.skill_trigger_tasks,
    ...(frontmatter.created ? { created: frontmatter.created } : {}),
    ...(frontmatter.updated ? { updated: frontmatter.updated } : {}),
    ...(frontmatter.area ? { area: frontmatter.area as MemoryArea } : {}),
    ...(frontmatter.expires ? { expires: frontmatter.expires } : {}),
  };

  if (frontmatter.invocation_mode) {
    memoryInput.invocation_mode = frontmatter.invocation_mode as InvocationMode;
  }

  if (frontmatter.risk_level) {
    memoryInput.risk_level = frontmatter.risk_level as RiskLevel;
  }

  const memory = normalizeMemory(memoryInput);

  if (source) {
    memory.source = source as MemorySource;
  }

  if (status) {
    memory.status = status as MemoryStatus;
  }

  if (origin) {
    memory.origin = origin as MemoryOrigin;
  }

  validateMemory(memory, `Memory file "${filePath}"`);
  return memory;
}

function parseFrontmatter(raw: string): {
  type?: string;
  title?: string;
  summary?: string;
  tags: string[];
  files: string[];
  related: string[];
  path_scope: string[];
  recommended_skills: string[];
  required_skills: string[];
  suppressed_skills: string[];
  skill_trigger_paths: string[];
  skill_trigger_tasks: string[];
  importance?: string;
  date?: string;
  score?: number;
  hit_count?: number;
  last_used?: string | null;
  created_at?: string;
  created?: string;
  updated?: string;
  stale?: boolean | string;
  supersedes?: string | null;
  superseded_by?: string | null;
  version?: number;
  source?: string;
  status?: string;
  origin?: string;
  invocation_mode?: string;
  risk_level?: string;
  area?: string;
  expires?: string;
} {
  const result: {
    type?: string;
    title?: string;
    summary?: string;
    tags: string[];
    files: string[];
    related: string[];
    path_scope: string[];
    recommended_skills: string[];
    required_skills: string[];
    suppressed_skills: string[];
    skill_trigger_paths: string[];
    skill_trigger_tasks: string[];
    importance?: string;
    date?: string;
    score?: number;
    hit_count?: number;
    last_used?: string | null;
    created_at?: string;
    created?: string;
    updated?: string;
    stale?: boolean | string;
    supersedes?: string | null;
    superseded_by?: string | null;
    version?: number;
    source?: string;
    status?: string;
    origin?: string;
    invocation_mode?: string;
    risk_level?: string;
    area?: string;
    expires?: string;
  } = {
    tags: [],
    files: [],
    related: [],
    path_scope: [],
    recommended_skills: [],
    required_skills: [],
    suppressed_skills: [],
    skill_trigger_paths: [],
    skill_trigger_tasks: [],
  };

  let activeKey: ArrayFrontmatterField | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("  - ") && activeKey) {
      result[activeKey].push(unquoteYaml(line.slice(4).trim()));
      continue;
    }

    activeKey = null;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (ARRAY_FRONTMATTER_FIELDS.includes(key as ArrayFrontmatterField)) {
      activeKey = key as ArrayFrontmatterField;
      continue;
    }

    switch (key) {
      case "type":
      case "title":
      case "summary":
      case "importance":
      case "date":
      case "created_at":
      case "created":
      case "updated":
      case "source":
      case "status":
      case "origin":
      case "invocation_mode":
      case "risk_level":
      case "area":
      case "expires":
        result[key] = unquoteYaml(value);
        break;
      case "score":
      case "hit_count": {
        const parsed = parseYamlNumber(value);
        if (parsed !== undefined) {
          result[key] = parsed;
        }
        break;
      }
      case "version": {
        const parsed = parseYamlNumber(value);
        if (parsed !== undefined) {
          result.version = parsed;
        }
        break;
      }
      case "last_used":
      {
        const parsed = parseYamlNullableString(value);
        if (parsed !== undefined) {
          result.last_used = parsed;
        }
        break;
      }
      case "supersedes":
      case "superseded_by":
      {
        const parsed = parseYamlNullableString(value);
        if (parsed !== undefined) {
          result[key] = parsed;
        }
        break;
      }
      case "stale":
      {
        const parsed = parseYamlBoolean(value);
        if (parsed !== undefined) {
          result.stale = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  return result;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function quoteYamlNullable(value: string | null): string {
  return value === null ? "null" : quoteYaml(value);
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function parseYamlNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseYamlNullableString(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed === "null") {
    return null;
  }

  return unquoteYaml(trimmed);
}

function parseYamlBoolean(value: string): boolean | string | undefined {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  return trimmed ? trimmed : undefined;
}

function normalizeMemory(memory: Memory): Memory {
  const created = normalizeOptionalIsoDateOnly(memory.created ?? isoDateOnlyFromKnownDate(memory.created_at ?? memory.date));
  const updated = normalizeOptionalIsoDateOnly(memory.updated ?? isoDateOnlyFromKnownDate(memory.date));
  const expires = normalizeOptionalIsoDateOnly(memory.expires);
  const status = normalizeMemoryStatus(memory.type, memory.status);

  return {
    ...memory,
    tags: normalizeStringArray(memory.tags),
    files: normalizeStringArray(memory.files ?? []),
    related: normalizeStringArray(memory.related ?? []),
    path_scope: normalizeStringArray(memory.path_scope ?? []),
    recommended_skills: normalizeStringArray(memory.recommended_skills ?? []),
    required_skills: normalizeStringArray(memory.required_skills ?? []),
    suppressed_skills: normalizeStringArray(memory.suppressed_skills ?? []),
    skill_trigger_paths: normalizeStringArray(memory.skill_trigger_paths ?? []),
    skill_trigger_tasks: normalizeStringArray(memory.skill_trigger_tasks ?? []),
    score: memory.score ?? DEFAULT_MEMORY_SCORE,
    hit_count: memory.hit_count ?? DEFAULT_MEMORY_HIT_COUNT,
    last_used: memory.last_used ?? DEFAULT_MEMORY_LAST_USED,
    created_at: memory.created_at ?? memory.date,
    created: created ?? isoDateOnlyFromKnownDate(memory.created_at ?? memory.date),
    updated: updated ?? created ?? isoDateOnlyFromKnownDate(memory.date),
    stale: memory.stale ?? DEFAULT_MEMORY_STALE,
    supersedes: normalizeNullableBrainRelativePath(memory.supersedes ?? DEFAULT_MEMORY_SUPERSEDES),
    superseded_by: normalizeNullableBrainRelativePath(
      memory.superseded_by ?? DEFAULT_MEMORY_SUPERSEDED_BY,
    ),
    version: memory.version ?? DEFAULT_MEMORY_VERSION,
    invocation_mode: memory.invocation_mode ?? DEFAULT_INVOCATION_MODE,
    risk_level: memory.risk_level ?? DEFAULT_RISK_LEVEL,
    ...(memory.area ? { area: memory.area } : {}),
    ...(expires ? { expires } : {}),
    ...(status ? { status } : {}),
  };
}

function normalizeStringArray(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeOptionalIsoDateOnly(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (isIsoDateOnly(trimmed)) {
    return trimmed;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return trimmed;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeMemoryStatus(type: MemoryType, status: MemoryStatus | undefined): MemoryStatus | undefined {
  if (type === "goal") {
    return status ?? DEFAULT_GOAL_STATUS;
  }

  return status;
}

function validateStringArray(values: unknown, fieldName: string, context: string): void {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(`${context} field "${fieldName}" must be an array of non-empty strings.`);
  }
}

function validateNullableRelativeBrainPath(
  value: string | null,
  fieldName: "supersedes" | "superseded_by",
  context: string,
): void {
  if (value === null) {
    return;
  }

  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`${context} field "${fieldName}" must be a non-empty relative .brain path or null.`);
  }

  const normalized = normalizeBrainRelativePath(trimmed);
  if (
    !normalized ||
    trimmed.startsWith("/") ||
    normalized.startsWith("../") ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    throw new Error(`${context} field "${fieldName}" must stay relative to .brain/.`);
  }
}

function validateVersion(value: number, context: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${context} has invalid version "${value}". Expected an integer >= 1.`);
  }
}

function normalizeNullableBrainRelativePath(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = normalizeBrainRelativePath(value);
  return normalized || null;
}

function normalizeBrainRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.brain\//, "")
    .replace(/^\/+/, "");
}

function appendArrayField(
  lines: string[],
  fieldName: Exclude<ArrayFrontmatterField, "tags">,
  values: string[],
): void {
  lines.push(`${fieldName}:`);
  for (const value of values) {
    lines.push(`  - ${quoteYaml(value)}`);
  }
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

function ensureUniqueFileNameSuffix(memory: Memory, fileName: string, attempt: number = 0): string {
  const stamp = memory.date
    .replace(/[^\d]/g, "")
    .slice(8, 17);

  const extension = path.extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const parts = [baseName];

  if (stamp) {
    parts.push(stamp);
  }

  if (attempt > 0) {
    parts.push(String(attempt + 1));
  }

  return `${parts.join("-")}${extension}`;
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "EEXIST"
  );
}

function getActivityStatePath(projectRoot: string): string {
  return path.join(getBrainDir(projectRoot), "activity.json");
}

interface AtomicWriteOperation {
  targetPath: string;
  tempPath: string;
  backupPath: string;
  content: string;
  existed: boolean;
}

function createAtomicWriteOperation(targetPath: string, content: string): AtomicWriteOperation {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    targetPath,
    tempPath: `${targetPath}.tmp-${stamp}`,
    backupPath: `${targetPath}.bak-${stamp}`,
    content,
    existed: false,
  };
}

async function commitAtomicWriteOperations(operations: AtomicWriteOperation[]): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  const prepared: AtomicWriteOperation[] = [];
  const movedToBackup: AtomicWriteOperation[] = [];
  const committed: AtomicWriteOperation[] = [];

  try {
    for (const operation of operations) {
      operation.existed = await pathExists(operation.targetPath);
      await writeFile(operation.tempPath, operation.content, "utf8");
      prepared.push(operation);
    }

    for (const operation of operations) {
      if (operation.existed) {
        await rename(operation.targetPath, operation.backupPath);
        movedToBackup.push(operation);
      }

      await rename(operation.tempPath, operation.targetPath);
      committed.push(operation);
    }

    await Promise.all(
      movedToBackup.map((operation) => rm(operation.backupPath, { force: true })),
    );
    await Promise.all(
      prepared.map((operation) => rm(operation.tempPath, { force: true })),
    );
  } catch (error) {
    for (const operation of committed.reverse()) {
      await rm(operation.targetPath, { force: true }).catch(() => undefined);
    }

    for (const operation of movedToBackup.reverse()) {
      await rename(operation.backupPath, operation.targetPath).catch(() => undefined);
    }

    await Promise.all(
      prepared.flatMap((operation) => [
        rm(operation.tempPath, { force: true }).catch(() => undefined),
        rm(operation.backupPath, { force: true }).catch(() => undefined),
      ]),
    );
    throw error;
  }
}

async function supersedeMatchingActiveMemories(
  memory: Memory,
  projectRoot: string,
  ignoredFilePath: string | null = null,
): Promise<void> {
  const existingMemories = await loadStoredMemories(projectRoot);
  const nextIdentity = getMemoryIdentity(memory);

  await Promise.all(
    existingMemories.map(async (entry) => {
      if (ignoredFilePath && entry.filePath === ignoredFilePath) {
        return;
      }

      if (getMemoryStatus(entry.memory) !== "active") {
        return;
      }

      if (getMemoryIdentity(entry.memory) !== nextIdentity) {
        return;
      }

      const updatedMemory: Memory = {
        ...entry.memory,
        status: "superseded",
      };

      await writeFile(entry.filePath, serializeMemory(updatedMemory), "utf8");
    }),
  );
}

function getMemoryIdentity(memory: Memory): string {
  return buildScopedMemoryIdentity(memory);
}

export function buildMemoryIdentity(memory: Memory): string {
  return getMemoryIdentity(memory);
}

function getMemoryKey(memory: Pick<Memory, "type" | "title" | "date">): string {
  return `${memory.type}|${memory.title}|${memory.date}`;
}

function toBrainRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.brain\//, "");
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
    const parsed = JSON.parse(raw) as {
      lastInjectedAt?: unknown;
      recentLoadedMemories?: unknown;
    };

    const recentLoadedMemories = Array.isArray(parsed.recentLoadedMemories)
      ? parsed.recentLoadedMemories
          .map((entry) => parseActivityEntry(entry))
          .filter((entry): entry is MemoryActivityEntry => entry !== null)
      : [];

    const lastInjectedAt =
      typeof parsed.lastInjectedAt === "string" && parsed.lastInjectedAt.trim()
        ? parsed.lastInjectedAt
        : null;

    return lastInjectedAt
      ? {
          lastInjectedAt,
          recentLoadedMemories,
        }
      : {
          recentLoadedMemories,
        };
  } catch {
    return {
      recentLoadedMemories: [],
    };
  }
}

function parseActivityEntry(value: unknown): MemoryActivityEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

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

function isNonEmptyIsoDateString(value: string): boolean {
  return Boolean(value.trim()) && !Number.isNaN(Date.parse(value));
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isoDateOnlyFromKnownDate(value: string): string {
  const normalized = normalizeOptionalIsoDateOnly(value);
  return normalized ?? value.slice(0, 10);
}

async function touchFile(filePath: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}
