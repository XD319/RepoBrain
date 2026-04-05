import { execSync } from "node:child_process";

import { matchPathPatterns, matchTaskTriggers } from "./memory-relevance.js";
import type { MatchedMemory } from "./skill-routing-types.js";
import { isPreferenceReviewEligible } from "./temporal.js";
import type { Preference } from "./types.js";

/**
 * Static declarations from durable repo memory (matched entries only).
 * Feeds score aggregates before preferences are merged.
 */
export interface StaticMemoryPolicyInput {
  readonly matched_memories: MatchedMemory[];
}

/**
 * Dynamic, user-maintained preferences (.brain/preferences/), after eligibility filtering.
 */
export interface PreferencePolicyInput {
  /** Preferences that apply to this routing invocation (active, in-window, context-matched). */
  readonly applicable: ApplicablePreference[];
  /** Inactive or out-of-scope preferences recorded for explainability only. */
  readonly skipped: SkippedPreference[];
}

export interface ApplicablePreference {
  readonly preference: Preference;
  readonly match_reasons: string[];
}

export interface SkippedPreference {
  readonly preference: Preference;
  readonly reason: string;
}

/**
 * Session / repo context signals for routing (task, paths, git, modules).
 */
export interface TaskContextInput {
  readonly task?: string;
  readonly paths: string[];
  readonly modules: string[];
  readonly branch: string | null;
}

export const ROUTING_PRIORITY_LAYERS: readonly string[] = [
  "blocked_and_explicit_suppress (memory + policy)",
  "required_skills (static memory)",
  "negative_preferences (avoid)",
  "positive_preferences (prefer)",
  "static_recommended_skills",
  "optional_fallback_and_soft_signals",
] as const;

export function buildStaticMemoryPolicyInput(matchedMemories: MatchedMemory[]): StaticMemoryPolicyInput {
  return { matched_memories: matchedMemories };
}

export function buildTaskContextInput(
  projectRoot: string,
  options: {
    task?: string;
    paths: string[];
    modules?: string[];
  },
): TaskContextInput {
  const task = options.task?.trim();
  return {
    ...(task ? { task } : {}),
    paths: options.paths,
    modules: [...(options.modules ?? [])].map((m) => m.trim()).filter(Boolean),
    branch: readGitBranch(projectRoot),
  };
}

function readGitBranch(projectRoot: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .replace(/\s+/g, " ");
  } catch {
    return null;
  }
}

export function isPreferenceEligibleForRouting(pref: Preference, now: Date): boolean {
  if (pref.status !== "active") {
    return false;
  }
  if (pref.superseded_by && pref.superseded_by.trim()) {
    return false;
  }
  if (!isPreferenceReviewEligible(pref)) {
    return false;
  }
  if (pref.valid_from) {
    const t = Date.parse(pref.valid_from);
    if (!Number.isNaN(t) && t > now.getTime()) {
      return false;
    }
  }
  if (pref.valid_until) {
    const t = Date.parse(pref.valid_until);
    if (!Number.isNaN(t) && t < now.getTime()) {
      return false;
    }
  }
  return true;
}

/**
 * When task_hints / path_hints are empty, the preference applies whenever it is eligible.
 * When hints are present, require a match on every non-empty hint dimension (task and/or path).
 */
export function preferenceMatchesTaskAndPaths(
  pref: Preference,
  task: string | undefined,
  paths: string[],
): { ok: boolean; reasons: string[] } {
  const taskHints = pref.task_hints ?? [];
  const pathHints = pref.path_hints ?? [];
  if (taskHints.length === 0 && pathHints.length === 0) {
    return { ok: true, reasons: ["no task/path hints; preference applies globally when eligible"] };
  }

  const reasons: string[] = [];
  let taskOk = true;
  let pathOk = true;

  if (taskHints.length > 0) {
    const tr = task ? matchTaskTriggers(task, taskHints, "task") : [];
    taskOk = tr.length > 0;
    reasons.push(...tr);
  }

  if (pathHints.length > 0) {
    const pr = matchPathPatterns(paths, pathHints, "path");
    pathOk = pr.length > 0;
    reasons.push(...pr);
  }

  if (taskHints.length > 0 && pathHints.length > 0) {
    return { ok: taskOk && pathOk, reasons };
  }
  if (taskHints.length > 0) {
    return { ok: taskOk, reasons };
  }
  return { ok: pathOk, reasons };
}

export function buildPreferencePolicyInput(
  allPreferences: Preference[],
  task: string | undefined,
  paths: string[],
  now: Date,
): PreferencePolicyInput {
  const applicable: ApplicablePreference[] = [];
  const skipped: SkippedPreference[] = [];

  for (const preference of allPreferences) {
    if (preference.target_type !== "skill") {
      skipped.push({
        preference,
        reason: "target_type is not skill; routing engine consumes skill preferences only",
      });
      continue;
    }

    if (!isPreferenceEligibleForRouting(preference, now)) {
      skipped.push({
        preference,
        reason: describeIneligiblePreference(preference, now),
      });
      continue;
    }

    const { ok, reasons } = preferenceMatchesTaskAndPaths(preference, task, paths);
    if (!ok) {
      skipped.push({
        preference,
        reason: "task/path hints did not match the current routing context",
      });
      continue;
    }

    applicable.push({
      preference,
      match_reasons: reasons,
    });
  }

  return { applicable, skipped };
}

function describeIneligiblePreference(pref: Preference, now: Date): string {
  if (pref.status !== "active") {
    return `status is "${pref.status}" (only active preferences participate)`;
  }
  if (pref.superseded_by?.trim()) {
    return `superseded_by is set; preference is inactive`;
  }
  if (!isPreferenceReviewEligible(pref)) {
    return `review_state is "${pref.review_state ?? "unset"}" (pending_review is excluded from routing)`;
  }
  if (pref.valid_from) {
    const t = Date.parse(pref.valid_from);
    if (!Number.isNaN(t) && t > now.getTime()) {
      return "valid_from is in the future";
    }
  }
  if (pref.valid_until) {
    const t = Date.parse(pref.valid_until);
    if (!Number.isNaN(t) && t < now.getTime()) {
      return "valid_until has passed";
    }
  }
  return "not eligible for routing";
}
