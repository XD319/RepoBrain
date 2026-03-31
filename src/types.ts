export const MEMORY_TYPES = ["decision", "gotcha", "convention"] as const;
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
