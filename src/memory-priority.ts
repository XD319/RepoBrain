import type { Memory } from "./types.js";

export function computeInjectPriority(memory: Memory): number {
  const heat = Math.min(memory.hit_count * 10, 100);
  const freshness = computeFreshness(memory.last_used);
  const importanceBonus =
    memory.importance === "high" ? 15 : memory.importance === "medium" ? 5 : 0;

  return memory.score * 0.5 + heat * 0.3 + freshness * 0.2 + importanceBonus;
}

function computeFreshness(lastUsed: string | null): number {
  if (lastUsed === null) {
    return 50;
  }

  const lastUsedTime = Date.parse(lastUsed);
  if (Number.isNaN(lastUsedTime)) {
    return 0;
  }

  const daysSinceLastUsed = Math.max(0, (Date.now() - lastUsedTime) / (1000 * 60 * 60 * 24));
  return Math.max(0, 100 - (daysSinceLastUsed / 180) * 100);
}
