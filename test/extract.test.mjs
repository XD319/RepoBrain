import assert from "node:assert/strict";

import { extractMemories } from "../dist/extract.js";

const config = {
  maxInjectTokens: 1200,
  extractMode: "suggest",
  language: "en",
  staleDays: 30,
  sweepOnInject: false,
};

const originalExtractorCommand = process.env.BRAIN_EXTRACTOR_COMMAND;
delete process.env.BRAIN_EXTRACTOR_COMMAND;

try {
  await runTest("local extractor handles prefixless English decision summaries", async () => {
    const memories = await extractMemories(
      [
        "We chose to keep candidate review inside src/reviewer.ts because extracted writes must stay deterministic, local, and fully offline.",
        "That review path should not depend on any remote model before RepoBrain writes candidate knowledge.",
      ].join("\n\n"),
      config,
    );

    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.type, "decision");
    assert.ok(memories[0]?.files?.includes("src/reviewer.ts"));
    assert.match(memories[0]?.summary ?? "", /deterministic/i);
  });

  await runTest("local extractor upgrades Chinese no-prefix gotcha detection", async () => {
    const memories = await extractMemories(
      "不要在 src/api/payments/ledger.ts 外直接写 ledger，因为 rollback 只覆盖 transaction helper 内的写入，否则会留下半写入记录。",
      { ...config, language: "zh-CN" },
    );

    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.type, "gotcha");
    assert.equal(memories[0]?.importance, "high");
    assert.ok(memories[0]?.files?.includes("src/api/payments/ledger.ts"));
  });

  await runTest("local extractor handles mixed-language convention summaries", async () => {
    const memories = await extractMemories(
      "统一把 tool-specific prompts 放在 integrations/codex/ 下面，keep them under one integration folder so setup and review stay predictable.",
      { ...config, language: "zh-CN" },
    );

    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.type, "convention");
    assert.ok(memories[0]?.files?.some((file) => file.startsWith("integrations/codex")));
  });

  await runTest("local extractor splits bullet repair logs into multiple durable candidates", async () => {
    const memories = await extractMemories(
      [
        "修复记录:",
        "- 所有 session refresh 都通过 src/auth/session-parser.ts 解析，这样 web/api 共用同一路径，避免 token expiry drift。",
        "- 测试夹具统一放进 test/fixtures/auth/，不要在每个 spec 里重新拼 mock。",
      ].join("\n"),
      { ...config, language: "zh-CN" },
    );

    assert.equal(memories.length, 2);
    assert.ok(memories.some((entry) => entry.files?.includes("src/auth/session-parser.ts")));
    assert.ok(memories.some((entry) => entry.files?.some((file) => file.startsWith("test/fixtures/auth"))));
  });

  await runTest("local extractor captures long-form goal summaries without prefixes", async () => {
    const memories = await extractMemories(
      [
        "The long-term goal is to migrate the legacy queue worker to the event pipeline.",
        "The end state is that src/jobs/pipeline.ts becomes the only background write path, parity tests stay green, and the old queue path can be removed after rollout.",
      ].join(" "),
      config,
    );

    assert.ok(memories.length >= 1);
    assert.ok(memories.some((entry) => entry.type === "goal"));
    assert.ok(memories.some((entry) => entry.files?.includes("src/jobs/pipeline.ts")));
  });

  await runTest("local extractor uses git commit context and changed files without an external model", async () => {
    const memories = await extractMemories(
      [
        "Source: git-commit",
        "Revision: HEAD",
        "",
        "## Commit metadata",
        "commit 0123456789abcdef",
        "Subject: refactor: centralize extraction review",
        "",
        "Body:",
        "Keep extract review in src/reviewer.ts and src/extract.ts because candidate writing must stay fully local and deterministic.",
        "The local extractor should use changed files plus long-form rationale instead of relying only on prefixes.",
        "",
        "## Changed files",
        "M src/extract.ts",
        "M src/reviewer.ts",
        "A test/extract.test.mjs",
        "",
        "## Diff stat",
        " src/extract.ts        | 120 +++++++++++++++++++++++++++++++++++++",
        " src/reviewer.ts       |   2 +-",
        " test/extract.test.mjs |  80 +++++++++++++++++++++",
      ].join("\n"),
      config,
    );

    assert.ok(memories.length >= 1);
    assert.ok(memories.every((entry) => entry.source === "git-commit"));
    assert.ok(memories.some((entry) => entry.files?.includes("src/extract.ts")));
  });

  await runTest("local extractor rejects low-information debug noise", async () => {
    const memories = await extractMemories(
      [
        "Ran npm test.",
        "Added console.log around the parser.",
        "Fixed one README typo.",
      ].join("\n"),
      config,
    );

    assert.equal(memories.length, 0);
  });

  await runTest("local extractor de-dupes equivalent prefix and non-prefix memories", async () => {
    const memories = await extractMemories(
      [
        "decision: Keep extract review local in src/reviewer.ts",
        "",
        "We chose to keep extract review local in src/reviewer.ts because the repo should stay offline by default.",
      ].join("\n"),
      config,
    );

    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.type, "decision");
  });

  console.log("All extract tests passed.");
} finally {
  if (originalExtractorCommand === undefined) {
    delete process.env.BRAIN_EXTRACTOR_COMMAND;
  } else {
    process.env.BRAIN_EXTRACTOR_COMMAND = originalExtractorCommand;
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
