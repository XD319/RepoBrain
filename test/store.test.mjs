import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  initBrain,
  loadAllMemories,
  loadConfig,
  loadStoredMemoryRecords,
  renderConfigWarnings,
  saveMemory,
} from "../dist/store-api.js";

const repoRoot = process.cwd();

await runTest("legacy .brain entries load with safe skill routing defaults", async () => {
  await withTempRepo(async (projectRoot) => {
    const legacyPath = path.join(projectRoot, ".brain", "decisions", "2026-03-31-legacy.md");
    await writeFile(
      legacyPath,
      [
        "---",
        'type: "decision"',
        'title: "Keep legacy entries compatible"',
        'summary: "Old entries should still load without new routing metadata."',
        "tags:",
        '  - "compatibility"',
        'importance: "medium"',
        'date: "2026-03-31T08:00:00.000Z"',
        'source: "manual"',
        "---",
        "",
        "## DECISION",
        "",
        "Legacy entries should continue to load after the schema expands.",
        "",
      ].join("\n"),
      "utf8",
    );

    const memories = await loadAllMemories(projectRoot);
    assert.equal(memories.length, 1);

    const memory = memories[0];
    assert.ok(memory);
    assert.deepEqual(memory.path_scope, []);
    assert.deepEqual(memory.recommended_skills, []);
    assert.deepEqual(memory.required_skills, []);
    assert.deepEqual(memory.suppressed_skills, []);
    assert.deepEqual(memory.skill_trigger_paths, []);
    assert.deepEqual(memory.skill_trigger_tasks, []);
    assert.equal(memory.score, 60);
    assert.equal(memory.hit_count, 0);
    assert.equal(memory.last_used, null);
    assert.equal(memory.created_at, "2026-03-31T08:00:00.000Z");
    assert.equal(memory.stale, false);
    assert.equal(memory.invocation_mode, "optional");
    assert.equal(memory.risk_level, "low");
    assert.equal(memory.origin, undefined);
  });
});

await runTest("new skill routing fields round-trip through save and load", async () => {
  await withTempRepo(async (projectRoot) => {
    const memory = {
      type: "decision",
      title: "Route E2E work to the Playwright skill",
      summary: "Prefer the Playwright skill when browser test files or tasks are involved.",
      detail: [
        "## DECISION",
        "",
        "Route Playwright-heavy work to the Playwright skill when the task touches browser tests.",
      ].join("\n"),
      tags: ["skills", "routing"],
      importance: "high",
      date: "2026-04-01T10:00:00.000Z",
      source: "manual",
      status: "active",
      path_scope: ["src/browser/", "src/web/**"],
      recommended_skills: ["github:gh-fix-ci"],
      required_skills: ["playwright"],
      suppressed_skills: ["imagegen"],
      skill_trigger_paths: ["tests/e2e/", "playwright.config.ts"],
      skill_trigger_tasks: ["debug flaky browser tests"],
      score: 82,
      hit_count: 4,
      last_used: "2026-04-01T18:30:00.000Z",
      created_at: "2026-04-01T10:00:00.000Z",
      stale: true,
      invocation_mode: "prefer",
      risk_level: "medium",
      origin: "failure",
    };

    const filePath = await saveMemory(memory, projectRoot);
    const raw = await readFile(filePath, "utf8");

    assert.match(raw, /path_scope:/);
    assert.match(raw, /recommended_skills:/);
    assert.match(raw, /required_skills:/);
    assert.match(raw, /suppressed_skills:/);
    assert.match(raw, /skill_trigger_paths:/);
    assert.match(raw, /skill_trigger_tasks:/);
    assert.match(raw, /score: 82/);
    assert.match(raw, /hit_count: 4/);
    assert.match(raw, /last_used: "2026-04-01T18:30:00.000Z"/);
    assert.match(raw, /created_at: "2026-04-01T10:00:00.000Z"/);
    assert.match(raw, /stale: true/);
    assert.match(raw, /invocation_mode: "prefer"/);
    assert.match(raw, /risk_level: "medium"/);
    assert.match(raw, /origin: "failure"/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1);

    const stored = records[0]?.memory;
    assert.ok(stored);
    assert.deepEqual(stored.path_scope, ["src/browser/", "src/web/**"]);
    assert.deepEqual(stored.recommended_skills, ["github:gh-fix-ci"]);
    assert.deepEqual(stored.required_skills, ["playwright"]);
    assert.deepEqual(stored.suppressed_skills, ["imagegen"]);
    assert.deepEqual(stored.skill_trigger_paths, ["tests/e2e/", "playwright.config.ts"]);
    assert.deepEqual(stored.skill_trigger_tasks, ["debug flaky browser tests"]);
    assert.equal(stored.score, 82);
    assert.equal(stored.hit_count, 4);
    assert.equal(stored.last_used, "2026-04-01T18:30:00.000Z");
    assert.equal(stored.created_at, "2026-04-01T10:00:00.000Z");
    assert.equal(stored.stale, true);
    assert.equal(stored.invocation_mode, "prefer");
    assert.equal(stored.risk_level, "medium");
    assert.equal(stored.origin, "failure");
  });
});

await runTest("inject updates usage metadata on selected memories", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Track injection usage metadata",
        summary: "Injected memories should update hit_count and last_used.",
        detail: "## DECISION\n\nTrack usage metadata when a memory is injected.",
        tags: ["metrics"],
        importance: "medium",
        date: "2026-04-01T08:00:00.000Z",
        score: 60,
        hit_count: 1,
        last_used: null,
        created_at: "2026-04-01T08:00:00.000Z",
        stale: false,
        status: "active",
      },
      projectRoot,
    );

    const result = await runNodeProcess(
      [path.join(repoRoot, "dist", "cli.js"), "inject"],
      projectRoot,
    );

    assert.equal(result.code, 0);

    const memories = await loadAllMemories(projectRoot);
    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.hit_count, 2);
    assert.equal(memories[0]?.stale, false);
    assert.ok(memories[0]?.last_used);
  });
});

await runTest("same-title active memories with different scopes do not supersede each other", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Cache invalidation rules",
        summary: "API cache invalidation should happen after mutation commits.",
        detail:
          "## DECISION\n\nAPI cache invalidation should happen after mutation commits so readers do not observe partial state.",
        tags: ["cache", "api"],
        importance: "medium",
        date: "2026-04-01T08:00:00.000Z",
        status: "active",
        path_scope: ["src/api/**"],
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Cache invalidation rules",
        summary: "Web cache invalidation should happen after optimistic updates settle.",
        detail:
          "## DECISION\n\nWeb cache invalidation should happen after optimistic updates settle so the UI does not discard newer local state.",
        tags: ["cache", "web"],
        importance: "medium",
        date: "2026-04-01T09:00:00.000Z",
        status: "active",
        path_scope: ["src/web/**"],
      },
      projectRoot,
    );

    const memories = await loadAllMemories(projectRoot);
    const activeMemories = memories.filter((memory) => memory.status === "active");

    assert.equal(activeMemories.length, 2);
    assert.deepEqual(
      activeMemories.map((memory) => memory.path_scope),
      [["src/web/**"], ["src/api/**"]],
    );
  });
});

await runTest("invalid invocation_mode in stored memory fails with a clear parse error", async () => {
  await withTempRepo(async (projectRoot) => {
    const invalidPath = path.join(projectRoot, ".brain", "decisions", "2026-04-01-invalid-mode.md");
    await writeFile(
      invalidPath,
      [
        "---",
        'type: "decision"',
        'title: "Broken routing mode"',
        'summary: "This entry should fail validation."',
        "tags:",
        'importance: "medium"',
        'date: "2026-04-01T09:00:00.000Z"',
        'invocation_mode: "sometimes"',
        "---",
        "",
        "## DECISION",
        "",
        "This file intentionally uses an invalid invocation mode.",
        "",
      ].join("\n"),
      "utf8",
    );

    await assert.rejects(
      async () => loadAllMemories(projectRoot),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /invalid-mode\.md/);
        assert.match(error.message, /unsupported invocation_mode "sometimes"/);
        assert.match(error.message, /required, prefer, optional, suppress/);
        return true;
      },
    );
  });
});

await runTest("invalid risk_level is rejected during save with a clear validation error", async () => {
  await withTempRepo(async (projectRoot) => {
    const invalidMemory = {
      type: "decision",
      title: "Broken risk metadata",
      summary: "This entry should fail validation before it is written.",
      detail: "## DECISION\n\nThis file intentionally uses an invalid risk level.",
      tags: ["skills"],
      importance: "medium",
      date: "2026-04-01T11:00:00.000Z",
      risk_level: "urgent",
    };

    await assert.rejects(
      async () => saveMemory(invalidMemory, projectRoot),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /unsupported risk_level "urgent"/);
        assert.match(error.message, /high, medium, low/);
        return true;
      },
    );
  });
});

await runTest("invalid score in stored memory fails with a clear parse error", async () => {
  await withTempRepo(async (projectRoot) => {
    const invalidPath = path.join(projectRoot, ".brain", "decisions", "2026-04-01-invalid-score.md");
    await writeFile(
      invalidPath,
      [
        "---",
        'type: "decision"',
        'title: "Broken score metadata"',
        'summary: "This entry should fail validation."',
        "tags:",
        'importance: "medium"',
        'date: "2026-04-01T09:00:00.000Z"',
        'score: "very-good"',
        "---",
        "",
        "## DECISION",
        "",
        "This file intentionally uses an invalid score.",
        "",
      ].join("\n"),
      "utf8",
    );

    await assert.rejects(
      async () => loadAllMemories(projectRoot),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /invalid-score\.md/);
        assert.match(error.message, /invalid score/);
        assert.match(error.message, /0 and 100/);
        return true;
      },
    );
  });
});

await runTest("legacy remote review config fields are ignored with a deprecation warning", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "maxInjectTokens: 1200",
        "extractMode: suggest",
        "language: zh-CN",
        "reviewProvider: openai",
        "reviewModel: gpt-5",
        "reviewApiKey: should-not-be-used",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    const warnings = renderConfigWarnings(config);

    assert.equal(config.extractMode, "suggest");
    assert.equal(config.maxInjectTokens, 1200);
    assert.equal(config.language, "zh-CN");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Ignoring deprecated remote review config fields/);
    assert.match(warnings[0], /reviewApiKey/);
    assert.match(warnings[0], /reviewModel/);
    assert.match(warnings[0], /reviewProvider/);
  });
});

await runTest("cli extract does not crash or call any remote path when legacy review config fields remain", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "maxInjectTokens: 1200",
        "extractMode: suggest",
        "language: zh-CN",
        "provider: anthropic",
        "model: claude-sonnet",
        "apiKey: should-not-be-used",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runNodeProcess(
      [path.join(repoRoot, "dist", "cli.js"), "extract", "--source", "session"],
      projectRoot,
      [
        "decision: Keep API writes inside a transaction helper",
        "",
        "Mutation-heavy API flows should route writes through the transaction helper for consistency and rollback safety.",
      ].join("\n"),
    );

    assert.equal(result.code, 0);
    assert.match(result.stderr, /Ignoring deprecated remote review config fields/);
    assert.match(result.stdout, /decision=accept|accept \|/i);

    const memories = await loadAllMemories(projectRoot);
    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.title, "Keep API writes inside a transaction helper");
  });
});

await runTest("cli extract writes initial memory metadata with legal frontmatter ordering", async () => {
  await withTempRepo(async (projectRoot) => {
    const result = await runNodeProcess(
      [path.join(repoRoot, "dist", "cli.js"), "extract", "--source", "session"],
      projectRoot,
      [
        "gotcha: Never write payments outside the transaction helper",
        "",
        "Critical payments updates must stay inside the transaction helper or partial writes can leak into ledger sync.",
      ].join("\n"),
    );

    assert.equal(result.code, 0);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1);

    const stored = records[0];
    assert.ok(stored);
    assert.equal(stored.memory.type, "gotcha");
    assert.equal(stored.memory.importance, "high");
    assert.equal(stored.memory.score, 75);
    assert.equal(stored.memory.hit_count, 0);
    assert.equal(stored.memory.last_used, null);
    assert.equal(stored.memory.created_at?.length, 10);
    assert.equal(stored.memory.stale, false);

    const raw = await readFile(stored.filePath, "utf8");
    const scoreIndex = raw.indexOf('score: 75');
    const hitCountIndex = raw.indexOf('hit_count: 0');
    const lastUsedIndex = raw.indexOf('last_used: null');
    const createdAtIndex = raw.indexOf('created_at: "');
    const staleIndex = raw.indexOf('stale: false');
    const dateIndex = raw.indexOf('date: "');

    assert.ok(scoreIndex > raw.indexOf('importance: "high"'));
    assert.ok(hitCountIndex > scoreIndex);
    assert.ok(lastUsedIndex > hitCountIndex);
    assert.ok(createdAtIndex > lastUsedIndex);
    assert.ok(staleIndex > createdAtIndex);
    assert.ok(dateIndex > staleIndex);
    assert.match(raw, /created_at: "\d{4}-\d{2}-\d{2}"/);
  });
});

console.log("All store schema tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-store-"));

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
