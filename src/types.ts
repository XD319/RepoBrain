export const MEMORY_TYPES = ["decision", "gotcha", "convention", "pattern"] as const;
export const IMPORTANCE_LEVELS = ["high", "medium", "low"] as const;
export const MEMORY_SOURCES = ["session", "git-commit", "manual", "pr"] as const;
export const MEMORY_STATUSES = ["active", "stale", "superseded"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type Importance = (typeof IMPORTANCE_LEVELS)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface Memory {
  type: MemoryType;
  title: string;
  summary: string;
  detail: string;
  tags: string[];
  importance: Importance;
  date: string;
  source?: MemorySource;
  status?: MemoryStatus;
}

export interface BrainConfig {
  maxInjectTokens: number;
  autoExtract: boolean;
  language: string;
}

export interface ExtractedMemoriesPayload {
  memories: Memory[];
}

export interface MemoryActivityEntry {
  type: MemoryType;
  title: string;
  importance: Importance;
  date: string;
}

export interface BrainActivityState {
  lastInjectedAt?: string;
  recentLoadedMemories: MemoryActivityEntry[];
}

export interface StoredMemoryRecord {
  filePath: string;
  relativePath: string;
  memory: Memory;
}
