import type { Memory } from "./types.js";

export function buildMemoryIdentity(memory: Pick<Memory, "type" | "title" | "path_scope">): string {
  return `${memory.type}:${buildScopeIdentity(memory.path_scope ?? [])}:${slugifyMemoryTitle(memory.title)}`;
}

export function slugifyMemoryTitle(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "memory";
}

export function buildScopeIdentity(pathScope: string[]): string {
  const normalized = normalizeScopeEntries(pathScope);
  return normalized.length > 0 ? normalized.join("|") : "global";
}

export function scopesOverlap(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeScopeEntries(left);
  const normalizedRight = normalizeScopeEntries(right);

  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return normalizedLeft.length === 0 && normalizedRight.length === 0;
  }

  return normalizedLeft.some((leftEntry) =>
    normalizedRight.some((rightEntry) => entriesOverlap(leftEntry, rightEntry)),
  );
}

export function normalizeTextForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScopeEntries(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeScopeEntry(value)).filter(Boolean))).sort();
}

function normalizeScopeEntry(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/\*\*?$/u, "")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

function entriesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
