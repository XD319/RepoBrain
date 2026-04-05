import path from "node:path";

import {
  loadStoredMemoryRecords,
  loadStoredPreferenceRecords,
  normalizeBrainRelativePath,
} from "./store.js";
import { describeMemoryTemporalBlock, describePreferenceTemporalBlock } from "./temporal.js";
import type { Memory, Preference, StoredMemoryRecord, StoredPreferenceRecord } from "./types.js";

function brainRel(relativePath: string): string {
  return normalizeBrainRelativePath(relativePath.replace(/\\/g, "/"));
}

function findMemoryRecordByBrainPath(
  records: StoredMemoryRecord[],
  brainPath: string,
): StoredMemoryRecord | undefined {
  const target = normalizeBrainRelativePath(brainPath);
  return records.find((r) => brainRel(r.relativePath) === target);
}

/** Match `id` to a memory file: basename, `.brain/...` path, or title slug substring. */
export function resolveMemoryRecordById(
  _projectRoot: string,
  id: string,
  records: StoredMemoryRecord[],
): StoredMemoryRecord | null {
  const raw = id.trim();
  if (!raw) {
    return null;
  }
  const base = path.basename(raw, ".md");
  const lower = raw.toLowerCase();

  const direct =
    records.find((r) => brainRel(r.relativePath) === normalizeBrainRelativePath(raw)) ??
    records.find((r) => path.basename(r.filePath, ".md") === base) ??
    records.find((r) => r.relativePath.replace(/\\/g, "/").toLowerCase().includes(lower));

  return direct ?? null;
}

export function resolvePreferenceRecordById(
  projectRoot: string,
  id: string,
  records: StoredPreferenceRecord[],
): StoredPreferenceRecord | null {
  const raw = id.trim();
  if (!raw) {
    return null;
  }
  const base = path.basename(raw, ".md");
  const lower = raw.toLowerCase();

  return (
    records.find((r) => brainRel(r.relativePath) === normalizeBrainRelativePath(raw)) ??
    records.find((r) => path.basename(r.filePath, ".md") === base) ??
    records.find((r) => r.relativePath.replace(/\\/g, "/").toLowerCase().includes(lower)) ??
    null
  );
}

/**
 * Linear evolution order: oldest → newest using `supersedes` / inverse links.
 */
export function buildMemoryEvolutionChain(
  records: StoredMemoryRecord[],
  start: StoredMemoryRecord,
): StoredMemoryRecord[] {
  const olderFirst: StoredMemoryRecord[] = [];
  let cur: StoredMemoryRecord | undefined = start;
  const seen = new Set<string>();

  while (cur && !seen.has(cur.filePath)) {
    seen.add(cur.filePath);
    olderFirst.unshift(cur);
    const sup = cur.memory.supersedes;
    if (!sup) {
      break;
    }
    cur = findMemoryRecordByBrainPath(records, sup);
  }

  const chain = [...olderFirst];
  cur = start;
  while (cur) {
    const next = records.find(
      (r) =>
        !seen.has(r.filePath) &&
        r.memory.supersedes &&
        normalizeBrainRelativePath(r.memory.supersedes) === brainRel(cur!.relativePath),
    );
    if (!next) {
      break;
    }
    seen.add(next.filePath);
    chain.push(next);
    cur = next;
  }

  return chain;
}

export function renderMemoryTimeline(records: StoredMemoryRecord[], focus: StoredMemoryRecord | null): string {
  const lines: string[] = ["# Memory timeline (supersession order)", ""];
  if (focus) {
    const chain = buildMemoryEvolutionChain(records, focus);
    lines.push(`## Evolution chain (${chain.length} step(s))`, "");
    for (let i = 0; i < chain.length; i += 1) {
      const r = chain[i]!;
      lines.push(
        `${i + 1}. ${brainRel(r.relativePath)} | v${r.memory.version ?? 1} | ${r.memory.title} | status=${r.memory.status ?? "active"}`,
      );
      if (r.memory.valid_from || r.memory.valid_until) {
        lines.push(`   valid_from=${r.memory.valid_from ?? "—"} valid_until=${r.memory.valid_until ?? "—"}`);
      }
      if (r.memory.supersession_reason) {
        lines.push(`   supersession_reason: ${r.memory.supersession_reason}`);
      }
      if (r.memory.supersedes) {
        lines.push(`   supersedes: ${r.memory.supersedes}`);
      }
      if (r.memory.superseded_by) {
        lines.push(`   superseded_by: ${r.memory.superseded_by}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  const sorted = [...records].sort((a, b) => a.memory.date.localeCompare(b.memory.date));
  lines.push("## All memories (by `date`, oldest first)", "");
  for (const r of sorted) {
    const vf = r.memory.valid_from ? ` from=${r.memory.valid_from}` : "";
    const vu = r.memory.valid_until ? ` until=${r.memory.valid_until}` : "";
    lines.push(
      `- ${brainRel(r.relativePath)} | ${r.memory.type} | ${r.memory.title}${vf}${vu} | status=${r.memory.status ?? "active"}`,
    );
  }
  return lines.join("\n");
}

export function renderPreferenceTimeline(
  records: StoredPreferenceRecord[],
  focus: StoredPreferenceRecord | null,
): string {
  const lines: string[] = ["# Preference timeline", ""];
  const sorted = [...records].sort((a, b) => a.preference.created_at.localeCompare(b.preference.created_at));

  if (focus) {
    const sameTarget = sorted.filter((r) => r.preference.target === focus.preference.target);
    lines.push(`## Entries for target "${focus.preference.target}" (${sameTarget.length})`, "");
    for (const r of sameTarget) {
      const p = r.preference;
      lines.push(`- ${brainRel(r.relativePath)}`);
      lines.push(
        `  status=${p.status} pref=${p.preference} valid_from=${p.valid_from ?? "—"} valid_until=${p.valid_until ?? "—"}`,
      );
      if (p.superseded_by) {
        lines.push(`  superseded_by=${p.superseded_by}`);
      }
      if (p.supersession_reason) {
        lines.push(`  supersession_reason: ${p.supersession_reason}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  lines.push("## All preferences (by created_at)", "");
  for (const r of sorted) {
    const p = r.preference;
    lines.push(
      `- ${brainRel(r.relativePath)} | ${p.target} | ${p.status} | until=${p.valid_until ?? "—"}`,
    );
  }
  return lines.join("\n");
}

export function renderExplainMemory(record: StoredMemoryRecord, now: Date): string {
  const m: Memory = record.memory;
  const lines = [
    `# Explain memory`,
    "",
    `File: ${brainRel(record.relativePath)}`,
    `Title: ${m.title}`,
    `Type: ${m.type} | importance=${m.importance} | status=${m.status ?? "active"}`,
    "",
    "## Temporal fields",
    `- valid_from: ${m.valid_from ?? "—"}`,
    `- valid_until: ${m.valid_until ?? "—"}`,
    `- observed_at: ${m.observed_at ?? "—"}`,
    `- review_state: ${m.review_state ?? "unset"}`,
    `- confidence: ${m.confidence ?? 1}`,
    `- source_episode: ${m.source_episode ?? "—"}`,
    `- supersession_reason: ${m.supersession_reason ?? "—"}`,
    "",
    "## Lineage",
    `- supersedes: ${m.supersedes ?? "—"}`,
    `- superseded_by: ${m.superseded_by ?? "—"}`,
    "",
    "## Consumption (inject / suggest-skills)",
    ...describeMemoryTemporalBlock(m, now).map((l) => `- ${l}`),
    "",
  ];
  return lines.join("\n");
}

export function renderExplainPreference(record: StoredPreferenceRecord, now: Date): string {
  const p: Preference = record.preference;
  const lines = [
    `# Explain preference`,
    "",
    `File: ${brainRel(record.relativePath)}`,
    `Target: ${p.target} (${p.target_type})`,
    `Preference: ${p.preference} | status=${p.status}`,
    "",
    "## Temporal fields",
    `- valid_from: ${p.valid_from ?? "—"}`,
    `- valid_until: ${p.valid_until ?? "—"}`,
    `- observed_at: ${p.observed_at ?? "—"}`,
    `- review_state: ${p.review_state ?? "unset"}`,
    `- confidence: ${p.confidence}`,
    `- source_episode: ${p.source_episode ?? "—"}`,
    `- supersession_reason: ${p.supersession_reason ?? "—"}`,
    `- superseded_by: ${p.superseded_by ?? "—"}`,
    "",
    "## Routing",
    ...describePreferenceTemporalBlock(p, now).map((l) => `- ${l}`),
    "",
  ];
  return lines.join("\n");
}

export async function loadTimelineContext(projectRoot: string): Promise<{
  memories: StoredMemoryRecord[];
  preferences: StoredPreferenceRecord[];
}> {
  const memories = await loadStoredMemoryRecords(projectRoot);
  const preferences = await loadStoredPreferenceRecords(projectRoot);
  return { memories, preferences };
}
