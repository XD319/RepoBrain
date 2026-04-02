import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildInjection } from "../dist/inject.js";
import { initBrain, loadStoredMemoryRecords, saveMemory } from "../dist/store-api.js";

const DEFAULT_BRAIN_CONFIG = {
  maxInjectTokens: 1200,
  extractMode: "suggest",
  language: "zh-CN",
};

await runTest("inject sorts memories by computed injection priority", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Lower priority decision",
        summary: "This entry has lower computed priority.",
        detail: "## DECISION\n\nThis entry should appear after the higher-priority gotcha.",
        tags: ["priority"],
        importance: "high",
        date: "2026-04-01T08:00:00.000Z",
        score: 55,
        hit_count: 0,
        last_used: null,
        created_at: "2026-04-01",
        status: "active",
        stale: false,
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "gotcha",
        title: "Higher priority gotcha",
        summary: "This entry should win because its computed priority is higher.",
        detail: "## GOTCHA\n\nThis entry should appear first after sorting by injection priority.",
        tags: ["priority"],
        importance: "medium",
        date: "2026-04-01T09:00:00.000Z",
        score: 80,
        hit_count: 4,
        last_used: null,
        created_at: "2026-04-01",
        status: "active",
        stale: false,
      },
      projectRoot,
    );

    const injection = await buildInjection(projectRoot, DEFAULT_BRAIN_CONFIG);
    assert.ok(
      injection.indexOf("Higher priority gotcha") < injection.indexOf("Lower priority decision"),
      "expected inject to follow computeInjectPriority ordering",
    );
    assert.match(injection, /\[RepoBrain\] 已注入 2\/2 条记忆/);
  });
});

await runTest("inject keeps task-aware rationale in the rendered output", async () => {
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

await runTest("inject skips stale memories, reports them, and updates usage metadata atomically", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "gotcha",
        title: "Skip stale memory",
        summary: "This should not be injected.",
        detail: "## GOTCHA\n\nStale memory should be skipped.",
        tags: ["stale"],
        importance: "high",
        date: "2026-04-01T08:00:00.000Z",
        score: 95,
        hit_count: 7,
        last_used: "2026-04-01",
        created_at: "2026-04-01",
        status: "active",
        stale: true,
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Inject active memory",
        summary: "This should be injected and updated.",
        detail: "## DECISION\n\nActive memory should be injected and usage metadata should update.",
        tags: ["active"],
        importance: "medium",
        date: "2026-04-01T09:00:00.000Z",
        score: 65,
        hit_count: 1,
        last_used: null,
        created_at: "2026-04-01",
        status: "active",
        stale: false,
      },
      projectRoot,
    );

    const injection = await buildInjection(projectRoot, DEFAULT_BRAIN_CONFIG);
    assert.doesNotMatch(injection, /Skip stale memory/);
    assert.match(injection, /Inject active memory/);
    assert.match(injection, /\[RepoBrain\] 已注入 1\/1 条记忆/);
    assert.match(injection, /⚠ 有 1 条记忆已标记为过期，运行 brain score 查看/);

    const records = await loadStoredMemoryRecords(projectRoot);
    const staleRecord = records.find((entry) => entry.memory.title === "Skip stale memory");
    const activeRecord = records.find((entry) => entry.memory.title === "Inject active memory");

    assert.ok(staleRecord);
    assert.ok(activeRecord);
    assert.equal(staleRecord.memory.hit_count, 7);
    assert.equal(staleRecord.memory.last_used, "2026-04-01");
    assert.equal(activeRecord.memory.hit_count, 2);
    assert.match(activeRecord.memory.last_used ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(activeRecord.memory.stale, false);
  });
});

await runTest("inject filters superseded lineage entries and prefixes newer versions", async () => {
  await withTempRepo(async (projectRoot) => {
    const oldDate = "2026-04-01T08:00:00.000Z";
    const newDate = "2026-04-01T09:00:00.000Z";
    const newRelativePath = buildExpectedBrainRelativePath("decision", "Use the new deploy gate", newDate);

    await saveMemory(
      {
        type: "decision",
        title: "Use the old deploy gate",
        summary: "Legacy guidance that should be hidden once replaced.",
        detail: "## DECISION\n\nThe old deploy gate is kept only for history.",
        tags: ["deploy"],
        importance: "medium",
        date: oldDate,
        status: "active",
        superseded_by: newRelativePath,
      },
      projectRoot,
    );

    const oldRelativePath = buildExpectedBrainRelativePath("decision", "Use the old deploy gate", oldDate);

    await saveMemory(
      {
        type: "decision",
        title: "Use the new deploy gate",
        summary: "Current guidance that replaces the old gate.",
        detail: "## DECISION\n\nOnly the new deploy gate should be injected.",
        tags: ["deploy"],
        importance: "high",
        date: newDate,
        status: "active",
        supersedes: oldRelativePath,
        version: 2,
      },
      projectRoot,
    );

    const injection = await buildInjection(projectRoot, DEFAULT_BRAIN_CONFIG);
    assert.match(injection, /\[更新 v2\] Use the new deploy gate/);
    assert.match(injection, /Only the new deploy gate should be injected/);
    assert.doesNotMatch(injection, /Use the old deploy gate/);
    assert.match(injection, /\[RepoBrain\].*1\/1/);
  });
});

await runTest("inject warns when supersedes lineage is not fully linked back", async () => {
  await withTempRepo(async (projectRoot) => {
    const oldDate = "2026-04-01T08:00:00.000Z";
    const oldRelativePath = buildExpectedBrainRelativePath("decision", "Old cache guidance", oldDate);

    await saveMemory(
      {
        type: "decision",
        title: "Old cache guidance",
        summary: "Older guidance still missing the backlink.",
        detail: "## DECISION\n\nOld cache guidance.",
        tags: ["cache"],
        importance: "medium",
        date: oldDate,
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "New cache guidance",
        summary: "Newer guidance points back to the old file.",
        detail: "## DECISION\n\nNew cache guidance.",
        tags: ["cache"],
        importance: "high",
        date: "2026-04-01T09:00:00.000Z",
        status: "active",
        supersedes: oldRelativePath,
        version: 2,
      },
      projectRoot,
    );

    const result = await runNodeProcess([path.join(process.cwd(), "dist", "cli.js"), "inject"], projectRoot);
    assert.equal(result.code, 0);
    assert.match(
      result.stderr,
      /⚠ \[brain\] 血缘不一致: decisions\/2026-04-01-old-cache-guidance-080000000\.md 应设置 superseded_by: decisions\//,
    );
    assert.match(result.stdout, /\[更新 v2\] New cache guidance/);
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

async function runNodeProcess(args, cwd, stdinText = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });

    child.stdin.end(stdinText);
  });
}

function buildExpectedBrainRelativePath(type, title, date) {
  return `${directoryByType(type)}/${date.slice(0, 10)}-${slugifyTitle(title)}-${date.replace(/[^\d]/g, "").slice(8, 17)}.md`;
}

function directoryByType(type) {
  switch (type) {
    case "decision":
      return "decisions";
    case "gotcha":
      return "gotchas";
    case "convention":
      return "conventions";
    case "pattern":
      return "patterns";
    default:
      throw new Error(`Unsupported memory type: ${type}`);
  }
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
