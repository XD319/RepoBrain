export const INTEGRATION_IDS = ["claude", "codex", "cursor", "copilot"] as const;
export const INTEGRATION_INSTRUCTION_KINDS = ["skill", "rules", "custom-instructions"] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];
export type IntegrationInstructionKind = (typeof INTEGRATION_INSTRUCTION_KINDS)[number];

export interface IntegrationAdapter {
  id: IntegrationId;
  label: string;
  instructionKind: IntegrationInstructionKind;
  templatePath: string;
  contractPaths: string[];
  readsBrainSchema: true;
  readsInjectOutput: true;
  readsSuggestSkillsOutput: true;
  coreResponsibilities: string[];
  adapterResponsibilities: string[];
  failureFallback: string;
}

export const INTEGRATION_ADAPTERS: readonly IntegrationAdapter[] = [
  {
    id: "claude",
    label: "Claude Code",
    instructionKind: "skill",
    templatePath: "integrations/claude/SKILL.md",
    contractPaths: [
      "integrations/contracts/session-start.inject.md",
      "integrations/contracts/task-known.invocation-plan.json",
      "integrations/contracts/session-end.extract-candidate.json",
      "integrations/contracts/failure.reinforce-event.json",
      "integrations/contracts/routing-feedback.event.json",
    ],
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
    failureFallback:
      "When structured extraction or reinforcement is unavailable, persist the raw summary and run brain extract or brain reinforce manually.",
  },
  {
    id: "codex",
    label: "Codex",
    instructionKind: "skill",
    templatePath: "integrations/codex/SKILL.md",
    contractPaths: [
      "integrations/contracts/session-start.inject.md",
      "integrations/contracts/task-known.invocation-plan.json",
      "integrations/contracts/session-end.extract-candidate.json",
      "integrations/contracts/failure.reinforce-event.json",
      "integrations/contracts/routing-feedback.event.json",
    ],
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
    failureFallback:
      "When structured extraction or reinforcement is unavailable, persist the raw summary and run brain extract or brain reinforce manually.",
  },
  {
    id: "cursor",
    label: "Cursor",
    instructionKind: "rules",
    templatePath: "integrations/cursor/repobrain.mdc",
    contractPaths: [
      "integrations/contracts/session-start.inject.md",
      "integrations/contracts/task-known.invocation-plan.json",
      "integrations/contracts/session-end.extract-candidate.json",
      "integrations/contracts/failure.reinforce-event.json",
      "integrations/contracts/routing-feedback.event.json",
    ],
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
    failureFallback:
      "When Cursor rules cannot emit structured output, copy the session summary into a markdown artifact and hand it to brain extract or brain reinforce.",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    instructionKind: "custom-instructions",
    templatePath: "integrations/copilot/copilot-instructions.md",
    contractPaths: [
      "integrations/contracts/session-start.inject.md",
      "integrations/contracts/task-known.invocation-plan.json",
      "integrations/contracts/session-end.extract-candidate.json",
      "integrations/contracts/failure.reinforce-event.json",
      "integrations/contracts/routing-feedback.event.json",
    ],
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
    failureFallback:
      "When Copilot cannot emit structured output directly, route a saved markdown summary into brain extract or brain reinforce from the shell or CI step.",
  },
];

export function getIntegrationAdapter(id: IntegrationId): IntegrationAdapter | undefined {
  return INTEGRATION_ADAPTERS.find((adapter) => adapter.id === id);
}
