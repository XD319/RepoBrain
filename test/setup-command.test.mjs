import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");

await runTest("brain setup initializes .brain and installs the post-commit hook", async () => {
  await withTempRepo(async (projectRoot) => {
    await runCommand("git", ["init"], projectRoot);

    const result = await runCliProcess(["setup"], projectRoot);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Initialized RepoBrain in/);
    assert.match(result.stdout, /Installed the post-commit hook at/);
    assert.match(result.stdout, /Workflow: Recommended semi-auto/);
    assert.match(result.stdout, /Steering rules:/);

    await access(path.join(projectRoot, ".brain", "config.yaml"));
    await access(path.join(projectRoot, ".claude", "rules", "brain-session.md"));
    await access(path.join(projectRoot, ".codex", "brain-session.md"));

    const configRaw = await readFile(path.join(projectRoot, ".brain", "config.yaml"), "utf8");
    assert.match(configRaw, /workflowMode: recommended-semi-auto/);
    assert.match(configRaw, /extractMode: suggest/);

    const hookContent = await readFile(path.join(projectRoot, ".git", "hooks", "post-commit"), "utf8");
    assert.match(hookContent, /project-brain post-commit hook/);
    assert.match(hookContent, /brain extract-commit/);
  });
});

await runTest("brain setup backs up an existing custom post-commit hook before installing its own", async () => {
  await withTempRepo(async (projectRoot) => {
    await runCommand("git", ["init"], projectRoot);

    const existingHookPath = path.join(projectRoot, ".git", "hooks", "post-commit");
    const existingHook = "#!/usr/bin/env sh\necho custom-hook\n";
    await writeFile(existingHookPath, existingHook, "utf8");

    const result = await runCliProcess(["setup"], projectRoot);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /backed up the existing hook/);

    const backupPath = path.join(projectRoot, ".git", "hooks", "post-commit.project-brain.bak");
    const backupContent = await readFile(backupPath, "utf8");
    assert.equal(backupContent, existingHook);
  });
});

await runTest("brain setup respects the ultra-safe manual workflow preset", async () => {
  await withTempRepo(async (projectRoot) => {
    await runCommand("git", ["init"], projectRoot);

    const result = await runCliProcess(["setup", "--workflow", "ultra-safe-manual"], projectRoot);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Workflow: Ultra-safe manual/);
    assert.match(result.stdout, /Git hook installation skipped/);

    const configRaw = await readFile(path.join(projectRoot, ".brain", "config.yaml"), "utf8");
    assert.match(configRaw, /workflowMode: ultra-safe-manual/);
    assert.match(configRaw, /extractMode: manual/);
    assert.match(configRaw, /sweepOnInject: false/);
  });
});

console.log("All setup command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-setup-"));

  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function runCliProcess(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
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

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
