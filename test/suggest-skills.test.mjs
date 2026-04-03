import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initBrain, saveMemory } from "../dist/store-api.js";
import { buildSkillShortlist, renderSkillShortlist } from "../dist/suggest-skills.js";

await runTest("suggest-skills prints required, recommended, and suppressed skills from matched active memories", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Route browser test work through Playwright guidance",
        summary: "Prefer Playwright-specific guidance for browser test debugging.",
        detail: "## DECISION\n\nUse Playwright-oriented guidance for browser-heavy tasks.",
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
        type: "gotcha",
        title: "Ignore candidate-only skill hints",
        summary: "Candidate routing metadata should not affect the shortlist yet.",
        detail: "## GOTCHA\n\nCandidate memories should stay out of the active shortlist.",
        tags: ["skills"],
        importance: "medium",
        date: "2026-04-01T12:05:00.000Z",
        status: "candidate",
        recommended_skills: ["legacy-bot"],
        skill_trigger_tasks: ["debug flaky browser tests"],
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "debug flaky browser tests in CI",
      paths: ["tests/e2e/login.spec.ts", "playwright.config.ts"],
    });
    const stdout = renderSkillShortlist(result);

    assert.match(stdout, /Matched memories:/);
    assert.match(stdout, /Route browser test work through Playwright guidance/);
    assert.match(stdout, /task: debug flaky browser tests/);
    assert.match(stdout, /path: tests\/e2e\/ -> tests\/e2e\/login\.spec\.ts/);
    assert.match(stdout, /path: playwright\.config\.ts -> playwright\.config\.ts/);
    assert.match(stdout, /- playwright \| required \| score=/);
    assert.match(stdout, /- github:gh-fix-ci \| recommended \| score=/);
    assert.match(stdout, /- imagegen \| suppressed \| score=/);
    assert.doesNotMatch(stdout, /legacy-bot/);
  });
});

await runTest("suggest-skills surfaces conflicting routing advice for the same skill", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Use Playwright for browser smoke tests",
        summary: "Playwright is usually required for browser smoke suites.",
        detail: "## DECISION\n\nUse Playwright for smoke coverage.",
        tags: ["playwright"],
        importance: "high",
        date: "2026-04-01T13:00:00.000Z",
        status: "active",
        required_skills: ["playwright"],
        skill_trigger_paths: ["tests/e2e/"],
        skill_trigger_tasks: ["browser smoke tests"],
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "gotcha",
        title: "Avoid Playwright when only screenshot fixtures changed",
        summary: "Simple fixture refreshes should skip the full Playwright workflow.",
        detail: "## GOTCHA\n\nDo not reach for Playwright when refreshing static screenshots only.",
        tags: ["playwright", "screenshots"],
        importance: "medium",
        date: "2026-04-01T13:05:00.000Z",
        status: "active",
        suppressed_skills: ["playwright"],
        skill_trigger_paths: ["tests/e2e/fixtures/"],
        skill_trigger_tasks: ["browser smoke tests"],
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "browser smoke tests",
      paths: ["tests/e2e/fixtures/homepage.png"],
    });
    const stdout = renderSkillShortlist(result);

    assert.match(stdout, /- playwright \| conflicted \| score=/);
  });
});

await runTest("suggest-skills fails with a clear error when no task or path input is provided", async () => {
    await withTempRepo(async (projectRoot) => {
      await assert.rejects(
        async () => buildSkillShortlist(projectRoot, {}),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Provide a task with "--task" \(or stdin\) and\/or at least one "--path"\./);
          return true;
        },
      );
    });
  });

console.log("All suggest-skills tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-suggest-"));

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
