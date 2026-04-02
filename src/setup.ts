import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBrainDir } from "./config.js";
import { initBrain } from "./store.js";

const POST_COMMIT_MARKER = "project-brain post-commit hook";
const POST_COMMIT_BACKUP_FILE = "post-commit.project-brain.bak";
const POST_COMMIT_HOOK = [
  "#!/usr/bin/env sh",
  "",
  `# ${POST_COMMIT_MARKER}`,
  "# Lightweight Codex workflow amplifier: extract repo knowledge from",
  "# the latest commit context when the `brain` command is available.",
  "",
  "if ! command -v brain >/dev/null 2>&1; then",
  "  exit 0",
  "fi",
  "",
  "brain extract-commit >/dev/null 2>&1 || true",
  "",
  "exit 0",
  "",
].join("\n");

export interface SetupOptions {
  gitHook?: boolean;
}

export interface SetupResult {
  brainDir: string;
  gitHook: {
    installed: boolean;
    hookPath?: string;
    backupPath?: string;
    message: string;
  };
}

export async function setupRepoBrain(
  projectRoot: string,
  options: SetupOptions = {},
): Promise<SetupResult> {
  await initBrain(projectRoot);

  const result: SetupResult = {
    brainDir: getBrainDir(projectRoot),
    gitHook: {
      installed: false,
      message: "Git hook installation skipped.",
    },
  };

  if (options.gitHook === false) {
    result.gitHook.message = 'Git hook installation skipped by "--no-git-hook".';
    return result;
  }

  const gitRoot = await resolveGitRoot(projectRoot);
  if (!gitRoot) {
    result.gitHook.message = "Not inside a Git repository, so the post-commit hook was skipped.";
    return result;
  }

  if (!samePath(gitRoot, projectRoot)) {
    result.gitHook.message = [
      `Current directory is not the Git root (${gitRoot}).`,
      `Skipped post-commit hook installation so hooks can still find ${path.join(getBrainDir(projectRoot), "config.yaml")}.`,
      `Run "brain setup" from ${gitRoot} if you want the Git hook installed there.`,
    ].join(" ");
    return result;
  }

  const installResult = await installPostCommitHook(gitRoot);
  result.gitHook = {
    installed: true,
    hookPath: installResult.hookPath,
    message: installResult.backupPath
      ? `Installed the post-commit hook at ${installResult.hookPath} and backed up the existing hook to ${installResult.backupPath}.`
      : `Installed the post-commit hook at ${installResult.hookPath}.`,
    ...(installResult.backupPath ? { backupPath: installResult.backupPath } : {}),
  };

  return result;
}

interface InstallPostCommitHookResult {
  hookPath: string;
  backupPath?: string;
}

async function installPostCommitHook(gitRoot: string): Promise<InstallPostCommitHookResult> {
  const hooksDir = path.join(gitRoot, ".git", "hooks");
  const hookPath = path.join(hooksDir, "post-commit");
  const backupPath = path.join(hooksDir, POST_COMMIT_BACKUP_FILE);

  await mkdir(hooksDir, { recursive: true });

  let existingHook = "";
  try {
    existingHook = await readFile(hookPath, "utf8");
  } catch {
    existingHook = "";
  }

  let wroteBackup = false;
  if (existingHook && !existingHook.includes(POST_COMMIT_MARKER)) {
    await copyFile(hookPath, backupPath);
    wroteBackup = true;
  }

  await writeFile(hookPath, POST_COMMIT_HOOK, "utf8");

  try {
    await chmod(hookPath, 0o755);
  } catch {
    // Best effort only. On Windows the executable bit is not meaningful.
  }

  return {
    hookPath,
    ...(wroteBackup ? { backupPath } : {}),
  };
}

async function resolveGitRoot(projectRoot: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["rev-parse", "--show-toplevel"], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const value = stdout.trim();
      resolve(value || null);
    });
  });
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left).replace(/[\\/]+$/, "").toLowerCase();
  const normalizedRight = path.resolve(right).replace(/[\\/]+$/, "").toLowerCase();
  return normalizedLeft === normalizedRight;
}
