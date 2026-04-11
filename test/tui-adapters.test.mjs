import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/store.ts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    approveCandidateMemory: vi.fn(),
    loadStoredMemoryRecords: vi.fn(),
    updateIndex: vi.fn(),
    updateStoredMemoryStatus: vi.fn(),
  };
});

import { createDashboardStatsViewModel } from "../src/tui/adapters/dashboard.ts";
import { createActivePreferenceListViewModel } from "../src/tui/adapters/preferences.ts";
import {
  approveCandidateAction,
  createCandidateListViewModel,
  dismissCandidateAction,
} from "../src/tui/adapters/review.ts";
import { createRoutingInspectorViewModel } from "../src/tui/adapters/routing.ts";
import { searchRecordsForView } from "../src/tui/adapters/search.ts";
import * as store from "../src/store.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("builds search result view model with type filter and relevance order", () => {
    const results = searchRecordsForView(
      [
        createRecord(
          "patterns/2026-04-01-node-parser.md",
          createMemory({
            type: "pattern",
            importance: "medium",
            title: "Node parser pipeline",
            summary: "Parser pipeline for streaming auth events",
            detail: "Use the parser pipeline to normalize auth events before writes.",
            tags: ["auth", "parser"],
          }),
        ),
        createRecord(
          "decisions/2026-04-02-auth-parser-title.md",
          createMemory({
            type: "decision",
            importance: "high",
            title: "Auth parser boundary",
            summary: "Keep auth parsing at the boundary",
            detail: "Boundary parser keeps auth payload normalization deterministic.",
            tags: ["auth"],
          }),
        ),
      ],
      "auth parser",
      { type: "all" },
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "2026-04-01-node-parser",
      type: "pattern",
      importance: "medium",
    });
    expect(results[0]?.snippet).toMatch(/title:|summary:|detail:/);
    expect(results[1]?.relativePath).toBe("decisions/2026-04-02-auth-parser-title.md");

    const filtered = searchRecordsForView(
      [
        createRecord(
          "patterns/2026-04-01-node-parser.md",
          createMemory({
            type: "pattern",
            title: "Node parser pipeline",
            summary: "Parser pipeline",
            detail: "Auth parser detail",
            tags: ["auth", "parser"],
          }),
        ),
      ],
      "auth parser",
      { type: "decision" },
    );

    expect(filtered).toEqual([]);
  });

  it("approve adapter promotes the selected candidate and updates index", async () => {
    vi.mocked(store.loadStoredMemoryRecords).mockResolvedValue([
      createRecord(
        "patterns/2026-04-01-node-stream-parser.md",
        createMemory({
          type: "pattern",
          title: "Node stream parser pattern",
          status: "candidate",
        }),
      ),
    ]);
    vi.mocked(store.approveCandidateMemory).mockResolvedValue(undefined);
    vi.mocked(store.updateIndex).mockResolvedValue(undefined);

    const result = await approveCandidateAction("/repo", "2026-04-01-node-stream-parser", { safe: false });

    expect(result).toEqual({ affectedCount: 1 });
    expect(store.approveCandidateMemory).toHaveBeenCalledTimes(1);
    expect(store.updateIndex).toHaveBeenCalledWith("/repo");
  });

  it("dismiss adapter supersedes the selected candidate and updates index", async () => {
    vi.mocked(store.loadStoredMemoryRecords).mockResolvedValue([
      createRecord(
        "patterns/2026-04-01-node-stream-parser.md",
        createMemory({
          type: "pattern",
          title: "Node stream parser pattern",
          status: "candidate",
        }),
      ),
    ]);
    vi.mocked(store.updateStoredMemoryStatus).mockResolvedValue(undefined);
    vi.mocked(store.updateIndex).mockResolvedValue(undefined);

    const result = await dismissCandidateAction("/repo", "2026-04-01-node-stream-parser", {});

    expect(result).toEqual({ affectedCount: 1 });
    expect(store.updateStoredMemoryStatus).toHaveBeenCalledTimes(1);
    expect(store.updateStoredMemoryStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: "patterns/2026-04-01-node-stream-parser.md",
      }),
      "superseded",
    );
    expect(store.updateIndex).toHaveBeenCalledWith("/repo");
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
