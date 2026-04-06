import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const assert = {
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
  match(value, pattern, message) {
    expect(value, message).toMatch(pattern);
  },
  notDeepEqual(actual, expected, message) {
    expect(actual, message).not.toEqual(expected);
  },
};

const projectRoot = process.cwd();

it("generate-proof-bundles creates expected artifacts", async () => {
  const { stdout } = await runNode("scripts/generate-proof-bundles.mjs", [
    "--output-dir",
    path.join(projectRoot, "tmp", "proof-bundles-test-out"),
  ]);

  assert.match(stdout, /Proof bundles written to/);

  const root = path.join(projectRoot, "tmp", "proof-bundles-test-out");

  for (const flavor of ["typescript-cli", "fullstack-web"]) {
    const base = path.join(root, flavor);
    const before = JSON.parse(await readFile(path.join(base, "route-before.json"), "utf8"));
    const after = JSON.parse(await readFile(path.join(base, "route-after.json"), "utf8"));
    assert.ok(before.invocation_plan);
    assert.ok(after.invocation_plan);
    assert.notDeepEqual(before.invocation_plan, after.invocation_plan);

    const cap = await readFile(path.join(base, "preference-capture-output.txt"), "utf8");
    assert.match(cap, /Input:/);

    await readFile(path.join(base, "timeline-output.txt"), "utf8");
    await readFile(path.join(base, "feedback-loop-output.txt"), "utf8");
    await readFile(path.join(base, "durable-memory-sample.md"), "utf8");
    await readFile(path.join(base, "preference-sample.md"), "utf8");
    await readFile(path.join(base, "session-profile.json"), "utf8");
  }
});

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
