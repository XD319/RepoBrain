import {
  loadAllPreferences,
  loadStoredPreferenceRecords,
  normalizePreference,
  overwriteStoredPreference,
} from "../../store.js";
import type { Preference } from "../../types.js";

export interface ActivePreferenceItemViewModel {
  preference: Preference["preference"];
  targetType: Preference["target_type"];
  target: string;
  reason: string;
  confidence: number;
  source: string;
  updatedAt: string;
  validUntil?: string;
  reviewState?: Preference["review_state"];
}

export interface ActivePreferenceListViewModel {
  active: ActivePreferenceItemViewModel[];
}

export async function buildActivePreferenceListViewModel(projectRoot: string): Promise<ActivePreferenceListViewModel> {
  const preferences = await loadAllPreferences(projectRoot);
  return createActivePreferenceListViewModel(preferences);
}

export function createActivePreferenceListViewModel(preferences: Preference[]): ActivePreferenceListViewModel {
  return {
    active: preferences
      .filter((entry) => entry.status === "active")
      .map((entry) => ({
        preference: entry.preference,
        targetType: entry.target_type,
        target: entry.target,
        reason: entry.reason,
        confidence: entry.confidence,
        source: entry.source,
        updatedAt: entry.updated_at,
        ...(entry.valid_until ? { validUntil: entry.valid_until } : {}),
        ...(entry.review_state ? { reviewState: entry.review_state } : {}),
      })),
  };
}

export async function dismissPreferenceByTarget(projectRoot: string, target: string): Promise<number> {
  const nowIso = new Date().toISOString();
  let count = 0;
  const records = await loadStoredPreferenceRecords(projectRoot);
  for (const record of records) {
    if (record.preference.target === target.trim() && record.preference.status === "active") {
      await overwriteStoredPreference({
        ...record,
        preference: normalizePreference({
          ...record.preference,
          status: "stale",
          updated_at: nowIso,
          valid_until: record.preference.valid_until ?? nowIso,
          supersession_reason: record.preference.supersession_reason ?? "Dismissed via brain dismiss-preference",
        }),
      });
      count += 1;
    }
  }
  return count;
}
