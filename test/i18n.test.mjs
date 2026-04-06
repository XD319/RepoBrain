import { expect, it } from "vitest";

import { detectSystemLanguage, normalizeLanguage, t } from "../dist/store-api.js";

await runTest("normalizeLanguage maps zh variants to zh-CN", () => {
  assert.equal(normalizeLanguage("zh"), "zh-CN");
  assert.equal(normalizeLanguage("zh-Hans"), "zh-CN");
  assert.equal(normalizeLanguage("ZH_cn"), "zh-CN");
});

await runTest("normalizeLanguage falls back to en for other values", () => {
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("fr-FR"), "en");
  assert.equal(normalizeLanguage(undefined), "en");
});

await runTest("detectSystemLanguage can infer zh from supplied locales", () => {
  assert.equal(detectSystemLanguage(["en-US", "zh-CN"]), "zh-CN");
  assert.equal(detectSystemLanguage(["en-US", "fr-FR"]), "en");
});

await runTest("t() returns the selected language and interpolates vars", () => {
  assert.equal(t("init.workspace_initialized", "en"), "Initialized .brain workspace.");
  assert.equal(t("init.workspace_initialized", "zh-CN"), "已初始化 .brain/ 目录。");
  assert.equal(
    t("setup.repobrain_initialized", "en", { projectRoot: "/tmp/repo" }),
    "Initialized RepoBrain in /tmp/repo",
  );
});

function runTest(name, callback) {
  it(name, callback);
}

const assert = {
  equal(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
};
