import { spawn } from "node:child_process";

export async function buildCommitExtractionInput(projectRoot: string, revision = "HEAD"): Promise<string> {
  const commitMetadata = await runGitCommand(projectRoot, [
    "show",
    "-s",
    "--date=iso-strict",
    "--format=commit %H%nAuthor: %an <%ae>%nDate: %ad%n%nSubject: %s%n%nBody:%n%b",
    revision,
  ]);
  const changedFiles = await runGitCommand(projectRoot, ["show", "--name-status", "--format=", revision]);
  const diffStat = await runGitCommand(projectRoot, ["show", "--stat=200,120", "--format=", revision]);

  return [
    "Source: git-commit",
    `Revision: ${revision}`,
    "",
    "## Commit metadata",
    commitMetadata.trim(),
    "",
    "## Changed files",
    changedFiles.trim() || "_No changed files reported._",
    "",
    "## Diff stat",
    diffStat.trim() || "_No diff stat reported._",
  ].join("\n");
}

async function runGitCommand(projectRoot: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `git ${args.join(" ")} exited with code ${code}`));
    });
  });
}
