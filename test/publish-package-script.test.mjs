import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { buildPublishEnv, resolvePublishPlan } from "../scripts/publish-package.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

await runTest("publish script prefers token fallback locally when NPM_TOKEN exists", async () => {
  const plan = resolvePublishPlan({
    npmToken: "token-value",
    isGitHubActions: false,
  });

  assert.equal(plan.strategy, "token");
  assert.deepEqual(plan.args, ["publish"]);
});

await runTest("publish script falls back to trusted publishing in GitHub Actions", async () => {
  const plan = resolvePublishPlan({
    npmToken: "",
    isGitHubActions: true,
  });

  assert.equal(plan.strategy, "trusted");
  assert.deepEqual(plan.args, ["publish", "--provenance"]);
});

await runTest("publish script prefers trusted publishing in GitHub Actions even when NPM_TOKEN exists", async () => {
  const plan = resolvePublishPlan({
    npmToken: "token-value",
    isGitHubActions: true,
  });

  assert.equal(plan.strategy, "trusted");
  assert.deepEqual(plan.args, ["publish", "--provenance"]);
});

await runTest("publish script strips token auth env when trusted publishing is selected", async () => {
  const publishEnv = buildPublishEnv(
    { strategy: "trusted" },
    {
      GITHUB_ACTIONS: "true",
      NPM_TOKEN: "token-value",
      NODE_AUTH_TOKEN: "node-token",
    },
  );

  assert.equal("NPM_TOKEN" in publishEnv, false);
  assert.equal("NODE_AUTH_TOKEN" in publishEnv, false);
});

await runTest("publish script maps NPM_TOKEN into NODE_AUTH_TOKEN for token fallback", async () => {
  const publishEnv = buildPublishEnv(
    { strategy: "token" },
    {
      NPM_TOKEN: "token-value",
    },
  );

  assert.equal(publishEnv.NODE_AUTH_TOKEN, "token-value");
});

await runTest("publish script rejects trusted publishing outside GitHub Actions", async () => {
  assert.throws(
    () =>
      resolvePublishPlan({
        requestedStrategy: "trusted",
        npmToken: "",
        isGitHubActions: false,
      }),
    /Trusted publishing requires GitHub Actions/i,
  );
});

await runTest("publish script rejects token publishing without NPM_TOKEN", async () => {
  assert.throws(
    () =>
      resolvePublishPlan({
        requestedStrategy: "token",
        npmToken: "",
        isGitHubActions: true,
      }),
    /requires the NPM_TOKEN/i,
  );
});

await runTest("publish script rejects unknown strategies with a clear error", async () => {
  assert.throws(
    () =>
      resolvePublishPlan({
        requestedStrategy: "mystery",
        npmToken: "",
        isGitHubActions: true,
      }),
    /Unsupported publish strategy/i,
  );
});

await runTest("publish script CLI prints a clear local trusted-publishing error", async () => {
  await assert.rejects(
    () =>
      execFileAsync(process.execPath, [path.join(projectRoot, "scripts", "publish-package.mjs")], {
        cwd: projectRoot,
        env: {
          ...process.env,
          GITHUB_ACTIONS: "",
          NPM_TOKEN: "",
          REPOBRAIN_PUBLISH_STRATEGY: "auto",
        },
      }),
    /Trusted publishing requires GitHub Actions/i,
  );
});

console.log("All publish-package script tests passed.");

function runTest(name, callback) {
  it(name, callback);
}

const assert = {
  equal(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  deepEqual(actual, expected, message) {
    expect(actual, message).toEqual(expected);
  },
  throws(action, matcher, message) {
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
    if (matcher instanceof RegExp) {
      const combinedMessage = [failure.message, failure.stderr, failure.stdout].filter(Boolean).join("\n");
      expect(combinedMessage, message).toMatch(matcher);
    }
  },
};
