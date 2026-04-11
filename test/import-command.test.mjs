import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initBrain, loadStoredMemoryRecords } from "../dist/store-api.js";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixturePath = path.join(repoRoot, "test", "fixtures", "import-rules.md");

await runTest("brain import loads fixture rules and writes candidate memories", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const importedFile = path.join(projectRoot, "AGENTS.md");
    await copyFixture(importedFile, fixturePath);

    const result = await runCliProcess(["import", "AGENTS.md"], projectRoot);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Parsed 2 memories/i);
    assert.match(result.stdout, /wrote 2 candidates/i);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 2);
    assert.ok(records.every((entry) => entry.memory.status === "candidate"));
  });
});

await runTest("brain import --dry-run previews without writing files", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const importedFile = path.join(projectRoot, "AGENTS.md");
    await copyFixture(importedFile, fixturePath);

    const result = await runCliProcess(["import", "AGENTS.md", "--dry-run"], projectRoot);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /preview \| convention \| Team Conventions/i);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 0);
  });
});

await runTest("brain import --type overrides parsed memory types", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const importedFile = path.join(projectRoot, "CONVENTIONS.md");
    await copyFixture(importedFile, fixturePath);

    const result = await runCliProcess(["import", "CONVENTIONS.md", "--type", "pattern"], projectRoot);

    assert.equal(result.code, 0);
    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 2);
    assert.ok(records.every((entry) => entry.memory.type === "pattern"));
  });
});

await runTest("brain import writes candidates that show up in brain list", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const importedFile = path.join(projectRoot, "AGENTS.md");
    await copyFixture(importedFile, fixturePath);

    await runCliProcess(["import", "AGENTS.md"], projectRoot);
    const listResult = await runCliProcess(["list"], projectRoot);

    assert.equal(listResult.code, 0);
    assert.match(listResult.stdout, /\| candidate \| Team Conventions/);
  });
});

await runTest("brain import skips duplicates on repeated imports", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const importedFile = path.join(projectRoot, "AGENTS.md");
    await copyFixture(importedFile, fixturePath);

    const first = await runCliProcess(["import", "AGENTS.md"], projectRoot);
    const second = await runCliProcess(["import", "AGENTS.md"], projectRoot);

    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    assert.match(second.stdout, /skipped 2/i);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 2);
  });
});

console.log("All import command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-import-command-"));

  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function copyFixture(targetPath, sourcePath) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const contents = await import("node:fs/promises").then(({ readFile }) => readFile(sourcePath, "utf8"));
  await writeFile(targetPath, contents, "utf8");
}

async function runCliProcess(args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
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
  });
}

function runTest(name, callback) {
  it(name, callback);
}

const assert = {
  equal(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
  match(value, pattern, message) {
    expect(value, message).toMatch(pattern);
  },
};
