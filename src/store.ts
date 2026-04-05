import { mkdir, readdir, readFile, appendFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { getBrainDir, hasBrain, writeDefaultConfig } from "./config.js";
import {
  buildMemoryIdentity as buildScopedMemoryIdentity,
  slugifyMemoryTitle,
} from "./memory-identity.js";
import { parseTemporalInstant } from "./temporal.js";
import type {
  BrainActivityState,
  Memory,
  MemoryArea,
  MemoryActivityEntry,
  InvocationMode,
  MemorySource,
  MemoryStatus,
  MemoryOrigin,
  ReviewState,
  RiskLevel,
  StoredMemoryRecord,
  StoredPreferenceRecord,
  MemoryType,
  Preference,
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
  PREFERENCE_KINDS,
  PREFERENCE_TARGET_TYPES,
  PREFERENCE_VALUES,
  REVIEW_STATES,
} from "./types.js";

const DIRECTORY_BY_TYPE: Record<MemoryType, string> = {
  decision: "decisions",
  gotcha: "gotchas",
  convention: "conventions",
  pattern: "patterns",
  working: "working",
  goal: "goals",
};

export const ARRAY_FRONTMATTER_FIELDS = [
  "tags",
  "files",
  "related",
  "path_scope",
  "recommended_skills",
  "required_skills",
  "suppressed_skills",
  "skill_trigger_paths",
  "skill_trigger_tasks",
  "task_hints",
  "path_hints",
] as const;

type ArrayFrontmatterField = (typeof ARRAY_FRONTMATTER_FIELDS)[number];

export const DEFAULT_INVOCATION_MODE: InvocationMode = "optional";
export const DEFAULT_RISK_LEVEL: RiskLevel = "low";
export const DEFAULT_MEMORY_SCORE = 60;
export const DEFAULT_MEMORY_HIT_COUNT = 0;
export const DEFAULT_MEMORY_LAST_USED: string | null = null;
export const DEFAULT_MEMORY_STALE = false;
export const DEFAULT_MEMORY_SUPERSEDES: string | null = null;
export const DEFAULT_MEMORY_SUPERSEDED_BY: string | null = null;
export const DEFAULT_MEMORY_VERSION = 1;
export const DEFAULT_MEMORY_AREA: MemoryArea = "general";
export const DEFAULT_GOAL_STATUS: MemoryStatus = "active";
export const DEFAULT_MEMORY_CONFIDENCE = 1;
export const DEFAULT_REVIEW_STATE: ReviewState = "unset";

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
    mkdir(path.join(brainDir, "preferences"), { recursive: true }),
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

  return {
    newVersion: nextVersion,
  };
}

export async function approveCandidateMemory(
  record: StoredMemoryRecord,
  projectRoot: string,
): Promise<void> {
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
  await overwriteStoredMemory({
    ...record,
    memory: promotedMemory,
  });
}

export async function updateStoredMemoryStatus(
  record: StoredMemoryRecord,
  status: MemoryStatus,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const nextMemory: Memory = {
    ...record.memory,
    status,
    stale: status === "stale" ? true : record.memory.stale,
  };
  if (status === "stale") {
    nextMemory.valid_until = record.memory.valid_until ?? nowIso;
    nextMemory.supersession_reason =
      record.memory.supersession_reason ?? "Marked stale via brain dismiss or score workflow";
  }
  if (status === "superseded") {
    nextMemory.valid_until = record.memory.valid_until ?? nowIso;
    nextMemory.supersession_reason =
      record.memory.supersession_reason ?? "Marked superseded via brain status update";
  }
  await overwriteStoredMemory({
    ...record,
    memory: normalizeMemory(nextMemory),
  });
}

function validateOptionalTemporalIso(value: string | undefined, field: string, context: string): void {
  if (value === undefined) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${context} field "${field}" cannot be empty.`);
  }
  if (parseTemporalInstant(trimmed) === null && !isIsoDateOnly(trimmed)) {
    throw new Error(`${context} has invalid ${field} "${value}". Expected an ISO date or datetime.`);
  }
}

export function validateMemory(memory: Memory, context = "Memory"): void {
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

  validateOptionalTemporalIso(memory.valid_from, "valid_from", context);
  validateOptionalTemporalIso(memory.valid_until, "valid_until", context);
  validateOptionalTemporalIso(memory.observed_at, "observed_at", context);
  if (memory.supersession_reason !== undefined && memory.supersession_reason !== null) {
    if (typeof memory.supersession_reason !== "string") {
      throw new Error(`${context} has invalid supersession_reason.`);
    }
  }
  if (memory.confidence !== undefined) {
    if (!Number.isFinite(memory.confidence) || memory.confidence < 0 || memory.confidence > 1) {
      throw new Error(`${context} has invalid confidence "${memory.confidence}". Expected a number between 0 and 1.`);
    }
  }
  if (memory.source_episode !== undefined && typeof memory.source_episode !== "string") {
    throw new Error(`${context} has invalid source_episode.`);
  }
  if (memory.review_state !== undefined && !REVIEW_STATES.includes(memory.review_state)) {
    throw new Error(
      `${context} has unsupported review_state "${memory.review_state}". Expected one of: ${REVIEW_STATES.join(", ")}.`,
    );
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

export function serializeMemory(memory: Memory): string {
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
  if (normalizedMemory.valid_from) {
    frontmatterLines.push(`valid_from: ${quoteYaml(normalizedMemory.valid_from)}`);
  }
  if (normalizedMemory.valid_until) {
    frontmatterLines.push(`valid_until: ${quoteYaml(normalizedMemory.valid_until)}`);
  }
  if (normalizedMemory.observed_at) {
    frontmatterLines.push(`observed_at: ${quoteYaml(normalizedMemory.observed_at)}`);
  }
  if (normalizedMemory.supersession_reason) {
    frontmatterLines.push(`supersession_reason: ${quoteYaml(normalizedMemory.supersession_reason)}`);
  }
  if ((normalizedMemory.confidence ?? DEFAULT_MEMORY_CONFIDENCE) !== DEFAULT_MEMORY_CONFIDENCE) {
    frontmatterLines.push(`confidence: ${normalizedMemory.confidence ?? DEFAULT_MEMORY_CONFIDENCE}`);
  }
  if (normalizedMemory.source_episode) {
    frontmatterLines.push(`source_episode: ${quoteYaml(normalizedMemory.source_episode)}`);
  }
  if ((normalizedMemory.review_state ?? DEFAULT_REVIEW_STATE) !== DEFAULT_REVIEW_STATE) {
    frontmatterLines.push(`review_state: ${quoteYaml(normalizedMemory.review_state ?? DEFAULT_REVIEW_STATE)}`);
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
    ...(frontmatter.valid_from ? { valid_from: frontmatter.valid_from } : {}),
    ...(frontmatter.valid_until ? { valid_until: frontmatter.valid_until } : {}),
    ...(frontmatter.observed_at ? { observed_at: frontmatter.observed_at } : {}),
    ...(frontmatter.supersession_reason !== undefined
      ? { supersession_reason: frontmatter.supersession_reason }
      : {}),
    ...(frontmatter.confidence !== undefined ? { confidence: frontmatter.confidence } : {}),
    ...(frontmatter.source_episode ? { source_episode: frontmatter.source_episode } : {}),
    ...(frontmatter.review_state ? { review_state: frontmatter.review_state as ReviewState } : {}),
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

export function parseFrontmatter(raw: string): {
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
  task_hints: string[];
  path_hints: string[];
  importance?: string;
  date?: string;
  score?: number;
  hit_count?: number;
  last_used?: string | null;
  created_at?: string;
  created?: string;
  updated?: string;
  updated_at?: string;
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
  kind?: string;
  target_type?: string;
  target?: string;
  preference?: string;
  confidence?: number;
  valid_from?: string;
  valid_until?: string;
  observed_at?: string;
  supersession_reason?: string | null;
  source_episode?: string;
  review_state?: string;
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
    task_hints: string[];
    path_hints: string[];
    importance?: string;
    date?: string;
    score?: number;
    hit_count?: number;
    last_used?: string | null;
    created_at?: string;
    created?: string;
    updated?: string;
    updated_at?: string;
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
    kind?: string;
    target_type?: string;
    target?: string;
    preference?: string;
    confidence?: number;
    valid_from?: string;
    valid_until?: string;
    observed_at?: string;
    supersession_reason?: string | null;
    source_episode?: string;
    review_state?: string;
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
    task_hints: [],
    path_hints: [],
  };

  let activeKey: ArrayFrontmatterField | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("  - ") && activeKey) {
      (result as any)[activeKey].push(unquoteYaml(line.slice(4).trim()));
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
      case "kind":
      case "target_type":
      case "target":
      case "preference":
      case "valid_from":
      case "valid_until":
      case "updated_at":
      case "observed_at":
      case "source_episode":
      case "review_state":
        result[key] = unquoteYaml(value);
        break;
      case "score":
      case "hit_count":
      case "confidence": {
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
      case "supersession_reason":
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

function clampUnitInterval(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeOptionalTemporalBoundary(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  const t = parseTemporalInstant(trimmed);
  if (t === null) {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return new Date(t).toISOString();
}

export function normalizeMemory(memory: Memory): Memory {
  const normalizedCreatedAt = normalizeCreatedAt(memory.created_at, memory.created, memory.date);
  const created = normalizeOptionalIsoDateOnly(memory.created ?? isoDateOnlyFromKnownDate(normalizedCreatedAt));
  const updated = normalizeOptionalIsoDateOnly(memory.updated ?? created ?? isoDateOnlyFromKnownDate(memory.date));
  const expires = normalizeOptionalIsoDateOnly(memory.expires);
  const status = normalizeMemoryStatus(memory.type, memory.status);
  const valid_from =
    normalizeOptionalIsoDateOnly(memory.valid_from) ?? isoDateOnlyFromKnownDate(normalizedCreatedAt);
  const valid_until = normalizeOptionalTemporalBoundary(memory.valid_until);
  const observed_at = normalizeOptionalTemporalBoundary(memory.observed_at) ?? normalizedCreatedAt;
  const confidence = clampUnitInterval(memory.confidence ?? DEFAULT_MEMORY_CONFIDENCE);
  const review_state = (memory.review_state ?? DEFAULT_REVIEW_STATE) as ReviewState;

  return {
    ...memory,
    tags: normalizeTagArray(memory.tags),
    files: normalizePathArray(memory.files ?? []),
    related: normalizeRelativePathArray(memory.related ?? []),
    path_scope: normalizePathArray(memory.path_scope ?? []),
    recommended_skills: normalizeSkillArray(memory.recommended_skills ?? []),
    required_skills: normalizeSkillArray(memory.required_skills ?? []),
    suppressed_skills: normalizeSkillArray(memory.suppressed_skills ?? []),
    skill_trigger_paths: normalizePathArray(memory.skill_trigger_paths ?? []),
    skill_trigger_tasks: normalizeStringArray(memory.skill_trigger_tasks ?? []),
    score: memory.score ?? DEFAULT_MEMORY_SCORE,
    hit_count: memory.hit_count ?? DEFAULT_MEMORY_HIT_COUNT,
    last_used: memory.last_used ?? DEFAULT_MEMORY_LAST_USED,
    created_at: normalizedCreatedAt,
    created: created ?? isoDateOnlyFromKnownDate(normalizedCreatedAt),
    updated: updated ?? created ?? isoDateOnlyFromKnownDate(memory.date),
    stale: memory.stale ?? DEFAULT_MEMORY_STALE,
    supersedes: normalizeNullableBrainRelativePath(memory.supersedes ?? DEFAULT_MEMORY_SUPERSEDES),
    superseded_by: normalizeNullableBrainRelativePath(
      memory.superseded_by ?? DEFAULT_MEMORY_SUPERSEDED_BY,
    ),
    version: memory.version ?? DEFAULT_MEMORY_VERSION,
    invocation_mode: memory.invocation_mode ?? DEFAULT_INVOCATION_MODE,
    risk_level: memory.risk_level ?? DEFAULT_RISK_LEVEL,
    valid_from,
    ...(valid_until ? { valid_until } : {}),
    observed_at,
    supersession_reason: memory.supersession_reason ?? null,
    confidence,
    review_state,
    ...(memory.source_episode?.trim() ? { source_episode: memory.source_episode.trim() } : {}),
    ...(memory.area ? { area: memory.area } : {}),
    ...(expires ? { expires } : {}),
    ...(status ? { status } : {}),
  };
}

export function normalizeStringArray(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

export function normalizeOptionalIsoDateOnly(value: string | undefined): string | undefined {
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

export function normalizeNullableBrainRelativePath(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = normalizeBrainRelativePath(value);
  return normalized || null;
}

export function normalizeBrainRelativePath(value: string): string {
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

      const nowIso = new Date().toISOString();
      const updatedMemory = normalizeMemory({
        ...entry.memory,
        status: "superseded",
        stale: true,
        valid_until: entry.memory.valid_until ?? nowIso,
        supersession_reason:
          entry.memory.supersession_reason ?? "Superseded by newer active memory with the same identity",
      });

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

export function isNonEmptyIsoDateString(value: string): boolean {
  return Boolean(value.trim()) && !Number.isNaN(Date.parse(value));
}

export function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isoDateOnlyFromKnownDate(value: string): string {
  const normalized = normalizeOptionalIsoDateOnly(value);
  return normalized ?? value.slice(0, 10);
}

function normalizeTagArray(values: string[]): string[] {
  return normalizeStringArray(values).sort((left, right) => left.localeCompare(right));
}

function normalizeSkillArray(values: string[]): string[] {
  return normalizeStringArray(values).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function normalizeRelativePathArray(values: string[]): string[] {
  return normalizeStringArray(values.map((value) => normalizeBrainRelativePath(value)))
    .sort((left, right) => left.localeCompare(right));
}

function normalizePathArray(values: string[]): string[] {
  return normalizeStringArray(values.map((value) => normalizeRepoPathPattern(value)))
    .filter((value) => !isMeaninglessScopeValue(value))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeRepoPathPattern(value: string): string {
  return value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
}

function isMeaninglessScopeValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "." || normalized === "*" || normalized === "**" || normalized === "/";
}

function normalizeCreatedAt(
  createdAt: string | undefined,
  created: string | undefined,
  fallbackDate: string,
): string {
  const explicit = normalizeIsoDateTime(createdAt);
  if (explicit) {
    return explicit;
  }

  const createdDate = normalizeOptionalIsoDateOnly(created);
  if (createdDate) {
    return `${createdDate}T00:00:00.000Z`;
  }

  return normalizeIsoDateTime(fallbackDate) ?? fallbackDate;
}

function normalizeIsoDateTime(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return trimmed;
  }

  return new Date(parsed).toISOString();
}

export async function savePreference(preference: Preference, projectRoot: string): Promise<string> {
  const normalizedPreference = normalizePreference(preference);
  validatePreference(normalizedPreference);

  await initBrain(projectRoot);

  const brainDir = getBrainDir(projectRoot);
  const fileName = `pref-${normalizedPreference.target_type}-${slugifyMemoryTitle(normalizedPreference.target)}.md`;
  const content = serializePreference(normalizedPreference);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const relativePath = path.join(
      "preferences",
      ensureUniquePreferenceFileNameSuffix(normalizedPreference, fileName, attempt),
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

  throw new Error(`Failed to allocate a unique preference file name for "${normalizedPreference.target}".`);
}

export async function loadAllPreferences(projectRoot: string): Promise<Preference[]> {
  const records = await loadStoredPreferenceRecords(projectRoot);
  return records.map((entry) => entry.preference).sort((left, right) => right.created_at.localeCompare(left.created_at));
}

export async function loadStoredPreferenceRecords(projectRoot: string): Promise<StoredPreferenceRecord[]> {
  const brainDir = getBrainDir(projectRoot);
  const directory = path.join(brainDir, "preferences");

  try {
    const files = await readdir(directory, { withFileTypes: true });
    const markdownFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));

    const loaded = await Promise.all(
      markdownFiles.map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const content = await readFile(filePath, "utf8");
        const preference = parsePreference(content, filePath);
        const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
        return { filePath, relativePath, preference };
      }),
    );

    return loaded.sort((left, right) => right.preference.updated_at.localeCompare(left.preference.updated_at));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

export async function overwriteStoredPreference(record: StoredPreferenceRecord): Promise<void> {
  const normalized = normalizePreference(record.preference);
  validatePreference(normalized);
  await writeFile(record.filePath, serializePreference(normalized), "utf8");
}

export function normalizePreference(pref: Preference): Preference {
  const updated_at = pref.updated_at || pref.created_at || new Date().toISOString();
  const created_at = pref.created_at || new Date().toISOString();
  const observed_at =
    normalizeOptionalTemporalBoundary(pref.observed_at) ?? updated_at;
  return {
    ...pref,
    confidence: clampUnitInterval(pref.confidence ?? 0.5),
    source: pref.source ?? "manual",
    status: pref.status ?? "active",
    created_at,
    updated_at,
    task_hints: normalizeStringArray(pref.task_hints ?? []),
    path_hints: normalizePathArray(pref.path_hints ?? []),
    review_state: (pref.review_state ?? DEFAULT_REVIEW_STATE) as ReviewState,
    observed_at,
    supersession_reason: pref.supersession_reason ?? null,
    ...(pref.source_episode?.trim() ? { source_episode: pref.source_episode.trim() } : {}),
  };
}

export function validatePreference(pref: Preference, context = "Preference"): void {
  if (!PREFERENCE_KINDS.includes(pref.kind)) {
    throw new Error(`${context} has unsupported kind "${pref.kind}".`);
  }
  if (!PREFERENCE_TARGET_TYPES.includes(pref.target_type)) {
    throw new Error(`${context} has unsupported target_type "${pref.target_type}".`);
  }
  if (!PREFERENCE_VALUES.includes(pref.preference)) {
    throw new Error(`${context} has unsupported preference value "${pref.preference}".`);
  }
  if (!MEMORY_STATUSES.includes(pref.status)) {
    throw new Error(`${context} has unsupported status "${pref.status}".`);
  }
  if (!pref.target.trim()) {
    throw new Error(`${context} requires a non-empty target.`);
  }
  if (!pref.reason.trim()) {
    throw new Error(`${context} requires a non-empty reason.`);
  }
  if (!Number.isFinite(pref.confidence) || pref.confidence < 0 || pref.confidence > 1) {
    throw new Error(`${context} has invalid confidence "${pref.confidence}". Expected a number between 0 and 1.`);
  }
  validateOptionalTemporalIso(pref.valid_from, "valid_from", context);
  validateOptionalTemporalIso(pref.valid_until, "valid_until", context);
  validateOptionalTemporalIso(pref.observed_at, "observed_at", context);
  if (pref.supersession_reason !== undefined && pref.supersession_reason !== null) {
    if (typeof pref.supersession_reason !== "string") {
      throw new Error(`${context} has invalid supersession_reason.`);
    }
  }
  if (pref.review_state !== undefined && !REVIEW_STATES.includes(pref.review_state)) {
    throw new Error(
      `${context} has unsupported review_state "${pref.review_state}". Expected one of: ${REVIEW_STATES.join(", ")}.`,
    );
  }
}

export function serializePreference(pref: Preference): string {
  const normalized = normalizePreference(pref);
  const lines = [
    "---",
    `kind: ${quoteYaml(normalized.kind)}`,
    `target_type: ${quoteYaml(normalized.target_type)}`,
    `target: ${quoteYaml(normalized.target)}`,
    `preference: ${quoteYaml(normalized.preference)}`,
    `confidence: ${normalized.confidence}`,
    `source: ${quoteYaml(normalized.source)}`,
    `created_at: ${quoteYaml(normalized.created_at)}`,
    `updated_at: ${quoteYaml(normalized.updated_at)}`,
    `status: ${quoteYaml(normalized.status)}`,
  ];

  if (normalized.valid_from) lines.push(`valid_from: ${quoteYaml(normalized.valid_from)}`);
  if (normalized.valid_until) lines.push(`valid_until: ${quoteYaml(normalized.valid_until)}`);
  if (normalized.superseded_by) lines.push(`superseded_by: ${quoteYaml(normalized.superseded_by)}`);
  lines.push(`observed_at: ${quoteYaml(normalized.observed_at ?? normalized.updated_at)}`);
  if (normalized.supersession_reason) {
    lines.push(`supersession_reason: ${quoteYaml(normalized.supersession_reason)}`);
  }
  if ((normalized.review_state ?? DEFAULT_REVIEW_STATE) !== DEFAULT_REVIEW_STATE) {
    lines.push(`review_state: ${quoteYaml(normalized.review_state ?? DEFAULT_REVIEW_STATE)}`);
  }
  if (normalized.source_episode) {
    lines.push(`source_episode: ${quoteYaml(normalized.source_episode)}`);
  }

  appendArrayField(lines, "task_hints", normalized.task_hints ?? []);
  appendArrayField(lines, "path_hints", normalized.path_hints ?? []);

  lines.push("---", "", normalized.reason.trim(), "");
  return lines.join("\n");
}

export function parsePreference(content: string, filePath: string): Preference {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Preference file "${filePath}" is missing valid frontmatter.`);
  }

  const rawFrontmatter = match[1];
  const rawReason = match[2];
  if (rawFrontmatter === undefined || rawReason === undefined) {
     throw new Error(`Preference file "${filePath}" has invalid structure.`);
  }
  const frontmatter = parseFrontmatter(rawFrontmatter);

  if (!frontmatter.kind || !frontmatter.target_type || !frontmatter.target || !frontmatter.preference) {
    throw new Error(`Preference file "${filePath}" is missing required fields.`);
  }

  const prefInput: Preference = {
    kind: frontmatter.kind as any,
    target_type: frontmatter.target_type as any,
    target: frontmatter.target as string,
    preference: frontmatter.preference as any,
    reason: (rawReason ?? "").trim(),
    confidence: frontmatter.confidence ?? 0.5,
    source: frontmatter.source ?? "manual",
    created_at: frontmatter.created_at ?? new Date().toISOString(),
    updated_at: frontmatter.updated_at ?? frontmatter.created_at ?? new Date().toISOString(),
    status: (frontmatter.status as any) ?? "active",
  };

  if (frontmatter.valid_from) prefInput.valid_from = frontmatter.valid_from;
  if (frontmatter.valid_until) prefInput.valid_until = frontmatter.valid_until;
  if (frontmatter.superseded_by) prefInput.superseded_by = frontmatter.superseded_by;
  if (frontmatter.observed_at) prefInput.observed_at = frontmatter.observed_at;
  if (frontmatter.supersession_reason !== undefined && frontmatter.supersession_reason !== null) {
    prefInput.supersession_reason = frontmatter.supersession_reason;
  }
  if (frontmatter.source_episode) prefInput.source_episode = frontmatter.source_episode;
  if (frontmatter.review_state) prefInput.review_state = frontmatter.review_state as ReviewState;
  if (frontmatter.task_hints && frontmatter.task_hints.length > 0) {
    prefInput.task_hints = frontmatter.task_hints;
  }
  if (frontmatter.path_hints && frontmatter.path_hints.length > 0) {
    prefInput.path_hints = frontmatter.path_hints;
  }

  return normalizePreference(prefInput);
}

function ensureUniquePreferenceFileNameSuffix(pref: Preference, fileName: string, attempt: number = 0): string {
  const extension = path.extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const parts = [baseName];

  if (attempt > 0) {
    parts.push(String(attempt + 1));
  }

  return `${parts.join("-")}${extension}`;
}

async function touchFile(filePath: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}
