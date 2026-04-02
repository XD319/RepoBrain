import { mkdir, readdir, readFile, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBrainDir, hasBrain, writeDefaultConfig } from "./config.js";
import {
  buildMemoryIdentity as buildScopedMemoryIdentity,
  slugifyMemoryTitle,
} from "./memory-identity.js";
import type {
  BrainActivityState,
  Memory,
  MemoryActivityEntry,
  InvocationMode,
  MemorySource,
  MemoryStatus,
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
  RISK_LEVELS,
} from "./types.js";

const DIRECTORY_BY_TYPE: Record<MemoryType, string> = {
  decision: "decisions",
  gotcha: "gotchas",
  convention: "conventions",
  pattern: "patterns",
};

const ARRAY_FRONTMATTER_FIELDS = [
  "tags",
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

export async function initBrain(projectRoot: string): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  const existedBeforeInit = await hasBrain(projectRoot);

  await mkdir(brainDir, { recursive: true });
  await Promise.all([
    mkdir(path.join(brainDir, "decisions"), { recursive: true }),
    mkdir(path.join(brainDir, "gotchas"), { recursive: true }),
    mkdir(path.join(brainDir, "conventions"), { recursive: true }),
    mkdir(path.join(brainDir, "patterns"), { recursive: true }),
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
  const injectedAt = new Date().toISOString();

  if (memories.length > 0) {
    const touchedKeys = new Set(memories.map((memory) => getMemoryKey(memory)));
    const existingRecords = await loadStoredMemories(projectRoot);

    await Promise.all(
      existingRecords.map(async (entry) => {
        if (!touchedKeys.has(getMemoryKey(entry.memory))) {
          return;
        }

        await overwriteStoredMemory({
          ...entry,
          memory: {
            ...entry.memory,
            hit_count: entry.memory.hit_count + 1,
            last_used: injectedAt,
            stale: false,
          },
        });
      }),
    );
  }

  const state: BrainActivityState = {
    lastInjectedAt: injectedAt,
    recentLoadedMemories: memories.slice(0, 5).map(toActivityEntry),
  };

  await writeFile(getActivityStatePath(projectRoot), JSON.stringify(state, null, 2), "utf8");
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

  if (typeof memory.stale !== "boolean") {
    throw new Error(`${context} has invalid stale "${memory.stale}". Expected a boolean.`);
  }

  validateStringArray(memory.tags, "tags", context);
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
    `date: ${quoteYaml(normalizedMemory.date)}`,
    `score: ${normalizedMemory.score}`,
    `hit_count: ${normalizedMemory.hit_count}`,
    `last_used: ${quoteYamlNullable(normalizedMemory.last_used)}`,
    `created_at: ${quoteYaml(normalizedMemory.created_at)}`,
    `stale: ${normalizedMemory.stale ? "true" : "false"}`,
  ];

  if (normalizedMemory.source) {
    frontmatterLines.push(`source: ${quoteYaml(normalizedMemory.source)}`);
  }

  if (normalizedMemory.status) {
    frontmatterLines.push(`status: ${quoteYaml(normalizedMemory.status)}`);
  }

  appendArrayField(frontmatterLines, "path_scope", normalizedMemory.path_scope ?? []);
  appendArrayField(frontmatterLines, "recommended_skills", normalizedMemory.recommended_skills ?? []);
  appendArrayField(frontmatterLines, "required_skills", normalizedMemory.required_skills ?? []);
  appendArrayField(frontmatterLines, "suppressed_skills", normalizedMemory.suppressed_skills ?? []);
  appendArrayField(frontmatterLines, "skill_trigger_paths", normalizedMemory.skill_trigger_paths ?? []);
  appendArrayField(frontmatterLines, "skill_trigger_tasks", normalizedMemory.skill_trigger_tasks ?? []);
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
    path_scope: frontmatter.path_scope,
    recommended_skills: frontmatter.recommended_skills,
    required_skills: frontmatter.required_skills,
    suppressed_skills: frontmatter.suppressed_skills,
    skill_trigger_paths: frontmatter.skill_trigger_paths,
    skill_trigger_tasks: frontmatter.skill_trigger_tasks,
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

  validateMemory(memory, `Memory file "${filePath}"`);
  return memory;
}

function parseFrontmatter(raw: string): {
  type?: string;
  title?: string;
  summary?: string;
  tags: string[];
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
  stale?: boolean | string;
  source?: string;
  status?: string;
  invocation_mode?: string;
  risk_level?: string;
} {
  const result: {
    type?: string;
    title?: string;
    summary?: string;
    tags: string[];
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
    stale?: boolean | string;
    source?: string;
    status?: string;
    invocation_mode?: string;
    risk_level?: string;
  } = {
    tags: [],
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
      case "source":
      case "status":
      case "invocation_mode":
      case "risk_level":
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
      case "last_used":
      {
        const parsed = parseYamlNullableString(value);
        if (parsed !== undefined) {
          result.last_used = parsed;
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
  return {
    ...memory,
    tags: normalizeStringArray(memory.tags),
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
    stale: memory.stale ?? DEFAULT_MEMORY_STALE,
    invocation_mode: memory.invocation_mode ?? DEFAULT_INVOCATION_MODE,
    risk_level: memory.risk_level ?? DEFAULT_RISK_LEVEL,
  };
}

function normalizeStringArray(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function validateStringArray(values: unknown, fieldName: string, context: string): void {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(`${context} field "${fieldName}" must be an array of non-empty strings.`);
  }
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

async function touchFile(filePath: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}
