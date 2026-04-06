import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSkillShortlist, initBrain, saveMemory, savePreference } from "../dist/store-api.js";

await runTest("routing with static memories only matches prior invocation_plan shape", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Route browser test work through Playwright guidance",
        summary: "Prefer Playwright-specific guidance for browser test debugging.",
        detail: "## DECISION\n\nUse Playwright-oriented guidance first for browser-heavy tasks.",
        tags: ["playwright", "skills"],
        importance: "high",
        date: "2026-04-01T12:00:00.000Z",
        status: "active",
        recommended_skills: ["github:gh-fix-ci"],
        required_skills: ["playwright"],
        suppressed_skills: ["imagegen"],
        skill_trigger_paths: ["tests/e2e/", "playwright.config.ts"],
        skill_trigger_tasks: ["debug flaky browser tests"],
        invocation_mode: "prefer",
        risk_level: "medium",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "pattern",
        title: "Keep browser triage docs nearby",
        summary: "Optional fallback references are still useful if the primary skill is unavailable.",
        detail: "## PATTERN\n\nUse the internal browser checklist as a fallback when needed.",
        tags: ["browser", "skills"],
        importance: "low",
        date: "2026-04-01T12:03:00.000Z",
        status: "active",
        recommended_skills: ["browser-checklist"],
        skill_trigger_tasks: ["debug flaky browser tests"],
        invocation_mode: "optional",
        risk_level: "low",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "debug flaky browser tests in CI",
      paths: ["tests/e2e/login.spec.ts", "playwright.config.ts"],
    });

    assert.deepEqual(result.invocation_plan.required, ["playwright"]);
    assert.deepEqual(result.invocation_plan.prefer_first, ["github:gh-fix-ci"]);
    assert.deepEqual(result.invocation_plan.optional_fallback, ["browser-checklist"]);
    assert.deepEqual(result.invocation_plan.suppress, ["imagegen"]);
    assert.ok(result.routing_explanation);
    assert.ok(result.routing_explanation.priority_order.length > 0);
    assert.ok(result.routing_explanation.skill_evidence.playwright);
  });
});

await runTest("active skill preference can add a skill when no memory matches", async () => {
  await withTempRepo(async (projectRoot) => {
    await savePreference(
      {
        kind: "routing_preference",
        target_type: "skill",
        target: "jest",
        preference: "prefer",
        reason: "default unit test runner",
        confidence: 0.9,
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "run unit tests for checkout",
      paths: [],
      path_source: "none",
    });

    assert.equal(result.matched_memories.length, 0);
    assert.deepEqual(result.invocation_plan.prefer_first, ["jest"]);
    const jestSources = result.resolved_skills.find((s) => s.skill === "jest");
    assert.ok(jestSources?.sources.some((s) => s.relation === "preference_prefer"));
  });
});

await runTest("superseded preference is skipped and does not affect routing", async () => {
  await withTempRepo(async (projectRoot) => {
    await savePreference(
      {
        kind: "routing_preference",
        target_type: "skill",
        target: "legacy-tool",
        preference: "prefer",
        reason: "should not apply",
        confidence: 1,
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
        superseded_by: "pref-skill-new-tool.md",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "anything",
      paths: [],
      path_source: "none",
    });

    assert.equal(result.resolved_skills.filter((s) => s.skill === "legacy-tool").length, 0);
    assert.ok(result.routing_explanation?.notes.some((n) => n.includes("Skipped preference for legacy-tool")));
  });
});

await runTest("stale preference status does not participate in routing", async () => {
  await withTempRepo(async (projectRoot) => {
    await savePreference(
      {
        kind: "routing_preference",
        target_type: "skill",
        target: "stale-skill",
        preference: "prefer",
        reason: "old",
        confidence: 1,
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "stale",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "task",
      paths: [],
      path_source: "none",
    });

    assert.equal(result.resolved_skills.filter((s) => s.skill === "stale-skill").length, 0);
  });
});

await runTest("memory.required vs preference.avoid surfaces explainable conflict when scores are tight", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Require Playwright",
        summary: "Playwright for e2e.",
        detail: "## DECISION\n\n",
        tags: ["t"],
        importance: "low",
        date: "2026-04-01T12:00:00.000Z",
        status: "active",
        required_skills: ["playwright"],
        skill_trigger_tasks: ["e2e"],
        invocation_mode: "optional",
        risk_level: "low",
      },
      projectRoot,
    );

    await savePreference(
      {
        kind: "routing_preference",
        target_type: "skill",
        target: "playwright",
        preference: "avoid",
        reason: "prefer cypress for now",
        confidence: 1,
        source: "manual",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "e2e login flow",
      paths: [],
      path_source: "none",
    });

    const pc = result.conflicts.find((c) => c.skill === "playwright");
    assert.ok(pc);
    assert.equal(pc.kind, "required_vs_suppressed");
    assert.ok(pc.reason.toLowerCase().includes("required"));
    assert.ok(result.routing_explanation?.skill_evidence.playwright?.some((l) => l.includes("preference_avoid")));
  });
});

console.log("All routing-layer tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-routing-"));

  try {
    await initBrain(projectRoot);
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
