import { expect, it } from "vitest";

import { computeInjectPriority } from "../dist/store-api.js";

await runTest("computeInjectPriority applies the new explainable adjustment stack when last_used is null", async () => {
  const priority = computeInjectPriority({
    type: "decision",
    title: "Freshness fallback",
    summary: "Missing last_used should use the neutral freshness score.",
    detail: "## DECISION\n\nUse a neutral freshness score when last_used is missing.",
    tags: ["priority"],
    importance: "medium",
    date: "2026-04-01T08:00:00.000Z",
    score: 60,
    hit_count: 2,
    last_used: null,
    created_at: "2026-04-01T08:00:00.000Z",
    stale: false,
  });

  assert.ok(Math.abs(priority - 39.85) < 0.15, `expected ~39.85, got ${priority}`);
});

await runTest("computeInjectPriority discounts stale recency while preserving capped hit-count influence", async () => {
  /** Align date/created/last_used so recency uses a ~200d-old stamp (newest field wins). */
  const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const priority = computeInjectPriority({
    type: "decision",
    title: "Old but frequently used memory",
    summary: "Heat should cap at 100 and freshness should bottom out at zero.",
    detail: "## DECISION\n\nCap heat and clamp freshness at zero for very old last_used values.",
    tags: ["priority"],
    importance: "high",
    date: twoHundredDaysAgo,
    score: 80,
    hit_count: 25,
    last_used: twoHundredDaysAgo,
    created_at: twoHundredDaysAgo,
    stale: false,
  });

  assert.ok(Math.abs(priority - 45.4) < 0.05, `expected ~45.4, got ${priority}`);
});

console.log("All memory priority tests passed.");

function runTest(name, callback) {
  it(name, callback);
}

const assert = {
  equal(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  strictEqual(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  notEqual(actual, expected, message) {
    expect(actual, message).not.toBe(expected);
  },
  deepEqual(actual, expected, message) {
    expect(actual, message).toEqual(expected);
  },
  notDeepEqual(actual, expected, message) {
    expect(actual, message).not.toEqual(expected);
  },
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
  match(value, pattern, message) {
    expect(value, message).toMatch(pattern);
  },
  doesNotMatch(value, pattern, message) {
    expect(value, message).not.toMatch(pattern);
  },
  throws(action, matcher, message) {
    if (matcher === undefined) {
      expect(action, message).toThrow();
      return;
    }
    expect(action, message).toThrow(matcher);
  },
  async rejects(action, matcher, message) {
    let failure;
    try {
      await action();
    } catch (error) {
      failure = error;
    }
    expect(failure, message ?? "expected promise to reject").toBeTruthy();
    if (typeof matcher === "function") {
      const handled = matcher(failure);
      expect(handled, message ?? "reject matcher should confirm the error").toBe(true);
      return;
    }
    if (matcher instanceof RegExp) {
      expect(failure.message, message).toMatch(matcher);
      return;
    }
    if (matcher && typeof matcher === "object") {
      expect(failure, message).toMatchObject(matcher);
    }
  },
  fail(message) {
    throw new Error(message ?? "assert.fail was called");
  },
};
