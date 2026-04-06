import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const projectRoot = process.cwd();

const { stdout } = await runNode("scripts/run-proof-evals.mjs");

assert.match(stdout, /# RepoBrain Proof Evaluations/);
assert.match(stdout, /## extract_quality/);
assert.match(stdout, /## inject_hit/);
assert.match(stdout, /## review_supersede/);
assert.match(stdout, /## feedback_negative_workflow/);
assert.match(stdout, /## preference_routing/);
assert.match(stdout, /## superseded_preference/);
assert.match(stdout, /## session_profile_routing/);
assert.match(stdout, /## session_pollution/);
assert.match(stdout, /## routing_feedback_loop/);
assert.match(stdout, /## preference_phrase_precision/);
assert.match(stdout, /## Metrics \(deterministic checks\)/);
assert.doesNotMatch(stdout, /FAIL:/);
assert.match(stdout, /PASS: accepts a durable repo-specific lesson/);
assert.match(stdout, /PASS: prioritizes the task-matched memory over generic guidance/);
assert.match(stdout, /PASS: marks a replacement memory as supersede/);

console.log("All proof-evals tests passed.");

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
