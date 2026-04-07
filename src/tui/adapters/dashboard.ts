import { loadConfig } from "../../config.js";
import { loadSchemaValidatedMemoryRecords } from "../../memory-schema.js";
import { getSteeringRulesStatus } from "../../steering-rules.js";
import { getMemoryStatus, loadActivityState } from "../../store.js";
import type { BrainActivityState, BrainConfig, Memory, MemorySchemaHealthSummary } from "../../types.js";
import { MEMORY_TYPES } from "../../types.js";
import * as helpers from "../../commands/helpers.js";

export interface DashboardStatsViewModel {
  totalMemories: number;
  lastUpdated: string;
  byType: Map<string, number>;
  byImportance: Map<string, number>;
  byStatus: Map<string, number>;
  schemaSummary: MemorySchemaHealthSummary;
}

export interface DashboardStatusViewModel {
  projectRoot: string;
  config: BrainConfig;
  totalMemories: number;
  lastUpdated: string;
  lastInjectedAt: string;
  steeringRulesStatusText: string;
  snapshot: helpers.WorkflowSnapshot;
  reminders: string[];
  recentLoadedMemories: BrainActivityState["recentLoadedMemories"];
  recentCapturedMemories: Memory[];
  schemaSummary: MemorySchemaHealthSummary;
}

export async function buildDashboardStatsViewModel(projectRoot: string): Promise<DashboardStatsViewModel> {
  const { records, schema } = await loadSchemaValidatedMemoryRecords(projectRoot);
  return createDashboardStatsViewModel(records.map((entry) => entry.memory), schema.summary);
}

export async function buildDashboardStatusViewModel(projectRoot: string): Promise<DashboardStatusViewModel> {
  const [{ records, schema }, activity, steeringRules, config] = await Promise.all([
    loadSchemaValidatedMemoryRecords(projectRoot),
    loadActivityState(projectRoot),
    getSteeringRulesStatus(projectRoot),
    loadConfig(projectRoot),
  ]);
  const memories = records.map((entry) => entry.memory);
  const snapshot = await helpers.buildWorkflowSnapshot(projectRoot, config, memories);
  const reminders = [...snapshot.reminders];
  if (schema.summary.files_with_errors > 0) {
    reminders.unshift('run "brain lint-memory" to inspect schema errors before the next share or audit');
  } else if (schema.summary.fixable_files > 0) {
    reminders.unshift('run "brain normalize-memory" to apply safe frontmatter normalization');
  }
  return {
    projectRoot,
    config,
    totalMemories: memories.length,
    lastUpdated: memories[0]?.date ?? "N/A",
    lastInjectedAt: activity.lastInjectedAt ?? "N/A",
    steeringRulesStatusText: helpers.formatSteeringRulesStatus(steeringRules),
    snapshot,
    reminders,
    recentLoadedMemories: activity.recentLoadedMemories,
    recentCapturedMemories: memories.slice(0, 5),
    schemaSummary: schema.summary,
  };
}

export function createDashboardStatsViewModel(
  memories: Memory[],
  schemaSummary: MemorySchemaHealthSummary,
): DashboardStatsViewModel {
  const byType = new Map<string, number>(MEMORY_TYPES.map((type) => [type, 0]));
  const byImportance = new Map<string, number>();
  const byStatus = new Map<string, number>();

  for (const memory of memories) {
    byType.set(memory.type, (byType.get(memory.type) ?? 0) + 1);
    byImportance.set(memory.importance, (byImportance.get(memory.importance) ?? 0) + 1);
    const status = getMemoryStatus(memory);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }

  return {
    totalMemories: memories.length,
    lastUpdated: memories[0]?.date ?? "N/A",
    byType,
    byImportance,
    byStatus,
    schemaSummary,
  };
}
