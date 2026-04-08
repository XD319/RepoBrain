import { expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { INTEGRATION_ADAPTERS, getIntegrationAdapter } from "../dist/integrations.js";

const projectRoot = process.cwd();

await runTest("integration adapters stay aligned on the shared RepoBrain contract", async () => {
  assert.deepEqual(
    INTEGRATION_ADAPTERS.map((adapter) => adapter.id),
    ["claude", "codex", "cursor", "copilot"],
  );

  for (const adapter of INTEGRATION_ADAPTERS) {
    assert.equal(adapter.readsBrainSchema, true);
    assert.equal(adapter.readsInjectOutput, true);
    assert.equal(adapter.readsSuggestSkillsOutput, true);
    assert.equal(adapter.contractPaths.length, 5);
    assert.ok(adapter.coreResponsibilities.length > 0);
    assert.ok(adapter.adapterResponsibilities.length > 0);
    assert.match(adapter.failureFallback, /brain extract|brain reinforce/);
    assert.equal(getIntegrationAdapter(adapter.id)?.templatePath, adapter.templatePath);
  }
});

await runTest("integration templates, contracts, and docs exist in the repository", async () => {
  const expectedPaths = [
    "integrations/README.md",
    "integrations/contracts/session-start.inject.md",
    "integrations/contracts/task-known.invocation-plan.json",
    "integrations/contracts/session-end.extract-candidate.json",
    "integrations/contracts/session-end.extract-candidate.md",
    "integrations/contracts/failure.reinforce-event.json",
    "integrations/contracts/routing-feedback.event.json",
    "integrations/claude/README.md",
    "integrations/claude/SKILL.md",
    "integrations/codex/README.md",
    "integrations/codex/SKILL.md",
    "integrations/cursor/README.md",
    "integrations/cursor/repobrain.mdc",
    "integrations/copilot/README.md",
    "integrations/copilot/copilot-instructions.md",
  ];

  for (const relativePath of expectedPaths) {
    await access(path.join(projectRoot, relativePath));
  }
});

await runTest("published docs mention integrations and the stronger adapter contract", async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("integrations"));

  const readme = await readFile(path.join(projectRoot, "README.md"), "utf8");
  const readmeZh = await readFile(path.join(projectRoot, "README.zh-CN.md"), "utf8");
  const integrationsReadme = await readFile(path.join(projectRoot, "integrations", "README.md"), "utf8");

  assert.match(readme, /integrations/i);
  assert.match(readme, /brain route|brain suggest-skills|brain inject/);
  assert.match(readme, /extended integrations|integrations directories/i);
  assert.match(readmeZh, /integrations/i);
  assert.match(readmeZh, /brain route|brain suggest-skills|brain inject/);
  assert.match(readmeZh, /\/docs|\/integrations/);
  assert.match(integrationsReadme, /Thin Adapter Contract/);
  assert.match(integrationsReadme, /Failure Fallback Strategy/);
  assert.match(integrationsReadme, /invocation_plan/);
});

console.log("All integration adapter tests passed.");

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
