import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  initBrain,
  loadConfig,
  migrateExtractModeToNewFields,
  deriveLegacyExtractMode,
  renderConfigWarnings,
} from "../dist/store-api.js";

await runTest("migrateExtractModeToNewFields maps manual correctly", () => {
  const result = migrateExtractModeToNewFields("manual");
  assert.equal(result.triggerMode, "manual");
  assert.equal(result.captureMode, "direct");
  assert.equal(result.autoApproveSafeCandidates, false);
});

await runTest("migrateExtractModeToNewFields maps suggest correctly", () => {
  const result = migrateExtractModeToNewFields("suggest");
  assert.equal(result.triggerMode, "detect");
  assert.equal(result.captureMode, "candidate");
  assert.equal(result.autoApproveSafeCandidates, false);
});

await runTest("migrateExtractModeToNewFields maps auto correctly", () => {
  const result = migrateExtractModeToNewFields("auto");
  assert.equal(result.triggerMode, "detect");
  assert.equal(result.captureMode, "direct");
  assert.equal(result.autoApproveSafeCandidates, true);
});

await runTest("deriveLegacyExtractMode round-trips manual", () => {
  assert.equal(deriveLegacyExtractMode("manual", "direct"), "manual");
});

await runTest("deriveLegacyExtractMode round-trips suggest", () => {
  assert.equal(deriveLegacyExtractMode("detect", "candidate"), "suggest");
});

await runTest("deriveLegacyExtractMode round-trips auto", () => {
  assert.equal(deriveLegacyExtractMode("detect", "direct"), "auto");
});

await runTest("deriveLegacyExtractMode treats reviewable like suggest", () => {
  assert.equal(deriveLegacyExtractMode("detect", "reviewable"), "suggest");
});

await runTest("loading config with legacy extractMode emits deprecation warning and migrates", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "workflowMode: recommended-semi-auto",
        "maxInjectTokens: 1200",
        "extractMode: suggest",
        "language: zh-CN",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.triggerMode, "detect");
    assert.equal(config.captureMode, "candidate");
    assert.equal(config.extractMode, "suggest");

    const warnings = renderConfigWarnings(config);
    const deprecationWarning = warnings.find((w) => w.includes("extractMode") && w.includes("deprecated"));
    assert.ok(deprecationWarning, "should emit a deprecation warning for extractMode");
    assert.match(deprecationWarning, /triggerMode: detect/);
    assert.match(deprecationWarning, /captureMode: candidate/);
  });
});

await runTest("loading config with legacy extractMode: manual migrates to triggerMode: manual", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "workflowMode: ultra-safe-manual",
        "extractMode: manual",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.triggerMode, "manual");
    assert.equal(config.captureMode, "direct");
    assert.equal(config.extractMode, "manual");
  });
});

await runTest("loading config with legacy extractMode: auto migrates to triggerMode: detect + captureMode: direct", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "workflowMode: automation-first",
        "extractMode: auto",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.triggerMode, "detect");
    assert.equal(config.captureMode, "direct");
    assert.equal(config.extractMode, "auto");
  });
});

await runTest("new triggerMode + captureMode fields take precedence over legacy extractMode", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "workflowMode: recommended-semi-auto",
        "triggerMode: detect",
        "captureMode: candidate",
        "extractMode: manual",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.triggerMode, "detect");
    assert.equal(config.captureMode, "candidate");
    assert.equal(config.extractMode, "suggest");

    const warnings = renderConfigWarnings(config);
    const conflictWarning = warnings.find((w) => w.includes("new fields take precedence"));
    assert.ok(conflictWarning, "should warn about both old and new fields being set");
  });
});

await runTest("config with only new fields loads without deprecation warning", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "workflowMode: recommended-semi-auto",
        "triggerMode: detect",
        "captureMode: candidate",
        "language: zh-CN",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.triggerMode, "detect");
    assert.equal(config.captureMode, "candidate");
    assert.equal(config.extractMode, "suggest");

    const warnings = renderConfigWarnings(config);
    const deprecationWarning = warnings.find((w) => w.includes("deprecated"));
    assert.equal(deprecationWarning, undefined, "should not emit deprecation warning when using new fields");
  });
});

await runTest("default config without explicit fields inherits from workflow preset", async () => {
  await withTempRepo(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "workflowMode: automation-first",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    assert.equal(config.triggerMode, "detect");
    assert.equal(config.captureMode, "candidate");
    assert.equal(config.autoApproveSafeCandidates, true);
    assert.equal(config.sweepOnInject, true);
  });
});

console.log("All config migration tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-config-migration-"));

  try {
    await initBrain(projectRoot);
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
