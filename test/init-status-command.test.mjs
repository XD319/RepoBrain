import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getSteeringRulesStatus, initBrain, writeSteeringRules } from "../dist/store-api.js";

await runTest("brain init helpers can generate all steering rules files", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "all");

    assert.deepEqual(writtenPaths, [
      ".claude/rules/brain-session.md",
      ".codex/brain-session.md",
      ".cursor/rules/brain-session.mdc",
    ]);

    const claudeContent = await readFile(path.join(projectRoot, ".claude", "rules", "brain-session.md"), "utf8");
    const codexContent = await readFile(path.join(projectRoot, ".codex", "brain-session.md"), "utf8");
    const cursorContent = await readFile(path.join(projectRoot, ".cursor", "rules", "brain-session.mdc"), "utf8");

    assert.match(claudeContent, /# RepoBrain 会话规则/);
    assert.match(claudeContent, /brain inject/);
    assert.match(codexContent, /# RepoBrain 会话规则（Codex）/);
    assert.match(codexContent, /brain inject/);
    assert.match(cursorContent, /alwaysApply: true/);
    assert.match(cursorContent, /brain inject/);
  });
});

await runTest("brain init helpers generate only claude and codex with both for backward compatibility", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "both");

    assert.deepEqual(writtenPaths, [
      ".claude/rules/brain-session.md",
      ".codex/brain-session.md",
      ".cursor/rules/brain-session.mdc",
    ]);
  });
});

await runTest("brain status helper reports missing steering rules when no file exists", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const status = await getSteeringRulesStatus(projectRoot);

    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: false,
      cursorConfigured: false,
    });
  });
});

await runTest("brain status helper reports configured steering rules independently", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await writeSteeringRules(projectRoot, "codex");

    const status = await getSteeringRulesStatus(projectRoot);
    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: true,
      cursorConfigured: false,
    });
  });
});

await runTest("brain init helpers can generate cursor steering rules independently", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "cursor");

    assert.deepEqual(writtenPaths, [
      ".cursor/rules/brain-session.mdc",
    ]);

    const status = await getSteeringRulesStatus(projectRoot);
    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: false,
      cursorConfigured: true,
    });
  });
});

console.log("All init/status command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-init-status-"));

  try {
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
