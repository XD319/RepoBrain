import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getSteeringRulesStatus, initBrain, writeSteeringRules } from "../dist/store-api.js";

await runTest("brain init helpers can generate all steering rules files", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "all");

    assert.deepEqual(writtenPaths, [
      ".claude/rules/brain-session.md",
      ".codex/brain-session.md",
      ".cursor/rules/brain-session.mdc",
    ]);

    const claudeContent = await readFile(path.join(projectRoot, ".claude", "rules", "brain-session.md"), "utf8");
    const codexContent = await readFile(path.join(projectRoot, ".codex", "brain-session.md"), "utf8");
    const cursorContent = await readFile(path.join(projectRoot, ".cursor", "rules", "brain-session.mdc"), "utf8");

    assert.match(claudeContent, /# RepoBrain 会话规则/);
    assert.match(claudeContent, /brain inject/);
    assert.match(codexContent, /# RepoBrain 会话规则（Codex）/);
    assert.match(codexContent, /brain inject/);
    assert.match(cursorContent, /alwaysApply: true/);
    assert.match(cursorContent, /brain inject/);
  });
});

await runTest("brain init helpers generate only claude and codex with both for backward compatibility", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "both");

    assert.deepEqual(writtenPaths, [
      ".claude/rules/brain-session.md",
      ".codex/brain-session.md",
      ".cursor/rules/brain-session.mdc",
    ]);
  });
});

await runTest("brain status helper reports missing steering rules when no file exists", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const status = await getSteeringRulesStatus(projectRoot);

    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: false,
      cursorConfigured: false,
    });
  });
});

await runTest("brain status helper reports configured steering rules independently", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    await writeSteeringRules(projectRoot, "codex");

    const status = await getSteeringRulesStatus(projectRoot);
    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: true,
      cursorConfigured: false,
    });
  });
});

await runTest("brain init helpers can generate cursor steering rules independently", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const writtenPaths = await writeSteeringRules(projectRoot, "cursor");

    assert.deepEqual(writtenPaths, [".cursor/rules/brain-session.mdc"]);

    const status = await getSteeringRulesStatus(projectRoot);
    assert.deepEqual(status, {
      claudeConfigured: false,
      codexConfigured: false,
      cursorConfigured: true,
    });
  });
});

console.log("All init/status command tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-init-status-"));

  try {
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

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
