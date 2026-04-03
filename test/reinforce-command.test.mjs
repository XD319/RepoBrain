import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initBrain, loadStoredMemoryRecords, saveMemory } from "../dist/store-api.js";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixturePath = path.join(repoRoot, "test", "fixtures", "reinforce-llm-fixture.mjs");
const fixtureCommand = `"${process.execPath}" "${fixturePath}"`;

await runTest("brain reinforce prints the no-op message when no failure event is detected", async () => {
  await withTempRepo(async (projectRoot) => {
    const result = await runCliProcess(
      ["reinforce", "--yes"],
      projectRoot,
      "The session completed cleanly.",
      {
        BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
        DETECT_MODE: "empty",
      },
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /\[brain\] 本次 session 未发现需要强化的记忆 ✓/);
  });
});

await runTest("brain reinforce applies actions immediately with --yes", async () => {
  await withTempRepo(async (projectRoot) => {
    const existingPath = await saveMemory(
      {
        type: "decision",
        title: "Keep payment writes inside the transaction helper",
        summary: "Route payment writes through the helper.",
        detail: "## DECISION\n\nAlways route payment writes through the transaction helper.",
        tags: ["payments"],
        importance: "high",
        date: "2026-04-01T08:00:00.000Z",
        score: 60,
        hit_count: 0,
        last_used: null,
        created_at: "2026-04-01",
        stale: false,
        status: "active",
      },
      projectRoot,
    );

    const result = await runCliProcess(
      ["reinforce", "--source", "git-commit", "--yes"],
      projectRoot,
      "fix(payments): bypassed transaction helper in refund flow",
      {
        BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
        DETECT_RELATED_FILE: path.basename(existingPath),
      },
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Detected 2 failure events:/);
    assert.match(result.stdout, /action=boost_score/);
    assert.match(result.stdout, /action=extract_new/);
    assert.match(result.stdout, /\[brain\] reinforcing:/);
    assert.match(result.stdout, /\[brain\] reinforcement complete: boosted=1, rewritten=0, extracted=1/);

    const existingRaw = await readFile(existingPath, "utf8");
    assert.match(existingRaw, /score: 75/);

    const records = await loadStoredMemoryRecords(projectRoot);
    const extracted = records.find((entry) => entry.memory.origin === "failure");
    assert.ok(extracted);
  });
});

console.log("All reinforce command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-reinforce-cli-"));

  try {
    await initBrain(projectRoot);
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function runCliProcess(args, cwd, stdinText = "", extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
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

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
