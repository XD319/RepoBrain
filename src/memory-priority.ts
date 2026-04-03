import type { Memory } from "./types.js";

export interface MemoryPriorityReport {
  total: number;
  qualityAdjustment: number;
  hitCountAdjustment: number;
  recencyAdjustment: number;
  recencyLabel: string;
  importanceAdjustment: number;
  riskAdjustment: number;
}

export function computeInjectPriority(memory: Memory): number {
  return computeInjectPriorityReport(memory).total;
}

export function computeInjectPriorityReport(memory: Memory, now: number = Date.now()): MemoryPriorityReport {
  const qualityAdjustment = roundScore((memory.score ?? 60) * 0.18);
  const hitCountAdjustment = roundScore(Math.min(Math.log2((memory.hit_count ?? 0) + 1) * 4, 12));
  const recency = computeRecency(memory, now);
  const importanceAdjustment =
    memory.importance === "high" ? 16 : memory.importance === "medium" ? 10 : 5;
  const riskAdjustment =
    (memory.risk_level ?? "low") === "high" ? 8 : (memory.risk_level ?? "low") === "medium" ? 4 : 1;

  return {
    total: roundScore(
      qualityAdjustment + hitCountAdjustment + recency.adjustment + importanceAdjustment + riskAdjustment,
    ),
    qualityAdjustment,
    hitCountAdjustment,
    recencyAdjustment: recency.adjustment,
    recencyLabel: recency.label,
    importanceAdjustment,
    riskAdjustment,
  };
}

function computeRecency(memory: Memory, now: number): { adjustment: number; label: string } {
  const candidates = [memory.updated, memory.last_used, memory.created_at, memory.date].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const selected = candidates
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => !Number.isNaN(entry.time))
    .sort((left, right) => right.time - left.time)[0];

  if (!selected) {
    return { adjustment: 4, label: "no valid timestamp" };
  }

  const ageInDays = Math.max(0, (now - selected.time) / (1000 * 60 * 60 * 24));
  const adjustment = roundScore(Math.max(2, 12 - ageInDays / 14));
  return {
    adjustment,
    label: `${selected.value} (${Math.round(ageInDays)}d ago)`,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
