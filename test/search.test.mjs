import { describe, expect, it } from "vitest";

import { formatSearchResultLine, renderSearchResultsJson, searchMemories } from "../src/search.ts";

describe("searchMemories", () => {
  it("uses AND semantics and supports mixed zh/en keywords", () => {
    const records = [
      createRecord("gotchas/2026-04-01-axios-timeout.md", {
        type: "gotcha",
        title: "Axios timeout in 支付 API",
        summary: "支付接口在高峰期会 timeout。",
        detail: "When request retries are missing, payment calls timeout and fail.",
        tags: ["axios", "支付", "timeout"],
        importance: "high",
        date: "2026-04-01T10:00:00.000Z",
        status: "active",
      }),
      createRecord("gotchas/2026-04-01-axios-retry.md", {
        type: "gotcha",
        title: "Axios retry setup",
        summary: "Retry helps with transient network issues.",
        detail: "Only retry notes, no payment context.",
        tags: ["axios", "retry"],
        importance: "medium",
        date: "2026-04-01T09:00:00.000Z",
        status: "active",
      }),
    ];

    const results = searchMemories(records, "axios 支付");

    expect(results).toHaveLength(1);
    expect(results[0]?.record.memory.title).toContain("支付");
  });

  it("filters active by default and supports --all/status style filtering", () => {
    const records = [
      createRecord("goals/2026-04-01-refactor-auth.md", {
        type: "goal",
        title: "Refactor auth module",
        summary: "Track auth cleanup goal.",
        detail: "Keep this goal active for now.",
        tags: ["auth"],
        importance: "high",
        date: "2026-04-01T10:00:00.000Z",
        status: "active",
      }),
      createRecord("goals/2026-04-01-refactor-auth-done.md", {
        type: "goal",
        title: "Refactor auth module",
        summary: "Completed goal history.",
        detail: "This goal is done.",
        tags: ["auth"],
        importance: "medium",
        date: "2026-04-01T08:00:00.000Z",
        status: "done",
      }),
    ];

    const defaultResults = searchMemories(records, "auth");
    expect(defaultResults).toHaveLength(1);
    expect(defaultResults[0]?.record.memory.status).toBe("active");

    const allResults = searchMemories(records, "auth", { all: true });
    expect(allResults).toHaveLength(2);

    const doneResults = searchMemories(records, "auth", { status: "done" });
    expect(doneResults).toHaveLength(1);
    expect(doneResults[0]?.record.memory.status).toBe("done");
  });

  it("ranks by relevance, then importance, then date", () => {
    const records = [
      createRecord("patterns/2026-04-01-a.md", {
        type: "pattern",
        title: "Node stream parser",
        summary: "Parser for stream data.",
        detail: "node node parser parser stream",
        tags: ["node"],
        importance: "low",
        date: "2026-04-01T09:00:00.000Z",
        status: "active",
      }),
      createRecord("patterns/2026-04-01-b.md", {
        type: "pattern",
        title: "Node parser baseline",
        summary: "Stream parser baseline.",
        detail: "node parser stream",
        tags: ["node"],
        importance: "high",
        date: "2026-04-01T08:00:00.000Z",
        status: "active",
      }),
      createRecord("patterns/2026-04-01-c.md", {
        type: "pattern",
        title: "Node parser baseline newer",
        summary: "Stream parser baseline.",
        detail: "node parser stream",
        tags: ["node"],
        importance: "high",
        date: "2026-04-01T11:00:00.000Z",
        status: "active",
      }),
    ];

    const results = searchMemories(records, "node parser");
    expect(results).toHaveLength(3);
    expect(results[0]?.record.relativePath).toContain("2026-04-01-a.md");
    expect(results[1]?.record.relativePath).toContain("2026-04-01-c.md");
    expect(results[2]?.record.relativePath).toContain("2026-04-01-b.md");
  });

  it("renders line and json output with memory id", () => {
    const result = searchMemories(
      [
        createRecord("decisions/2026-04-01-use-tsup.md", {
          type: "decision",
          title: "Use tsup for build",
          summary: "Switch from tsc to tsup.",
          detail: "tsup speeds up bundling.",
          tags: ["build", "tsup"],
          importance: "high",
          date: "2026-04-01T10:00:00.000Z",
          status: "active",
        }),
      ],
      "tsup build",
    )[0];

    expect(result).toBeTruthy();
    const line = formatSearchResultLine(result);
    expect(line).toMatch(/^2026-04-01-use-tsup \| decision \| high \| Use tsup for build/);

    const json = renderSearchResultsJson([result]);
    expect(json[0]).toMatchObject({
      id: "2026-04-01-use-tsup",
      type: "decision",
      importance: "high",
      title: "Use tsup for build",
    });
  });
});

function createRecord(relativePath, memory) {
  return {
    filePath: `/tmp/.brain/${relativePath}`,
    relativePath,
    memory,
  };
}
