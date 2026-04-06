import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initBrain, loadStoredMemoryRecords } from "../dist/store-api.js";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixturePath = path.join(repoRoot, "test", "fixtures", "capture-fixture.mjs");
const fixtureCommand = `"${process.execPath}" "${fixturePath}"`;

await runTest("brain capture skips extraction when suggest-extract returns should_extract=false", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    const trivialPath = path.join(projectRoot, "typo.txt");
    await writeFile(trivialPath, "fix typo\n", "utf8");
    await runCommand("git", ["add", "typo.txt"], projectRoot);
    await runCommand("git", ["commit", "-m", "fix typo"], projectRoot);

    const result = await runCliProcess(["capture", "--task", "fix typo", "--path", "typo.txt"], projectRoot, {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Not recommended for extraction/);
    assert.match(result.stdout, /--force-candidate/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 0, "No memory should be saved when not recommended");
  });
});

await runTest("brain capture saves candidate when suggest-extract returns should_extract=true", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    const featurePath = path.join(projectRoot, "feature.txt");
    await writeFile(featurePath, "feature content\n", "utf8");
    await runCommand("git", ["add", "feature.txt"], projectRoot);
    await runCommand(
      "git",
      [
        "commit",
        "-m",
        "feat: decided to adopt a new payment gateway because the old one has race condition issues and data loss risk",
      ],
      projectRoot,
    );

    const result = await runCliProcess(
      [
        "capture",
        "--task",
        "decided to adopt new payment gateway because of race condition risk to avoid data loss",
        "--path",
        "src/payments/handler.ts,src/billing/processor.ts,src/api/routes.ts",
      ],
      projectRoot,
      { BRAIN_EXTRACTOR_COMMAND: fixtureCommand },
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Saved 1 memor/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1, "One candidate memory should be saved");
    assert.equal(records[0]?.memory.status, "candidate", "Memory must be saved as candidate");
  });
});

await runTest("brain capture --format json outputs structured JSON when skipped", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    await writeFile(path.join(projectRoot, "x.txt"), "x\n", "utf8");
    await runCommand("git", ["add", "x.txt"], projectRoot);
    await runCommand("git", ["commit", "-m", "fix typo"], projectRoot);

    const result = await runCliProcess(
      ["capture", "--format", "json", "--task", "fix typo", "--path", "x.txt"],
      projectRoot,
      { BRAIN_EXTRACTOR_COMMAND: fixtureCommand },
    );

    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.action, "skipped");
    assert.ok(parsed.suggestion, "JSON output should contain suggestion object");
    assert.equal(parsed.suggestion.should_extract, false);
    assert.deepEqual(parsed.saved_paths, []);
  });
});

await runTest("brain capture --format json outputs structured JSON when saved", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    await writeFile(path.join(projectRoot, "feat.txt"), "content\n", "utf8");
    await runCommand("git", ["add", "feat.txt"], projectRoot);
    await runCommand(
      "git",
      [
        "commit",
        "-m",
        "decided to adopt new cache layer because of race condition pitfall and must not use the old one",
      ],
      projectRoot,
    );

    const result = await runCliProcess(
      [
        "capture",
        "--format",
        "json",
        "--task",
        "decided to adopt new cache because race condition pitfall must not use old one to avoid data loss",
        "--path",
        "src/cache/layer.ts,src/db/pool.ts,src/api/handler.ts",
      ],
      projectRoot,
      { BRAIN_EXTRACTOR_COMMAND: fixtureCommand },
    );

    assert.equal(result.code, 0);
    const lines = result.stdout.split("\n");
    const jsonStart = lines.findIndex((l) => l.trim().startsWith("{"));
    const jsonContent = lines.slice(jsonStart).join("\n");
    const parsed = JSON.parse(jsonContent);
    assert.equal(parsed.action, "saved_as_candidate");
    assert.ok(parsed.saved_paths.length > 0, "Should have saved paths");
    assert.equal(parsed.suggestion.should_extract, true);
  });
});

await runTest("brain capture --force-candidate saves even with ambiguous signals", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    await writeFile(path.join(projectRoot, "file.txt"), "content\n", "utf8");
    await runCommand("git", ["add", "file.txt"], projectRoot);
    await runCommand("git", ["commit", "-m", "update file handling approach"], projectRoot);

    const result = await runCliProcess(
      ["capture", "--force-candidate", "--task", "updated file handling with a pattern helper", "--path", "file.txt"],
      projectRoot,
      { BRAIN_EXTRACTOR_COMMAND: fixtureCommand },
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Saved 1 memor/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.memory.status, "candidate");
  });
});

await runTest("brain capture uses suggested_type from detection", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    await writeFile(path.join(projectRoot, "handler.ts"), "export function handle() {}\n", "utf8");
    await runCommand("git", ["add", "handler.ts"], projectRoot);
    await runCommand(
      "git",
      [
        "commit",
        "-m",
        "gotcha: beware of race condition in payment handler - never call refund without lock because data loss",
      ],
      projectRoot,
    );

    const result = await runCliProcess(
      [
        "capture",
        "--task",
        "beware of race condition pitfall in payment handler - must not call refund without lock to avoid data loss",
        "--path",
        "src/payments/handler.ts,src/billing/refund.ts,src/locks/manager.ts",
      ],
      projectRoot,
      { BRAIN_EXTRACTOR_COMMAND: fixtureCommand },
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Saved 1 memor/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.memory.status, "candidate");
  });
});

await runTest("brain capture does not break existing brain extract", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);

    const result = await runCliProcess(
      ["extract", "--candidate"],
      projectRoot,
      { BRAIN_EXTRACTOR_COMMAND: fixtureCommand },
      "Task: decided to adopt ESM because of better tree shaking\n\nChanged files:\nsrc/config.ts\nsrc/main.ts\nsrc/utils/helpers.ts\n",
    );

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Reviewed 1 extracted memory\./);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.memory.status, "candidate");
  });
});

console.log("All capture command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-capture-"));

  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function runCliProcess(args, cwd, extraEnv = {}, stdinText = undefined) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: [stdinText !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
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

    if (stdinText !== undefined) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }

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

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(stderr || `${command} ${args.join(" ")} exited with code ${code}`));
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
  strictEqual(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  notEqual(actual, expected, message) {
    expect(actual, message).not.toBe(expected);
  },
  deepEqual(actual, expected, message) {
    expect(actual, message).toEqual(expected);
  },
  notDeepEqual(actual, expected, message) {
    expect(actual, message).not.toEqual(expected);
  },
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
  match(value, pattern, message) {
    expect(value, message).toMatch(pattern);
  },
  doesNotMatch(value, pattern, message) {
    expect(value, message).not.toMatch(pattern);
  },
  throws(action, matcher, message) {
    if (matcher === undefined) {
      expect(action, message).toThrow();
      return;
    }
    expect(action, message).toThrow(matcher);
  },
  async rejects(action, matcher, message) {
    let failure;
    try {
      await action();
    } catch (error) {
      failure = error;
    }
    expect(failure, message ?? "expected promise to reject").toBeTruthy();
    if (typeof matcher === "function") {
      const handled = matcher(failure);
      expect(handled, message ?? "reject matcher should confirm the error").toBe(true);
      return;
    }
    if (matcher instanceof RegExp) {
      expect(failure.message, message).toMatch(matcher);
      return;
    }
    if (matcher && typeof matcher === "object") {
      expect(failure, message).toMatchObject(matcher);
    }
  },
  fail(message) {
    throw new Error(message ?? "assert.fail was called");
  },
};
