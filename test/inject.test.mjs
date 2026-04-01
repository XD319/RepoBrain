import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildInjection } from "../dist/inject.js";
import { initBrain, saveMemory } from "../dist/store-api.js";

const DEFAULT_BRAIN_CONFIG = {
  maxInjectTokens: 1200,
  extractMode: "suggest",
  language: "zh-CN",
};

await runTest("inject keeps legacy ordering when no task context is provided", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Older high priority memory",
        summary: "This should still win when inject runs without task context.",
        detail: "## DECISION\n\nKeep the original importance-first ordering when no task signals are provided.",
        tags: ["legacy"],
        importance: "high",
        date: "2026-04-01T08:00:00.000Z",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Newer medium memory",
        summary: "This should stay below the high importance entry without task context.",
        detail: "## DECISION\n\nThis memory is newer but less important.",
        tags: ["legacy"],
        importance: "medium",
        date: "2026-04-01T09:00:00.000Z",
        status: "active",
      },
      projectRoot,
    );

    const injection = await buildInjection(projectRoot, DEFAULT_BRAIN_CONFIG);
    assert.ok(
      injection.indexOf("Older high priority memory") < injection.indexOf("Newer medium memory"),
      "expected inject to keep the old importance-first order",
    );
    assert.doesNotMatch(injection, /Selection mode: task-aware/);
    assert.doesNotMatch(injection, /Why now:/);
  });
});

await runTest("inject prioritizes task-relevant memories and includes a short rationale", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "General release checklist",
        summary: "A generic release checklist that is newer and high importance.",
        detail: "## DECISION\n\nUse the release checklist for normal cutover work.",
        tags: ["release"],
        importance: "high",
        date: "2026-04-01T10:00:00.000Z",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Payments writes must stay inside the transaction wrapper",
        summary: "Refund work breaks if writes escape the transaction boundary.",
        detail: "## DECISION\n\nPayments and refunds must stay in the transaction wrapper before calling the ledger sync.",
        tags: ["payments", "refund"],
        importance: "medium",
        date: "2026-04-01T09:00:00.000Z",
        status: "active",
        path_scope: ["src/payments/"],
        required_skills: ["github:gh-fix-ci"],
        skill_trigger_paths: ["src/payments/refund.ts"],
        skill_trigger_tasks: ["fix refund transaction bug"],
        invocation_mode: "required",
        risk_level: "high",
      },
      projectRoot,
    );

    const injection = await buildInjection(projectRoot, DEFAULT_BRAIN_CONFIG, {
      task: "fix refund transaction bug in payments flow",
      paths: ["src/payments/refund.ts"],
      modules: ["payments"],
    });

    assert.ok(
      injection.indexOf("Payments writes must stay inside the transaction wrapper") <
        injection.indexOf("General release checklist"),
      "expected task-aware inject to prioritize the matched payments memory",
    );
    assert.match(injection, /Selection mode: task-aware/);
    assert.match(injection, /Why now: task trigger: fix refund transaction bug;/);
    assert.match(injection, /task trigger: fix refund transaction bug/);
  });
});

await runTest("inject still excludes superseded memories during task-aware selection", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Use the new auth retry wrapper",
        summary: "The newer auth retry wrapper should supersede the old guidance.",
        detail: "## DECISION\n\nNew guidance for auth retry handling.",
        tags: ["auth"],
        importance: "high",
        date: "2026-04-01T11:00:00.000Z",
        status: "active",
        path_scope: ["src/auth/"],
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Use the new auth retry wrapper",
        summary: "A later save with the same normalized title should supersede the old one.",
        detail: "## DECISION\n\nLatest guidance for auth retry handling.",
        tags: ["auth", "retry"],
        importance: "high",
        date: "2026-04-01T12:00:00.000Z",
        status: "active",
        path_scope: ["src/auth/"],
      },
      projectRoot,
    );

    const injection = await buildInjection(projectRoot, DEFAULT_BRAIN_CONFIG, {
      paths: ["src/auth/retry.ts"],
      modules: ["auth"],
    });

    assert.match(injection, /Latest guidance for auth retry handling/);
    assert.doesNotMatch(injection, /The newer auth retry wrapper should supersede the old guidance/);
  });
});

console.log("All inject tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-inject-"));

  try {
    await initBrain(projectRoot);
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
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
