import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-demo-proof-test-"));

try {
  const outputDir = path.join(tempRoot, "proof-assets");
  const { stdout } = await runNode("scripts/generate-demo-proof.mjs", ["--output-dir", outputDir]);

  assert.match(stdout, /Demo proof written to/);

  const transcript = await readFile(path.join(outputDir, "transcript.md"), "utf8");
  const invocationPlan = JSON.parse(await readFile(path.join(outputDir, "invocation-plan.json"), "utf8"));
  const reviewOutput = await readFile(path.join(outputDir, "review-output.txt"), "utf8");

  assert.match(transcript, /brain setup --no-git-hook/);
  assert.match(transcript, /brain extract --candidate/);
  assert.match(transcript, /brain review/);
  assert.match(transcript, /brain approve <candidate-id> --safe/);
  assert.match(transcript, /brain suggest-skills --format json/);
  assert.match(reviewOutput, /Candidate memories: 1/);
  assert.equal(invocationPlan.kind, "repobrain.skill_invocation_plan");
  assert.deepEqual(invocationPlan.invocation_plan.required, ["release-checklist"]);
  assert.deepEqual(invocationPlan.invocation_plan.prefer_first, ["npm-install-smoke"]);
  assert.deepEqual(invocationPlan.invocation_plan.suppress, ["imagegen"]);

  console.log("All demo-proof tests passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function runNode(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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

      reject(new Error(stderr || stdout || `${scriptPath} exited with code ${code}`));
    });
  });
}
