import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [
  "test/store.test.mjs",
  "test/extract.test.mjs",
  "test/memory-priority.test.mjs",
  "test/reviewer.test.mjs",
  "test/suggest-skills.test.mjs",
  "test/inject.test.mjs",
  "test/sweep.test.mjs",
  "test/setup-command.test.mjs",
  "test/init-status-command.test.mjs",
  "test/extract-commit-command.test.mjs",
  "test/approve-safe-command.test.mjs",
  "test/audit-memory.test.mjs",
  "test/failure-detector.test.mjs",
  "test/reinforce.test.mjs",
  "test/reinforce-command.test.mjs",
  "test/session-end-hook.test.mjs",
  "test/score.test.mjs",
  "test/package-manifest.test.mjs",
  "test/demo-proof.test.mjs",
  "test/proof-evals.test.mjs",
  "test/integrations.test.mjs",
];

for (const relativePath of testFiles) {
  console.log(`\n==> ${relativePath}`);
  await runNode(relativePath);
}

async function runNode(relativePath) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [relativePath], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`${relativePath} exited with code ${code ?? "unknown"}`));
    });
  });
}
