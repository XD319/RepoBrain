import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { initBrain, loadStoredMemoryRecords } from "../dist/store-api.js";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixturePath = path.join(repoRoot, "test", "fixtures", "extract-commit-fixture.mjs");
const fixtureCommand = `"${process.execPath}" "${fixturePath}"`;

await runTest("brain extract-commit feeds richer commit context into the extractor", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await runCommand("git", ["init"], projectRoot);
    await runCommand("git", ["config", "user.name", "RepoBrain Test"], projectRoot);
    await runCommand("git", ["config", "user.email", "repobrain@example.com"], projectRoot);

    const featurePath = path.join(projectRoot, "feature.txt");
    await writeFile(featurePath, "feature-on\n", "utf8");
    await runCommand("git", ["add", "feature.txt"], projectRoot);
    await runCommand("git", ["commit", "-m", "feat: add commit extraction input"], projectRoot);

    const result = await runCliProcess(["extract-commit", "--candidate"], projectRoot, {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Reviewed 1 extracted memory\./);
    assert.match(result.stdout, /Use richer git commit context for extraction/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.memory.source, "git-commit");
    assert.equal(records[0]?.memory.status, "candidate");
  });
});

console.log("All extract-commit command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-extract-commit-"));

  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
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
