import { getMemoryStatus, loadAllMemories } from "../../store.js";
import type { Importance, Memory, MemoryStatus, MemoryType } from "../../types.js";

export interface MemoryBrowserFilters {
  type: MemoryType | "all";
  status: MemoryStatus | "all";
  importance: Importance | "all";
}

export interface MemoryBrowserItemViewModel {
  memory: Memory;
  status: MemoryStatus;
}

export async function buildMemoryBrowserViewModel(
  projectRoot: string,
  filters: MemoryBrowserFilters,
): Promise<MemoryBrowserItemViewModel[]> {
  const memories = await loadAllMemories(projectRoot);
  return filterMemoriesForBrowser(memories, filters);
}

export function filterMemoriesForBrowser(
  memories: Memory[],
  filters: MemoryBrowserFilters,
): MemoryBrowserItemViewModel[] {
  return memories
    .map((memory) => ({
      memory,
      status: getMemoryStatus(memory),
    }))
    .filter((entry) => (filters.type === "all" ? true : entry.memory.type === filters.type))
    .filter((entry) => (filters.status === "all" ? true : entry.status === filters.status))
    .filter((entry) => (filters.importance === "all" ? true : entry.memory.importance === filters.importance));
}
