import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(path.join(projectRoot, ".repobrain-pack-smoke-"));

try {
  const packDir = path.join(tempRoot, "pack");
  const unpackDir = path.join(tempRoot, "unpacked");
  const sampleRepo = path.join(tempRoot, "sample-repo");

  await mkdir(packDir, { recursive: true });
  await mkdir(unpackDir, { recursive: true });
  await mkdir(sampleRepo, { recursive: true });

  const packResult = await runNpmCommand(["pack", "--json", "--pack-destination", packDir], {
    cwd: projectRoot,
  });
  const packedFiles = JSON.parse(packResult.stdout);
  assert.ok(Array.isArray(packedFiles) && packedFiles.length === 1, "npm pack should return one tarball record.");

  const tarballName = packedFiles[0]?.filename;
  assert.equal(typeof tarballName, "string");

  const tarballPath = path.join(packDir, tarballName);
  await runCommand("tar", ["-xf", tarballPath, "-C", unpackDir], {
    cwd: projectRoot,
  });

  const packageRoot = path.join(unpackDir, "package");
  const cliPath = path.join(packageRoot, "dist", "cli.js");

  for (const relativePath of [
    "README.md",
    "README.zh-CN.md",
    "docs/demo-script.md",
    "docs/demo-script.zh-CN.md",
    "docs/team-workflow.md",
    "docs/team-workflow.zh-CN.md",
    "docs/release-checklist.md",
    "docs/release-checklist.zh-CN.md",
  ]) {
    await access(path.join(packageRoot, relativePath));
  }

  await runCommand("git", ["init"], {
    cwd: sampleRepo,
  });

  const setupResult = await runCommand("node", [cliPath, "setup", "--no-git-hook"], {
    cwd: sampleRepo,
  });
  assert.match(setupResult.stdout, /Initialized RepoBrain/);

  const summary = [
    "gotcha: ESLint no-unused-vars conflicts with TypeScript noUnusedLocals",
    "",
    "When TypeScript is already enforcing unused locals, enabling both rules creates duplicate warnings and noisy agent feedback. In this repo, prefer TypeScript for the hard error and tune ESLint so the same issue is not reported twice.",
    "",
  ].join("\n");

  const extractResult = await runCommand("node", [cliPath, "extract"], {
    cwd: sampleRepo,
    stdinText: summary,
  });
  assert.match(extractResult.stdout, /Reviewed 1 extracted memory\./);
  assert.match(extractResult.stdout, /Saved 1 memory\./);

  const listResult = await runCommand("node", [cliPath, "list"], {
    cwd: sampleRepo,
  });
  assert.match(listResult.stdout, /ESLint no-unused-vars conflicts with TypeScript noUnusedLocals/);

  const injectResult = await runCommand("node", [cliPath, "inject"], {
    cwd: sampleRepo,
  });
  assert.match(injectResult.stdout, /Project Brain: Repo Knowledge Context/);
  assert.match(injectResult.stdout, /ESLint no-unused-vars conflicts with TypeScript noUnusedLocals/);

  const statusResult = await runCommand("node", [cliPath, "status"], {
    cwd: sampleRepo,
  });
  assert.match(statusResult.stdout, /Total memories: 1/);

  console.log("Package smoke test passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
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
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          [
            `Command failed: ${command} ${args.join(" ")}`,
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      );
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
    }
    child.stdin.end();
  });
}

function runNpmCommand(args, options) {
  if (process.platform === "win32") {
    return runCommand("cmd.exe", ["/d", "/s", "/c", "npm", ...args], options);
  }

  return runCommand("npm", args, options);
}
