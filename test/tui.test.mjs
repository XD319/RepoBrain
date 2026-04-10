import { describe, expect, it } from "vitest";

import { parseInitialScreen, resolveScreenHotkey } from "../src/tui/app.tsx";
import { buildRoutingInput, parsePathsInput } from "../src/tui/screens/routing.tsx";
import { clampSelection, getSelectedCandidateId } from "../src/tui/screens/review.tsx";
import { nextFilterValue } from "../src/tui/screens/memories.tsx";
import { clampSearchSelection, hasSearchSelection, nextSearchTypeFilter } from "../src/tui/screens/search.tsx";
import { filterMemoriesForBrowser } from "../src/tui/adapters/memories.ts";
import { applyInputBuffer, parseCommaSeparatedValues } from "../src/tui/components/input-buffer.ts";
import React from "react";
import { render } from "ink";
import { SearchScreen } from "../src/tui/screens/search.tsx";
import { PassThrough } from "node:stream";

describe("tui app helpers", () => {
  it("parses initial screen and validates values", () => {
    expect(parseInitialScreen(undefined)).toBe("dashboard");
    expect(parseInitialScreen("review")).toBe("review");
    expect(parseInitialScreen("search")).toBe("search");
    expect(() => parseInitialScreen("unknown")).toThrow(/Unsupported screen/);
  });

  it("resolves screen hotkeys", () => {
    expect(resolveScreenHotkey("1")).toBe("dashboard");
    expect(resolveScreenHotkey("5")).toBe("routing");
    expect(resolveScreenHotkey("6")).toBe("search");
    expect(resolveScreenHotkey("x")).toBeNull();
  });
});

describe("tui review helpers", () => {
  it("clamps selection and resolves selected candidate id", () => {
    const model = {
      totalCandidates: 2,
      safeCandidates: 1,
      candidates: [
        { id: "cand-a", type: "pattern", importance: "high", title: "A" },
        { id: "cand-b", type: "decision", importance: "medium", title: "B" },
      ],
    };
    expect(clampSelection(2, -10)).toBe(0);
    expect(clampSelection(2, 50)).toBe(1);
    expect(getSelectedCandidateId(model, 1)).toBe("cand-b");
    expect(getSelectedCandidateId(model, 999)).toBe("cand-b");
  });
});

describe("tui routing helpers", () => {
  it("applies task text input and backspace safely", () => {
    expect(applyInputBuffer("", "f", {})).toBe("f");
    expect(applyInputBuffer("fix", " ", {})).toBe("fix ");
    expect(applyInputBuffer("fix bug", "", { backspace: true })).toBe("fix bu");
    expect(applyInputBuffer("fix", "", { return: true })).toBe("fix");
  });

  it("parses comma-separated paths", () => {
    expect(parsePathsInput("src/a.ts, src/b.ts,")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseCommaSeparatedValues("a,b , c")).toEqual(["a", "b", "c"]);
  });

  it("builds routing input with normalized task and explicit paths", () => {
    expect(buildRoutingInput("  fix bug  ", "src/a.ts,src/b.ts")).toEqual({
      task: "fix bug",
      paths: ["src/a.ts", "src/b.ts"],
      pathSource: "explicit",
    });
    expect(buildRoutingInput("task", "")).toEqual({
      task: "task",
      paths: [],
      pathSource: "none",
    });
  });
});

describe("tui memories helpers", () => {
  it("cycles filter values and filters memory browser entries", () => {
    expect(nextFilterValue(["all", "decision", "pattern"], "all")).toBe("decision");
    expect(nextFilterValue(["all", "decision", "pattern"], "pattern")).toBe("all");

    const entries = filterMemoriesForBrowser(
      [
        createMemory({ type: "decision", importance: "high", status: "active" }),
        createMemory({ type: "pattern", importance: "low", status: "candidate" }),
      ],
      { type: "pattern", status: "candidate", importance: "low" },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.memory.type).toBe("pattern");
  });
});

describe("tui search helpers", () => {
  it("cycles type filters and clamps selection", () => {
    expect(nextSearchTypeFilter("all")).toBe("decision");
    expect(nextSearchTypeFilter("goal")).toBe("all");
    expect(clampSearchSelection(0, 4)).toBe(0);
    expect(clampSearchSelection(2, 4)).toBe(1);
    expect(hasSearchSelection([], 0)).toBe(false);
    expect(hasSearchSelection([{ id: "m-1" }], 0)).toBe(true);
  });

  it("renders search screen without crashing", () => {
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode() {},
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const app = render(
      React.createElement(SearchScreen, {
        projectRoot: process.cwd(),
        onMessage: () => {},
        onError: () => {},
      }),
      { exitOnCtrlC: false, stdin, stdout, stderr },
    );

    app.unmount();
    expect(true).toBe(true);
  });
});

function createMemory(overrides = {}) {
  const now = "2026-04-01T10:00:00.000Z";
  return {
    type: "decision",
    title: "Sample memory",
    summary: "summary",
    detail: "detail detail detail detail detail detail detail detail detail",
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
