import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getSteeringRulesStatus, initBrain, writeSteeringRules } from "../dist/store-api.js";

await runTest("brain init helpers can generate both steering rules files", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "both");

    assert.deepEqual(writtenPaths, [
      ".claude/rules/brain-session.md",
      ".codex/brain-session.md",
    ]);

    const claudeContent = await readFile(path.join(projectRoot, ".claude", "rules", "brain-session.md"), "utf8");
    const codexContent = await readFile(path.join(projectRoot, ".codex", "brain-session.md"), "utf8");

    assert.match(claudeContent, /# RepoBrain 会话规则/);
    assert.match(claudeContent, /brain inject/);
    assert.match(codexContent, /# RepoBrain Codex 工作流/);
    assert.match(codexContent, /brain goal done <关键词>/);
  });
});

await runTest("brain status helper reports missing steering rules when neither file exists", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const status = await getSteeringRulesStatus(projectRoot);

    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: false,
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
    });
  });
});

console.log("All init/status command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-init-status-"));

  try {
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
