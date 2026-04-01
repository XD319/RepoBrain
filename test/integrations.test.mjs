import assert from "node:assert/strict";
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
    assert.ok(adapter.coreResponsibilities.length > 0);
    assert.ok(adapter.adapterResponsibilities.length > 0);
    assert.equal(getIntegrationAdapter(adapter.id)?.templatePath, adapter.templatePath);
  }
});

await runTest("integration templates and docs exist in the repository", async () => {
  const expectedPaths = [
    "integrations/README.md",
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

await runTest("published docs mention integrations and the core-versus-adapter boundary", async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("integrations"));

  const readme = await readFile(path.join(projectRoot, "README.md"), "utf8");
  const readmeZh = await readFile(path.join(projectRoot, "README.zh-CN.md"), "utf8");

  assert.match(readme, /## Integrations/);
  assert.match(readme, /Core layer responsibilities/);
  assert.match(readme, /Adapter layer responsibilities/);
  assert.match(readmeZh, /## Integrations/);
  assert.match(readmeZh, /核心层职责/);
  assert.match(readmeZh, /adapter 层职责/);
});

console.log("All integration adapter tests passed.");

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
