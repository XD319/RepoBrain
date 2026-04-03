import assert from "node:assert/strict";

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

  assert.equal(priority, 39.9);
});

await runTest("computeInjectPriority discounts stale recency while preserving capped hit-count influence", async () => {
  const twoHundredDaysAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const priority = computeInjectPriority({
    type: "decision",
    title: "Old but frequently used memory",
    summary: "Heat should cap at 100 and freshness should bottom out at zero.",
    detail: "## DECISION\n\nCap heat and clamp freshness at zero for very old last_used values.",
    tags: ["priority"],
    importance: "high",
    date: "2026-04-01T08:00:00.000Z",
    score: 80,
    hit_count: 25,
    last_used: twoHundredDaysAgo,
    created_at: "2026-04-01T08:00:00.000Z",
    stale: false,
  });

  assert.ok(Math.abs(priority - 55.2) < 0.01);
});

console.log("All memory priority tests passed.");

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
