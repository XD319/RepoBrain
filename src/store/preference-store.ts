import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { getBrainDir } from "../config.js";
import { slugifyMemoryTitle } from "../memory-identity.js";
import type { Preference, ReviewState, StoredPreferenceRecord } from "../types.js";
import { initBrain } from "./core.js";
import { extractFrontmatterAndBody, parseFrontmatter } from "./serialize.js";
import { DEFAULT_REVIEW_STATE, normalizePreference, validatePreference } from "./validate.js";

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
      if (isFileAlreadyExistsError(error)) continue;
      throw error;
    }
  }
  throw new Error(`Failed to allocate a unique preference file name for "${normalizedPreference.target}".`);
}

export async function loadAllPreferences(projectRoot: string): Promise<Preference[]> {
  const records = await loadStoredPreferenceRecords(projectRoot);
  return records
    .map((entry) => entry.preference)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
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
    if (isMissingDirectoryError(error)) return [];
    throw error;
  }
}

export async function overwriteStoredPreference(record: StoredPreferenceRecord): Promise<void> {
  const normalized = normalizePreference(record.preference);
  validatePreference(normalized);
  await writeFile(record.filePath, serializePreference(normalized), "utf8");
}

export function serializePreference(pref: Preference): string {
  const normalized = normalizePreference(pref);
  const frontmatter: Record<string, unknown> = {
    kind: normalized.kind,
    target_type: normalized.target_type,
    target: normalized.target,
    preference: normalized.preference,
    confidence: normalized.confidence,
    source: normalized.source,
    created_at: normalized.created_at,
    updated_at: normalized.updated_at,
    status: normalized.status,
  };
  if (normalized.valid_from) frontmatter.valid_from = normalized.valid_from;
  if (normalized.valid_until) frontmatter.valid_until = normalized.valid_until;
  if (normalized.superseded_by) frontmatter.superseded_by = normalized.superseded_by;
  frontmatter.observed_at = normalized.observed_at ?? normalized.updated_at;
  if (normalized.supersession_reason) frontmatter.supersession_reason = normalized.supersession_reason;
  if ((normalized.review_state ?? DEFAULT_REVIEW_STATE) !== DEFAULT_REVIEW_STATE) {
    frontmatter.review_state = normalized.review_state ?? DEFAULT_REVIEW_STATE;
  }
  if (normalized.source_episode) frontmatter.source_episode = normalized.source_episode;
  frontmatter.task_hints = normalized.task_hints ?? [];
  frontmatter.path_hints = normalized.path_hints ?? [];
  return ["---", stringifyFrontmatter(frontmatter), "---", "", normalized.reason.trim(), ""].join("\n");
}

export function parsePreference(content: string, filePath: string): Preference {
  const extracted = extractFrontmatterAndBody(content);
  if (!extracted) {
    throw new Error(`Preference file "${filePath}" is missing valid frontmatter.`);
  }
  const { rawFrontmatter, body: rawReason } = extracted;
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
  if (frontmatter.task_hints && frontmatter.task_hints.length > 0) prefInput.task_hints = frontmatter.task_hints;
  if (frontmatter.path_hints && frontmatter.path_hints.length > 0) prefInput.path_hints = frontmatter.path_hints;
  return normalizePreference(prefInput);
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
  return stringifyYaml(frontmatter, {
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
    lineWidth: 0,
  }).trimEnd();
}

function ensureUniquePreferenceFileNameSuffix(_pref: Preference, fileName: string, attempt = 0): string {
  const extension = path.extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const parts = [baseName];
  if (attempt > 0) parts.push(String(attempt + 1));
  return `${parts.join("-")}${extension}`;
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "EEXIST";
}

function isMissingDirectoryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && error.code === "ENOENT";
}
