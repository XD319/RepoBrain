import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initBrain, loadAllMemories, loadStoredMemoryRecords, saveMemory } from "../dist/store-api.js";

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
    assert.equal(memory.invocation_mode, "optional");
    assert.equal(memory.risk_level, "low");
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
      invocation_mode: "prefer",
      risk_level: "medium",
    };

    const filePath = await saveMemory(memory, projectRoot);
    const raw = await readFile(filePath, "utf8");

    assert.match(raw, /path_scope:/);
    assert.match(raw, /recommended_skills:/);
    assert.match(raw, /required_skills:/);
    assert.match(raw, /suppressed_skills:/);
    assert.match(raw, /skill_trigger_paths:/);
    assert.match(raw, /skill_trigger_tasks:/);
    assert.match(raw, /invocation_mode: "prefer"/);
    assert.match(raw, /risk_level: "medium"/);

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
    assert.equal(stored.invocation_mode, "prefer");
    assert.equal(stored.risk_level, "medium");
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
