import type { Memory, MemoryStatus, Preference } from "./types.js";

function memoryStatus(memory: Memory): MemoryStatus {
  return memory.status ?? "active";
}

/** Parse an ISO date or date-time string; returns epoch ms or null if unset/invalid. */
export function parseTemporalInstant(value: string | undefined | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Date-only fields (YYYY-MM-DD) compare at end-of-day UTC for upper bounds
 * so same-day expiry still applies for that calendar day.
 */
function endOfUtcDayMs(dateOnly: string): number {
  return Date.parse(`${dateOnly.trim()}T23:59:59.999Z`);
}

function startOfUtcDayMs(dateOnly: string): number {
  return Date.parse(`${dateOnly.trim()}T00:00:00.000Z`);
}

/**
 * Inject / suggest-skills / routing: only memories that are active, not stale,
 * not superseded, within the validity window, and not pending human review.
 */
export function isMemoryCurrentlyValid(memory: Memory, now: Date): boolean {
  if (memory.superseded_by) {
    return false;
  }
  if (memory.stale) {
    return false;
  }

  const status = memoryStatus(memory);
  if (status === "superseded") {
    return false;
  }

  const review = memory.review_state ?? "unset";
  if (review === "pending_review") {
    return false;
  }

  const vf = memory.valid_from;
  if (vf) {
    const t = parseTemporalInstant(vf);
    if (t !== null && now.getTime() < t) {
      return false;
    }
    if (t === null && /^\d{4}-\d{2}-\d{2}$/.test(vf.trim())) {
      if (now.getTime() < startOfUtcDayMs(vf)) {
        return false;
      }
    }
  }

  const vu = memory.valid_until;
  if (vu) {
    const t = parseTemporalInstant(vu);
    if (t !== null && now.getTime() > t) {
      return false;
    }
    if (t === null && /^\d{4}-\d{2}-\d{2}$/.test(vu.trim())) {
      if (now.getTime() > endOfUtcDayMs(vu)) {
        return false;
      }
    }
  }

  if (memory.expires && /^\d{4}-\d{2}-\d{2}$/.test(memory.expires.trim())) {
    if (now.getTime() > endOfUtcDayMs(memory.expires)) {
      return false;
    }
  }

  return true;
}

export function describeMemoryTemporalBlock(memory: Memory, now: Date): string[] {
  const lines: string[] = [];
  if (!isMemoryCurrentlyValid(memory, now)) {
    lines.push("Current validity: not eligible for inject / routing (see reasons below).");
  } else {
    lines.push("Current validity: eligible for inject / routing (subject to status filters).");
  }

  const reasons: string[] = [];
  if (memory.superseded_by) {
    reasons.push(`superseded_by=${memory.superseded_by}`);
  }
  if (memory.stale) {
    reasons.push("stale=true");
  }
  if (memoryStatus(memory) === "superseded") {
    reasons.push('status="superseded"');
  }
  if ((memory.review_state ?? "unset") === "pending_review") {
    reasons.push('review_state="pending_review"');
  }
  const vf = memory.valid_from;
  if (vf) {
    const t = parseTemporalInstant(vf);
    if (t !== null && now.getTime() < t) {
      reasons.push("valid_from is in the future");
    }
  }
  const vu = memory.valid_until;
  if (vu) {
    const t = parseTemporalInstant(vu);
    if (t !== null && now.getTime() > t) {
      reasons.push("valid_until has passed");
    }
    if (t === null && /^\d{4}-\d{2}-\d{2}$/.test(vu.trim()) && now.getTime() > endOfUtcDayMs(vu)) {
      reasons.push("valid_until (date) has passed");
    }
  }
  if (memory.expires && /^\d{4}-\d{2}-\d{2}$/.test(memory.expires.trim())) {
    if (now.getTime() > endOfUtcDayMs(memory.expires)) {
      reasons.push("expires (date) has passed");
    }
  }

  if (reasons.length > 0) {
    lines.push(`Blockers: ${reasons.join("; ")}`);
  }

  if (memory.supersession_reason) {
    lines.push(`Supersession note: ${memory.supersession_reason}`);
  }
  return lines;
}

/** Preference routing eligibility including review_state (extends date window checks). */
export function isPreferenceReviewEligible(pref: Preference): boolean {
  const rs = pref.review_state ?? "unset";
  return rs !== "pending_review";
}

export function describePreferenceTemporalBlock(pref: Preference, now: Date): string[] {
  const lines: string[] = [];
  const eligible =
    pref.status === "active" &&
    !(pref.superseded_by && pref.superseded_by.trim()) &&
    isPreferenceReviewEligible(pref);

  let windowOk = true;
  if (pref.valid_from) {
    const t = Date.parse(pref.valid_from);
    if (!Number.isNaN(t) && t > now.getTime()) {
      windowOk = false;
    }
  }
  if (pref.valid_until) {
    const t = Date.parse(pref.valid_until);
    if (!Number.isNaN(t) && t < now.getTime()) {
      windowOk = false;
    }
  }

  if (eligible && windowOk) {
    lines.push("Current validity: eligible for routing (when skill target + hints match).");
  } else {
    lines.push("Current validity: not eligible for routing.");
  }

  if (pref.supersession_reason) {
    lines.push(`Supersession note: ${pref.supersession_reason}`);
  }
  return lines;
}
