import { describe, expect, it } from "vitest";

import { createDashboardStatsViewModel } from "../src/tui/adapters/dashboard.ts";
import { createActivePreferenceListViewModel } from "../src/tui/adapters/preferences.ts";
import { createCandidateListViewModel } from "../src/tui/adapters/review.ts";
import { createRoutingInspectorViewModel } from "../src/tui/adapters/routing.ts";

describe("tui adapters", () => {
  it("builds dashboard stats view model", () => {
    const schemaSummary = {
      total_files: 2,
      healthy_files: 2,
      files_with_warnings: 0,
      files_with_errors: 0,
      fixable_files: 0,
      total_issues: 0,
    };
    const model = createDashboardStatsViewModel(
      [
        createMemory({ type: "decision", importance: "high", status: "active", date: "2026-04-01T10:00:00.000Z" }),
        createMemory({ type: "goal", importance: "low", status: "candidate", date: "2026-03-31T10:00:00.000Z" }),
      ],
      schemaSummary,
    );

    expect(model.totalMemories).toBe(2);
    expect(model.lastUpdated).toBe("2026-04-01T10:00:00.000Z");
    expect(model.byType.get("decision")).toBe(1);
    expect(model.byType.get("goal")).toBe(1);
    expect(model.byImportance.get("high")).toBe(1);
    expect(model.byStatus.get("candidate")).toBe(1);
    expect(model.schemaSummary).toEqual(schemaSummary);
  });

  it("builds candidate list and safe summary", () => {
    const now = "2026-04-01T10:00:00.000Z";
    const records = [
      createRecord(
        "decisions/2026-04-01-use-tsup.md",
        createMemory({ title: "Use tsup", status: "active", date: now }),
      ),
      createRecord(
        "patterns/2026-04-01-node-stream-parser.md",
        createMemory({
          type: "pattern",
          title: "Node stream parser pattern",
          summary: "Use a structured parser pipeline for stream input in long-lived services.",
          detail:
            "Build stream parsing around deterministic stages, explicit backpressure handling, and guard rails for malformed records before persistence.",
          status: "candidate",
          date: now,
        }),
      ),
      createRecord(
        "working/2026-04-01-temporary-task-note.md",
        createMemory({
          type: "working",
          title: "Temporary fix notes",
          summary: "Temporary workaround",
          detail: "Quick temporary approach",
          status: "candidate",
          date: now,
        }),
      ),
    ];

    const model = createCandidateListViewModel(records);

    expect(model.totalCandidates).toBe(2);
    expect(model.safeCandidates).toBe(1);
    expect(model.candidates[0]).toMatchObject({
      id: "2026-04-01-node-stream-parser",
      type: "pattern",
    });
  });

  it("builds active preference list view model", () => {
    const model = createActivePreferenceListViewModel([
      createPreference({ target: "routing", preference: "prefer", status: "active" }),
      createPreference({ target: "legacy-flow", preference: "avoid", status: "stale" }),
    ]);

    expect(model.active).toHaveLength(1);
    expect(model.active[0]).toMatchObject({
      target: "routing",
      preference: "prefer",
      targetType: "workflow",
    });
  });

  it("builds routing inspector result view model", () => {
    const bundle = {
      contract_version: "repobrain.task-routing-bundle.v1",
      task: "fix payment timeout",
      paths: ["src/payments/service.ts"],
      path_source: "explicit",
      context_markdown: "context",
      skill_plan: {
        required: [],
        prefer_first: [],
        optional_fallback: [],
        suppress: [],
        blocked: [],
        human_review: [],
      },
      matched_memories: [],
      resolved_skills: [],
      conflicts: [],
      warnings: ["warn-1"],
      display_mode: "silent-ok",
    };

    const model = createRoutingInspectorViewModel(bundle);
    expect(model.contractVersion).toBe("repobrain.task-routing-bundle.v1");
    expect(model.task).toBe("fix payment timeout");
    expect(model.warnings).toEqual(["warn-1"]);
    expect(model.bundle).toBe(bundle);
  });
});

function createRecord(relativePath, memory) {
  return {
    filePath: `/tmp/.brain/${relativePath}`,
    relativePath,
    memory,
  };
}

function createMemory(overrides = {}) {
  const now = "2026-04-01T10:00:00.000Z";
  return {
    type: "decision",
    title: "Sample memory",
    summary: "summary",
    detail: "detail",
    tags: [],
    importance: "medium",
    date: now,
    score: 60,
    hit_count: 1,
    last_used: null,
    created_at: now,
    stale: false,
    status: "active",
    ...overrides,
  };
}

function createPreference(overrides = {}) {
  const now = "2026-04-01T10:00:00.000Z";
  return {
    kind: "routing_preference",
    target_type: "workflow",
    target: "target",
    preference: "prefer",
    reason: "reason",
    confidence: 1,
    source: "manual",
    created_at: now,
    updated_at: now,
    status: "active",
    ...overrides,
  };
}
