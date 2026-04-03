import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSkillShortlist,
  initBrain,
  renderSkillShortlistJson,
  saveMemory,
} from "../dist/store-api.js";
import { renderSkillShortlist } from "../dist/suggest-skills.js";

await runTest("suggest-skills renders a markdown routing plan from matched active memories", async () => {
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

    assert.equal(result.contract_version, "repobrain.skill-plan.v1");
    assert.equal(result.kind, "repobrain.skill_invocation_plan");
    assert.deepEqual(result.invocation_plan.required, ["playwright"]);
    assert.deepEqual(result.invocation_plan.prefer_first, ["github:gh-fix-ci"]);
    assert.deepEqual(result.invocation_plan.optional_fallback, ["browser-checklist"]);
    assert.deepEqual(result.invocation_plan.suppress, ["imagegen"]);
    assert.equal(result.conflicts.length, 0);

    assert.match(stdout, /Contract: repobrain\.skill-plan\.v1 \(repobrain\.skill_invocation_plan\)/);
    assert.match(stdout, /Matched memories:/);
    assert.match(stdout, /Route browser test work through Playwright guidance/);
    assert.match(stdout, /task: debug flaky browser tests/);
    assert.match(stdout, /path: tests\/e2e\/ -> tests\/e2e\/login\.spec\.ts/);
    assert.match(stdout, /path: playwright\.config\.ts -> playwright\.config\.ts/);
    assert.match(stdout, /Resolved skills:/);
    assert.match(stdout, /- playwright \| required \| plan=required \| score=/);
    assert.match(stdout, /- github:gh-fix-ci \| recommended \| plan=prefer_first \| score=/);
    assert.match(stdout, /- browser-checklist \| recommended \| plan=optional_fallback \| score=/);
    assert.match(stdout, /- imagegen \| suppressed \| plan=suppress \| score=/);
    assert.match(stdout, /Invocation plan:/);
    assert.match(stdout, /- required: playwright/);
    assert.match(stdout, /- prefer_first: github:gh-fix-ci/);
    assert.match(stdout, /- optional_fallback: browser-checklist/);
    assert.match(stdout, /- suppress: imagegen/);
    assert.doesNotMatch(stdout, /legacy-bot/);
  });
});

await runTest("suggest-skills emits choose-required when required evidence clearly outweighs suppression", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Use Playwright for browser smoke tests",
        summary: "Playwright stays required for smoke coverage.",
        detail: "## DECISION\n\nUse Playwright for browser smoke coverage.",
        tags: ["playwright"],
        importance: "high",
        date: "2026-04-01T13:00:00.000Z",
        status: "active",
        required_skills: ["playwright"],
        skill_trigger_paths: ["tests/e2e/"],
        skill_trigger_tasks: ["browser smoke tests"],
        risk_level: "medium",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "gotcha",
        title: "Avoid Playwright for doc-only notes",
        summary: "Documentation-only updates should not invoke Playwright.",
        detail: "## GOTCHA\n\nSkip Playwright when only browser docs changed.",
        tags: ["playwright"],
        importance: "low",
        date: "2026-04-01T13:05:00.000Z",
        status: "active",
        suppressed_skills: ["playwright"],
        skill_trigger_paths: ["docs/browser/"],
        skill_trigger_tasks: ["browser smoke tests"],
        risk_level: "low",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "browser smoke tests",
      paths: ["tests/e2e/smoke.spec.ts"],
    });

    assert.deepEqual(result.invocation_plan.required, ["playwright"]);
    assert.equal(result.conflicts[0]?.strategy_result, "choose-required");
    assert.match(
      result.conflicts[0]?.reason ?? "",
      /Required score .* exceeds suppressed score .* by at least 5/,
    );
  });
});

await runTest("suggest-skills emits human-review when required and suppressed guidance stay too close", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Use migration-runner for schema changes",
        summary: "Schema changes should go through the migration runner.",
        detail: "## DECISION\n\nUse the migration runner for schema changes.",
        tags: ["db"],
        importance: "low",
        date: "2026-04-01T14:00:00.000Z",
        status: "active",
        required_skills: ["migration-runner"],
        skill_trigger_tasks: ["schema change"],
        risk_level: "low",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "gotcha",
        title: "Skip migration-runner for tiny fixture rewrites",
        summary: "Fixture-only schema docs should not run the full migration workflow.",
        detail: "## GOTCHA\n\nDo not run migrations for fixture-only schema notes.",
        tags: ["db"],
        importance: "medium",
        date: "2026-04-01T14:05:00.000Z",
        status: "active",
        suppressed_skills: ["migration-runner"],
        skill_trigger_tasks: ["schema change"],
        invocation_mode: "prefer",
        risk_level: "low",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "schema change",
      paths: [],
    });

    assert.deepEqual(result.invocation_plan.human_review, ["migration-runner"]);
    assert.equal(result.conflicts[0]?.strategy_result, "human-review");
    assert.match(result.conflicts[0]?.reason ?? "", /too close for an automatic decision/);
  });
});

await runTest("suggest-skills emits block when high-risk suppression meets or outweighs a required skill", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Use prod-deploy skill for release train tasks",
        summary: "Release train changes usually need the deploy workflow.",
        detail: "## DECISION\n\nUse the deploy workflow for release train changes.",
        tags: ["release"],
        importance: "medium",
        date: "2026-04-01T15:00:00.000Z",
        status: "active",
        required_skills: ["prod-deploy"],
        skill_trigger_tasks: ["release train"],
        risk_level: "low",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "gotcha",
        title: "Block prod-deploy during freeze windows",
        summary: "Deploys are blocked during a freeze unless a human clears them.",
        detail: "## GOTCHA\n\nNever auto-run deploys during a release freeze.",
        tags: ["release"],
        importance: "high",
        date: "2026-04-01T15:05:00.000Z",
        status: "active",
        suppressed_skills: ["prod-deploy"],
        skill_trigger_tasks: ["release train"],
        skill_trigger_paths: ["src/release/freeze/"],
        invocation_mode: "suppress",
        risk_level: "high",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "release train",
      paths: ["src/release/freeze/window.ts"],
    });

    assert.deepEqual(result.invocation_plan.blocked, ["prod-deploy"]);
    assert.equal(result.conflicts[0]?.strategy_result, "block");
    assert.match(result.conflicts[0]?.reason ?? "", /blocks automatic invocation/);
  });
});

await runTest("suggest-skills keeps suppression when recommendation conflicts with a do-not-invoke memory", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "pattern",
        title: "Optional docs linter for handbook edits",
        summary: "Docs linter is usually helpful for handbook edits.",
        detail: "## PATTERN\n\nPrefer the docs linter for handbook edits.",
        tags: ["docs"],
        importance: "medium",
        date: "2026-04-01T16:00:00.000Z",
        status: "active",
        recommended_skills: ["docs-linter"],
        skill_trigger_tasks: ["handbook edit"],
        invocation_mode: "prefer",
        risk_level: "low",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "gotcha",
        title: "Disable docs linter for generated handbook dumps",
        summary: "Generated handbook exports should not invoke the linter.",
        detail: "## GOTCHA\n\nSuppress the docs linter for generated handbook dumps.",
        tags: ["docs"],
        importance: "medium",
        date: "2026-04-01T16:05:00.000Z",
        status: "active",
        suppressed_skills: ["docs-linter"],
        skill_trigger_tasks: ["handbook edit"],
        risk_level: "medium",
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "handbook edit",
      paths: [],
    });

    assert.deepEqual(result.invocation_plan.suppress, ["docs-linter"]);
    assert.equal(result.conflicts[0]?.kind, "recommended_vs_suppressed");
    assert.equal(result.conflicts[0]?.strategy_result, "suppress");
    assert.match(result.conflicts[0]?.reason ?? "", /recommendations are advisory while suppressions are explicit do-not-invoke hints/);
  });
});

await runTest("suggest-skills exposes a stable JSON contract for agent adapters", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Use Playwright for browser smoke tests",
        summary: "Playwright stays required for smoke coverage.",
        detail: "## DECISION\n\nUse Playwright for browser smoke coverage.",
        tags: ["playwright"],
        importance: "high",
        date: "2026-04-01T17:00:00.000Z",
        status: "active",
        required_skills: ["playwright"],
        skill_trigger_tasks: ["browser smoke tests"],
      },
      projectRoot,
    );

    const result = await buildSkillShortlist(projectRoot, {
      task: "browser smoke tests",
      paths: ["tests/e2e/login.spec.ts"],
    });
    const parsed = JSON.parse(renderSkillShortlistJson(result));
    assert.equal(parsed.contract_version, "repobrain.skill-plan.v1");
    assert.equal(parsed.kind, "repobrain.skill_invocation_plan");
    assert.deepEqual(parsed.invocation_plan.required, ["playwright"]);
    assert.ok(Array.isArray(parsed.matched_memories));
    assert.ok(Array.isArray(parsed.resolved_skills));
    assert.ok(Array.isArray(parsed.conflicts));
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
