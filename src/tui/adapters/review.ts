import { reviewCandidateMemory } from "../../reviewer.js";
import { approveCandidateMemory, loadStoredMemoryRecords, updateIndex, updateStoredMemoryStatus } from "../../store.js";
import type { StoredMemoryRecord } from "../../types.js";
import * as helpers from "../../commands/helpers.js";

export interface CandidateListItemViewModel {
  id: string;
  type: StoredMemoryRecord["memory"]["type"];
  importance: StoredMemoryRecord["memory"]["importance"];
  title: string;
}

export interface CandidateListViewModel {
  totalCandidates: number;
  safeCandidates: number;
  candidates: CandidateListItemViewModel[];
}

export interface CandidateActionResultViewModel {
  affectedCount: number;
  skippedManualReviewCount?: number;
}

export async function buildCandidateListViewModel(projectRoot: string): Promise<CandidateListViewModel> {
  const records = await loadStoredMemoryRecords(projectRoot);
  return createCandidateListViewModel(records);
}

export function createCandidateListViewModel(records: StoredMemoryRecord[]): CandidateListViewModel {
  const candidates = helpers.getCandidateRecords(records);
  const safeCandidates = candidates.filter((entry) =>
    helpers.isSafeCandidateReview(
      reviewCandidateMemory(
        entry.memory,
        records.filter((record) => record.filePath !== entry.filePath),
      ),
    ),
  );

  return {
    totalCandidates: candidates.length,
    safeCandidates: safeCandidates.length,
    candidates: candidates.map((entry) => ({
      id: helpers.getStoredMemoryId(entry),
      type: entry.memory.type,
      importance: entry.memory.importance,
      title: entry.memory.title,
    })),
  };
}

export async function approveCandidateAction(
  projectRoot: string,
  memoryId: string | undefined,
  options: { all?: boolean; safe?: boolean },
): Promise<CandidateActionResultViewModel> {
  const records = await loadStoredMemoryRecords(projectRoot);
  const resolution = options.safe
    ? helpers.resolveSafeCandidateRecords(records, memoryId, options.all)
    : {
        matches: helpers.resolveCandidateRecords(records, memoryId, options.all),
        skipped: [] as helpers.SafeCandidateRecord[],
      };

  for (const entry of resolution.matches) {
    await approveCandidateMemory(entry, projectRoot);
  }
  if (resolution.matches.length > 0) {
    await updateIndex(projectRoot);
  }

  return {
    affectedCount: resolution.matches.length,
    ...(options.safe ? { skippedManualReviewCount: resolution.skipped.length } : {}),
  };
}

export async function dismissCandidateAction(
  projectRoot: string,
  memoryId: string | undefined,
  options: { all?: boolean },
): Promise<CandidateActionResultViewModel> {
  const records = await loadStoredMemoryRecords(projectRoot);
  const matches = helpers.resolveCandidateRecords(records, memoryId, options.all);

  for (const entry of matches) {
    await updateStoredMemoryStatus(entry, "stale");
  }
  await updateIndex(projectRoot);

  return {
    affectedCount: matches.length,
  };
}
