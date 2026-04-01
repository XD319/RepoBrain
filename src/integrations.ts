export const INTEGRATION_IDS = ["claude", "codex", "cursor", "copilot"] as const;
export const INTEGRATION_INSTRUCTION_KINDS = [
  "skill",
  "rules",
  "custom-instructions",
] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];
export type IntegrationInstructionKind = (typeof INTEGRATION_INSTRUCTION_KINDS)[number];

export interface IntegrationAdapter {
  id: IntegrationId;
  label: string;
  instructionKind: IntegrationInstructionKind;
  templatePath: string;
  readsBrainSchema: true;
  readsInjectOutput: true;
  readsSuggestSkillsOutput: true;
  coreResponsibilities: string[];
  adapterResponsibilities: string[];
}

export const INTEGRATION_ADAPTERS: readonly IntegrationAdapter[] = [
  {
    id: "claude",
    label: "Claude Code",
    instructionKind: "skill",
    templatePath: "integrations/claude/SKILL.md",
    readsBrainSchema: true,
    readsInjectOutput: true,
    readsSuggestSkillsOutput: true,
    coreResponsibilities: [
      "Own the .brain schema, storage, and validation rules.",
      "Produce durable repo context through brain inject.",
      "Produce task-aware routing hints through brain suggest-skills.",
    ],
    adapterResponsibilities: [
      "Translate RepoBrain outputs into Claude-friendly skill instructions.",
      "Keep Claude setup thin and avoid adapter-local memory stores.",
    ],
  },
  {
    id: "codex",
    label: "Codex",
    instructionKind: "skill",
    templatePath: "integrations/codex/SKILL.md",
    readsBrainSchema: true,
    readsInjectOutput: true,
    readsSuggestSkillsOutput: true,
    coreResponsibilities: [
      "Own the .brain schema, storage, and validation rules.",
      "Produce durable repo context through brain inject.",
      "Produce task-aware routing hints through brain suggest-skills.",
    ],
    adapterResponsibilities: [
      "Translate RepoBrain outputs into Codex-friendly session instructions.",
      "Keep Codex setup thin and avoid adapter-local memory stores.",
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    instructionKind: "rules",
    templatePath: "integrations/cursor/repobrain.mdc",
    readsBrainSchema: true,
    readsInjectOutput: true,
    readsSuggestSkillsOutput: true,
    coreResponsibilities: [
      "Own the .brain schema, storage, and validation rules.",
      "Produce durable repo context through brain inject.",
      "Produce task-aware routing hints through brain suggest-skills.",
    ],
    adapterResponsibilities: [
      "Translate RepoBrain outputs into Cursor rules or project instructions.",
      "Keep Cursor setup thin and avoid adapter-local memory stores.",
    ],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    instructionKind: "custom-instructions",
    templatePath: "integrations/copilot/copilot-instructions.md",
    readsBrainSchema: true,
    readsInjectOutput: true,
    readsSuggestSkillsOutput: true,
    coreResponsibilities: [
      "Own the .brain schema, storage, and validation rules.",
      "Produce durable repo context through brain inject.",
      "Produce task-aware routing hints through brain suggest-skills.",
    ],
    adapterResponsibilities: [
      "Translate RepoBrain outputs into Copilot custom instructions.",
      "Keep Copilot setup thin and avoid adapter-local memory stores.",
    ],
  },
];

export function getIntegrationAdapter(id: IntegrationId): IntegrationAdapter | undefined {
  return INTEGRATION_ADAPTERS.find((adapter) => adapter.id === id);
}
