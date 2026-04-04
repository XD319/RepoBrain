import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { writeSteeringRules, getSteeringRulesStatus } from "../dist/store-api.js";

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const SHARED_CONTRACT_PHRASES = [
  "brain start --format json",
  "brain capture",
  "brain suggest-skills --format json",
  "brain reinforce",
  "candidate",
  ".brain/",
];

const DETECTION_TRIGGER_PHRASES = [
  "修复了重复",
  "完成了一个子模块",
  "测试从失败变为成功",
];

const ANTI_REPETITION_PHRASE = "不要重复提出相同的 capture 建议";

const CANDIDATE_FIRST_PHRASE = "candidate";

await runTest("writeSteeringRules writes all three agent rules", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    assert.equal(paths.length, 3);
    assert.ok(paths.some((p) => p.includes("claude")));
    assert.ok(paths.some((p) => p.includes("codex")));
    assert.ok(paths.some((p) => p.includes("cursor")));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("all generated rules share the same core contract phrases", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    for (const relativePath of paths) {
      const content = await readFile(path.join(tmpDir, relativePath), "utf8");
      for (const phrase of SHARED_CONTRACT_PHRASES) {
        assert.ok(
          content.includes(phrase),
          `${relativePath} is missing shared contract phrase: ${phrase}`,
        );
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("all generated rules include detection trigger conditions", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    for (const relativePath of paths) {
      const content = await readFile(path.join(tmpDir, relativePath), "utf8");
      for (const phrase of DETECTION_TRIGGER_PHRASES) {
        assert.ok(
          content.includes(phrase),
          `${relativePath} is missing detection trigger: ${phrase}`,
        );
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("all generated rules include anti-repetition guidance", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    for (const relativePath of paths) {
      const content = await readFile(path.join(tmpDir, relativePath), "utf8");
      assert.ok(
        content.includes(ANTI_REPETITION_PHRASE),
        `${relativePath} is missing anti-repetition guidance`,
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("all generated rules default to candidate-first", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    for (const relativePath of paths) {
      const content = await readFile(path.join(tmpDir, relativePath), "utf8");
      assert.ok(
        content.includes(CANDIDATE_FIRST_PHRASE),
        `${relativePath} is missing candidate-first wording`,
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("all generated rules include failure path via brain reinforce", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    for (const relativePath of paths) {
      const content = await readFile(path.join(tmpDir, relativePath), "utf8");
      assert.ok(
        content.includes("brain reinforce"),
        `${relativePath} is missing failure path (brain reinforce)`,
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("cursor generated rules include alwaysApply frontmatter", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    await writeSteeringRules(tmpDir, "cursor");
    const cursorPath = path.join(tmpDir, ".cursor", "rules", "brain-session.mdc");
    const content = await readFile(cursorPath, "utf8");
    assert.ok(content.includes("alwaysApply: true"));
    assert.ok(content.includes("brain capture"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("no generated rule references old subjective extract-proposal pattern", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const paths = await writeSteeringRules(tmpDir, "all");
    for (const relativePath of paths) {
      const content = await readFile(path.join(tmpDir, relativePath), "utf8");
      assert.ok(
        !content.includes("主动提议提取记忆"),
        `${relativePath} still contains old subjective extract-proposal pattern`,
      );
      assert.ok(
        !content.includes("提议示例"),
        `${relativePath} still contains old example-proposal pattern`,
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("integration template files align with generated steering rules on core phrases", async () => {
  const templateFiles = [
    "integrations/cursor/repobrain.mdc",
    "integrations/codex/SKILL.md",
    "integrations/copilot/copilot-instructions.md",
    "integrations/claude/SKILL.md",
  ];

  const projectRoot = process.cwd();

  for (const templatePath of templateFiles) {
    const content = await readFile(path.join(projectRoot, templatePath), "utf8");
    assert.ok(
      content.includes("brain capture"),
      `${templatePath} is missing brain capture`,
    );
    assert.ok(
      content.includes("candidate"),
      `${templatePath} is missing candidate-first wording`,
    );
    assert.ok(
      content.includes("brain reinforce"),
      `${templatePath} is missing failure path`,
    );
    assert.ok(
      content.includes(".brain/"),
      `${templatePath} is missing .brain/ reference`,
    );
  }
});

await runTest("getSteeringRulesStatus returns false for empty directory", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    const status = await getSteeringRulesStatus(tmpDir);
    assert.equal(status.claudeConfigured, false);
    assert.equal(status.codexConfigured, false);
    assert.equal(status.cursorConfigured, false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

await runTest("getSteeringRulesStatus returns true after write", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "brain-steering-"));
  try {
    await writeSteeringRules(tmpDir, "all");
    const status = await getSteeringRulesStatus(tmpDir);
    assert.equal(status.claudeConfigured, true);
    assert.equal(status.codexConfigured, true);
    assert.equal(status.cursorConfigured, true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

console.log("All steering rules tests passed.");
