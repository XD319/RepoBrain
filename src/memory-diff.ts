import path from "node:path";

import { BrainUserError } from "./errors.js";
import { loadActivityState, loadStoredMemoryRecords } from "./store.js";
import type { StoredMemoryRecord } from "./types.js";

export interface MemoryDiffResult {
  since: string;
  until: string;
  added: StoredMemoryRecord[];
  modified: StoredMemoryRecord[];
  expired: StoredMemoryRecord[];
  promoted: StoredMemoryRecord[];
}

export async function buildMemoryDiff(
  projectRoot: string,
  options: { since?: string; sinceDays?: number } = {},
): Promise<MemoryDiffResult> {
  if (options.since && options.sinceDays !== undefined) {
    throw new BrainUserError('Use either "--since" or "--since-days", not both.');
  }

  const untilDate = new Date();
  const since = await resolveSince(projectRoot, options, untilDate);
  const until = untilDate.toISOString();
  const records = await loadStoredMemoryRecords(projectRoot);

  const promoted: StoredMemoryRecord[] = [];
  const expired: StoredMemoryRecord[] = [];
  const added: StoredMemoryRecord[] = [];
  const modified: StoredMemoryRecord[] = [];

  for (const record of records) {
    if (isPromotedRecord(record, since, untilDate)) {
      promoted.push(record);
      continue;
    }

    if (isExpiredRecord(record, since, untilDate)) {
      expired.push(record);
      continue;
    }

    if (isAddedRecord(record, since, untilDate)) {
      added.push(record);
      continue;
    }

    if (isModifiedRecord(record, since, untilDate)) {
      modified.push(record);
    }
  }

  return {
    since: since.toISOString(),
    until,
    added: sortRecordsByWindowTime(added),
    modified: sortRecordsByWindowTime(modified),
    expired: sortRecordsByWindowTime(expired),
    promoted: sortRecordsByWindowTime(promoted),
  };
}

export function renderMemoryDiff(result: MemoryDiffResult): string {
  const totalChanges = result.added.length + result.modified.length + result.expired.length + result.promoted.length;
  const lines = [
    "# Memory Diff",
    "",
    `Window: ${result.since} -> ${result.until}`,
    `Changes: ${totalChanges}`,
    "",
    ...renderSection("Promoted", result.promoted),
    "",
    ...renderSection("Added", result.added),
    "",
    ...renderSection("Modified", result.modified),
    "",
    ...renderSection("Expired", result.expired),
  ];

  return lines.join("\n").trimEnd();
}

export function renderMemoryDiffJson(result: MemoryDiffResult): string {
  return JSON.stringify(result, null, 2);
}

async function resolveSince(
  projectRoot: string,
  options: { since?: string; sinceDays?: number },
  untilDate: Date,
): Promise<Date> {
  if (options.since) {
    return parseSinceDate(options.since, "--since");
  }

  if (options.sinceDays !== undefined) {
    if (!Number.isInteger(options.sinceDays) || options.sinceDays <= 0) {
      throw new BrainUserError('Invalid value for "--since-days". Expected a positive integer.');
    }
    return new Date(untilDate.getTime() - options.sinceDays * 24 * 60 * 60 * 1000);
  }

  const activity = await loadActivityState(projectRoot);
  if (activity.lastContextLoadedAt) {
    return parseSinceDate(activity.lastContextLoadedAt, "activity.lastContextLoadedAt");
  }

  return new Date(0);
}

function parseSinceDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BrainUserError(`Invalid value for "${label}": "${value}". Expected an ISO date or datetime.`);
  }
  return parsed;
}

function isAddedRecord(record: StoredMemoryRecord, since: Date, until: Date): boolean {
  const createdAt = toDate(record.memory.created_at);
  if (!createdAt) return false;
  return isWithinWindow(createdAt, since, until);
}

function isModifiedRecord(record: StoredMemoryRecord, since: Date, until: Date): boolean {
  const createdAt = toDate(record.memory.created_at);
  const updatedAt = getUpdatedAt(record);
  if (!createdAt || !updatedAt) return false;
  if (createdAt >= since) return false;
  return isWithinWindow(updatedAt, since, until);
}

function isExpiredRecord(record: StoredMemoryRecord, since: Date, until: Date): boolean {
  const status = record.memory.status ?? "active";
  if (status !== "stale" && status !== "superseded") return false;
  const expiredAt = getExpirationAt(record);
  if (!expiredAt) return false;
  return isWithinWindow(expiredAt, since, until);
}

function isPromotedRecord(record: StoredMemoryRecord, since: Date, until: Date): boolean {
  const status = record.memory.status ?? "active";
  if (status !== "active") return false;
  const createdAt = toDate(record.memory.created_at);
  if (!createdAt || !isWithinWindow(createdAt, since, until)) return false;

  // Promotion rewrites the existing candidate file in place, so we infer it from
  // review lifecycle metadata and fall back to path hints for older records.
  if (record.memory.review_state === "cleared") return true;

  const normalizedPath = normalizePath(record.relativePath);
  return normalizedPath.includes("/candidate-") || normalizedPath.includes("/candidates/");
}

function getUpdatedAt(record: StoredMemoryRecord): Date | null {
  return toDate(record.memory.updated ?? record.memory.date);
}

function getExpirationAt(record: StoredMemoryRecord): Date | null {
  return toDate(record.memory.valid_until ?? record.memory.updated ?? record.memory.date);
}

function toDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (dateOnly && !Number.isNaN(dateOnly.getTime())) return dateOnly;
  return null;
}

function isWithinWindow(value: Date, since: Date, until: Date): boolean {
  return value >= since && value <= until;
}

function sortRecordsByWindowTime(records: StoredMemoryRecord[]): StoredMemoryRecord[] {
  return [...records].sort((left, right) => {
    const leftTime = getSortTime(left);
    const rightTime = getSortTime(right);
    return rightTime.localeCompare(leftTime);
  });
}

function getSortTime(record: StoredMemoryRecord): string {
  return record.memory.valid_until ?? record.memory.updated ?? record.memory.created_at ?? record.memory.date;
}

function renderSection(title: string, records: StoredMemoryRecord[]): string[] {
  const lines = [`## ${title} (${records.length})`, ""];
  if (records.length === 0) {
    lines.push("_None._");
    return lines;
  }

  for (const record of records) {
    lines.push(`- ${formatRecordLine(record)}`);
  }
  return lines;
}

function formatRecordLine(record: StoredMemoryRecord): string {
  const memoryId = path.basename(record.filePath, ".md");
  const status = record.memory.status ?? "active";
  const updated = record.memory.updated ?? "n/a";
  const createdAt = record.memory.created_at;
  return `\`${memoryId}\` | ${record.memory.type} | ${record.memory.title} | status=${status} | created_at=${createdAt} | updated=${updated} | path=${normalizePath(record.relativePath)}`;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
