import { expect, it } from "vitest";

import { parseRuleFileToMemories } from "../dist/import.js";

await runTest("parses English AGENTS.md style sections into candidate memories", async () => {
  const memories = parseRuleFileToMemories(
    [
      "# Conventions",
      "",
      "Keep CLI command behavior backward compatible unless a task explicitly calls for a breaking change.",
      "",
      "## Workflow pattern",
      "",
      "- Use small, reviewable commits.",
      "- Add only the minimal tests needed for new behavior.",
    ].join("\n"),
    "AGENTS.md",
  );

  assert.equal(memories.length, 2);
  assert.equal(memories[0]?.type, "convention");
  assert.equal(memories[0]?.status, "candidate");
  assert.equal(memories[0]?.source, "manual");
  assert.match(memories[0]?.summary ?? "", /backward compatible/i);
  assert.equal(memories[1]?.type, "pattern");
  assert.match(memories[1]?.summary ?? "", /small, reviewable commits/i);
});

await runTest("parses Chinese rule headings into inferred memory types", async () => {
  const memories = parseRuleFileToMemories(
    [
      "# 开发约定",
      "",
      "新增 schema 或配置字段时，必须提供默认值、向后兼容处理和清晰的错误提示。",
      "",
      "## 注意事项",
      "",
      "不要为了省事跳过 README 和测试更新，否则后续协作很容易出现理解偏差。",
    ].join("\n"),
    "CONVENTIONS.md",
    { defaultImportance: "high" },
  );

  assert.equal(memories.length, 2);
  assert.equal(memories[0]?.type, "convention");
  assert.equal(memories[0]?.importance, "high");
  assert.equal(memories[1]?.type, "gotcha");
  assert.match(memories[1]?.summary ?? "", /不要为了省事跳过 README/i);
});

await runTest("explicit type prefixes take priority over heading inference", async () => {
  const memories = parseRuleFileToMemories(
    [
      "# Implementation choice",
      "",
      "gotcha: Do not write imported memories directly as active records before review.",
      "",
      "The import pipeline should land everything as candidate first.",
    ].join("\n"),
    "CLAUDE.md",
  );

  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.type, "gotcha");
  assert.match(memories[0]?.summary ?? "", /^Do not write imported memories/i);
});

await runTest("quality filters skip short sections and pure link lists", async () => {
  const memories = parseRuleFileToMemories(
    [
      "# 目录",
      "",
      "- [约定](#约定)",
      "- [参考资料](#参考资料)",
      "",
      "## 约定",
      "",
      "保持现有 CLI 行为兼容，并为新增功能补最少必要的测试。",
      "",
      "## 参考资料",
      "",
      "- [RepoBrain](https://github.com/XD319/RepoBrain)",
      "- https://example.com/spec",
      "",
      "## 短",
      "",
      "太短了",
    ].join("\n"),
    ".cursorrules",
  );

  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.title, "约定");
});

await runTest("empty files return no memories", async () => {
  const memories = parseRuleFileToMemories("", "AGENTS.md");
  assert.deepEqual(memories, []);
});

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
  match(value, pattern, message) {
    expect(value, message).toMatch(pattern);
  },
};
