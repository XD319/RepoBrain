import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { getBrainDir } from "./config.js";
import { preferenceMatchesTaskAndPaths } from "./routing-inputs.js";
import type { ApplicablePreference } from "./routing-inputs.js";
import type { Preference, PreferenceValue } from "./types.js";

export const SESSION_PROFILE_VERSION = 1 as const;
export const SESSION_PROFILE_FILENAME = "session-profile.json";

export interface SessionSkillRoutingEntry {
  skill: string;
  preference: PreferenceValue;
  reason?: string;
}

/** Local-only session state under `.brain/runtime/` (not durable knowledge). */
export interface SessionProfile {
  version: typeof SESSION_PROFILE_VERSION;
  updated_at: string;
  /** Free-form lines for inject; marked as session-scoped in output. */
  hints: string[];
  /** Structured skill signals; applied after stored preferences, before static soft recommendations tie-break. */
  skill_routing?: SessionSkillRoutingEntry[];
  workflow_flags?: {
    minimal_change?: boolean;
    skip_full_tests?: boolean;
    no_schema_changes?: boolean;
    light_debug?: boolean;
  };
}

export function getRuntimeDir(projectRoot: string): string {
  return path.join(getBrainDir(projectRoot), "runtime");
}

export function getSessionProfilePath(projectRoot: string): string {
  return path.join(getRuntimeDir(projectRoot), SESSION_PROFILE_FILENAME);
}

export function defaultSessionProfile(): SessionProfile {
  const now = new Date().toISOString();
  return {
    version: SESSION_PROFILE_VERSION,
    updated_at: now,
    hints: [],
  };
}

export function parseSessionProfileJson(raw: string): SessionProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Session profile file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Session profile must be a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  const version = obj.version;
  if (version !== SESSION_PROFILE_VERSION) {
    throw new Error(
      `Unsupported session profile version ${String(version)}. Expected ${SESSION_PROFILE_VERSION}.`,
    );
  }
  const hints = obj.hints;
  if (!Array.isArray(hints) || hints.some((h) => typeof h !== "string")) {
    throw new Error('Session profile "hints" must be an array of strings.');
  }
  const skill_routing = obj.skill_routing;
  const normalizedRouting: SessionSkillRoutingEntry[] | undefined = Array.isArray(skill_routing)
    ? skill_routing.map((row, index) => {
        if (!row || typeof row !== "object") {
          throw new Error(`session profile skill_routing[${index}] must be an object.`);
        }
        const r = row as Record<string, unknown>;
        const skill = typeof r.skill === "string" ? r.skill.trim() : "";
        const pref = r.preference;
        if (!skill) {
          throw new Error(`session profile skill_routing[${index}].skill must be a non-empty string.`);
        }
        if (pref !== "prefer" && pref !== "avoid" && pref !== "require_review") {
          throw new Error(
            `session profile skill_routing[${index}].preference must be prefer | avoid | require_review.`,
          );
        }
        const reason = r.reason === undefined ? undefined : String(r.reason);
        return {
          skill,
          preference: pref,
          ...(reason !== undefined && reason.length > 0 ? { reason } : {}),
        };
      })
    : undefined;

  const wf = obj.workflow_flags;
  let workflow_flags: SessionProfile["workflow_flags"] | undefined;
  if (wf !== undefined) {
    if (!wf || typeof wf !== "object") {
      throw new Error('Session profile "workflow_flags" must be an object when set.');
    }
    const w = wf as Record<string, unknown>;
    workflow_flags = {
      ...(w.minimal_change === true ? { minimal_change: true } : {}),
      ...(w.skip_full_tests === true ? { skip_full_tests: true } : {}),
      ...(w.no_schema_changes === true ? { no_schema_changes: true } : {}),
      ...(w.light_debug === true ? { light_debug: true } : {}),
    };
    if (Object.keys(workflow_flags).length === 0) {
      workflow_flags = undefined;
    }
  }

  return {
    version: SESSION_PROFILE_VERSION,
    updated_at: typeof obj.updated_at === "string" ? obj.updated_at : new Date().toISOString(),
    hints: hints.map((h) => h.trim()).filter(Boolean),
    ...(normalizedRouting && normalizedRouting.length > 0 ? { skill_routing: normalizedRouting } : {}),
    ...(workflow_flags ? { workflow_flags } : {}),
  };
}

export async function loadSessionProfile(projectRoot: string): Promise<SessionProfile | null> {
  try {
    const raw = await readFile(getSessionProfilePath(projectRoot), "utf8");
    return parseSessionProfileJson(raw);
  } catch {
    return null;
  }
}

export async function saveSessionProfile(projectRoot: string, profile: SessionProfile): Promise<void> {
  await mkdir(getRuntimeDir(projectRoot), { recursive: true });
  const body = {
    ...profile,
    updated_at: new Date().toISOString(),
  };
  await writeFile(getSessionProfilePath(projectRoot), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

export async function clearSessionProfile(projectRoot: string): Promise<boolean> {
  try {
    await rm(getSessionProfilePath(projectRoot), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Ensure `.brain/runtime/` exists and `.brain/.gitignore` ignores `runtime/`. */
export async function ensureSessionRuntimeLayout(projectRoot: string): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  const runtimeDir = getRuntimeDir(projectRoot);
  await mkdir(runtimeDir, { recursive: true });

  const gitignorePath = path.join(brainDir, ".gitignore");
  const line = "runtime/";
  try {
    const existing = await readFile(gitignorePath, "utf8");
    if (existing.split(/\r?\n/).some((l) => l.trim() === line)) {
      return;
    }
    const suffix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
    await writeFile(
      gitignorePath,
      `${existing}${suffix}# Local-only session/runtime state (not shared via git)\n${line}\n`,
      "utf8",
    );
  } catch {
    await writeFile(
      gitignorePath,
      ["# Local-only session/runtime state (not shared via git)", line, ""].join("\n"),
      "utf8",
    );
  }
}

function syntheticPreferenceFromSessionRow(
  row: SessionSkillRoutingEntry,
  profileUpdatedAt: string,
): Preference {
  const now = new Date().toISOString();
  return {
    kind: "routing_preference",
    target_type: "skill",
    target: row.skill.trim(),
    preference: row.preference,
    reason: row.reason ?? "session profile routing",
    confidence: 0.9,
    source: "session-profile",
    created_at: profileUpdatedAt || now,
    updated_at: profileUpdatedAt || now,
    status: "active",
  };
}

/**
 * Session skill routing uses the same task/path hint rules as stored preferences when hints are empty (global).
 */
export function buildApplicableSessionPreferences(
  profile: SessionProfile,
  task: string | undefined,
  paths: string[],
): ApplicablePreference[] {
  const rows = profile.skill_routing ?? [];
  const applicable: ApplicablePreference[] = [];
  for (const row of rows) {
    const preference = syntheticPreferenceFromSessionRow(row, profile.updated_at);
    const { ok, reasons } = preferenceMatchesTaskAndPaths(preference, task, paths);
    if (ok) {
      applicable.push({ preference, match_reasons: reasons });
    }
  }
  return applicable;
}

const WORKFLOW_HINTS: Record<
  keyof NonNullable<SessionProfile["workflow_flags"]>,
  string
> = {
  minimal_change: "[workflow] Prefer minimal changes for this session.",
  skip_full_tests: "[workflow] Skip full test suite this session unless needed for the touched code.",
  no_schema_changes: "[workflow] Avoid schema / migration changes in this session unless unavoidable.",
  light_debug: "[workflow] Prefer a lightweight debugging path this session.",
};

export function applyWorkflowFlagHints(profile: SessionProfile): SessionProfile {
  const flags = profile.workflow_flags;
  if (!flags) {
    return profile;
  }
  const extra: string[] = [];
  (Object.keys(flags) as (keyof typeof flags)[]).forEach((key) => {
    if (flags[key] && WORKFLOW_HINTS[key]) {
      extra.push(WORKFLOW_HINTS[key]);
    }
  });
  if (extra.length === 0) {
    return profile;
  }
  const merged = mergeHints(profile.hints, extra, "append");
  return { ...profile, hints: merged };
}

export function mergeHints(
  existing: string[],
  incoming: string[],
  mode: "append" | "replace",
): string[] {
  const inc = incoming.map((s) => s.trim()).filter(Boolean);
  if (mode === "replace") {
    return inc;
  }
  const seen = new Set(existing.map((s) => s.trim()));
  const out = [...existing];
  for (const line of inc) {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

export function upsertSkillRouting(
  profile: SessionProfile,
  skill: string,
  preference: PreferenceValue,
  reason?: string,
): SessionProfile {
  const skill_routing = [...(profile.skill_routing ?? [])];
  const idx = skill_routing.findIndex((r) => r.skill === skill.trim());
  const entry: SessionSkillRoutingEntry = {
    skill: skill.trim(),
    preference,
    ...(reason ? { reason } : {}),
  };
  if (idx >= 0) {
    skill_routing[idx] = entry;
  } else {
    skill_routing.push(entry);
  }
  return { ...profile, skill_routing };
}

export function renderSessionProfileInjectSection(profile: SessionProfile): string {
  const p = applyWorkflowFlagHints(profile);
  const lines: string[] = [
    "## Session profile (this session only)",
    "",
    "_These lines are **not** durable repo knowledge. They are local hints under `.brain/runtime/`. " +
      "They override ordinary routing preferences for this session but **do not** override blocked or " +
      "explicit suppressions from durable memories._",
    "",
  ];

  if (p.hints.length === 0 && !(p.skill_routing && p.skill_routing.length)) {
    lines.push("_No active session hints._", "");
  } else {
    for (const h of p.hints) {
      lines.push(`- ${h}`);
    }
    if (p.skill_routing && p.skill_routing.length > 0) {
      lines.push("");
      lines.push("Structured session routing (skill targets):");
      for (const r of p.skill_routing) {
        lines.push(`- ${r.skill}: ${r.preference}${r.reason ? ` — ${r.reason}` : ""}`);
      }
    }
    lines.push("");
  }

  lines.push(`_Source: \`.brain/runtime/${SESSION_PROFILE_FILENAME}\` (session scope)_`, "");
  return lines.join("\n");
}

export function sessionProfileHasVisibleContent(profile: SessionProfile): boolean {
  if ((profile.skill_routing?.length ?? 0) > 0) {
    return true;
  }
  if (profile.hints.length > 0) {
    return true;
  }
  const f = profile.workflow_flags;
  if (!f) {
    return false;
  }
  return Boolean(f.minimal_change || f.skip_full_tests || f.no_schema_changes || f.light_debug);
}

export function combinedPromoteText(profile: SessionProfile, override?: string): string {
  if (override?.trim()) {
    return override.trim();
  }
  const p = applyWorkflowFlagHints(profile);
  const parts: string[] = [...p.hints];
  if (p.skill_routing) {
    for (const r of p.skill_routing) {
      parts.push(`${r.preference} skill ${r.skill}${r.reason ? `: ${r.reason}` : ""}`);
    }
  }
  return parts.join("\n").trim();
}
