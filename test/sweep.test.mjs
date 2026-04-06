import { expect, it } from "vitest";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadConfig, loadStoredMemoryRecords, renderConfigWarnings, saveMemory, initBrain } from "../dist/store-api.js";
import { buildInjection } from "../dist/inject.js";
import { applySweepAuto, renderSweepDryRun, scanSweepCandidates } from "../dist/sweep.js";

await runTest("sweep config fields default safely and invalid values emit warnings", async () => {
  await withTempRepo(async (projectRoot) => {
    const defaults = await loadConfig(projectRoot);
    assert.equal(defaults.staleDays, 90);
    assert.equal(defaults.sweepOnInject, false);

    await writeFile(
      path.join(projectRoot, ".brain", "config.yaml"),
      [
        "maxInjectTokens: 1200",
        "triggerMode: detect",
        "captureMode: candidate",
        "language: zh-CN",
        "staleDays: nope",
        "sweepOnInject: maybe",
        "",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(projectRoot);
    const warnings = renderConfigWarnings(config);
    assert.equal(config.staleDays, 90);
    assert.equal(config.sweepOnInject, false);
    assert.match(warnings.join("\n"), /Ignoring invalid config value staleDays=nope/);
    assert.match(warnings.join("\n"), /Ignoring invalid config value sweepOnInject=maybe/);
  });
});

await runTest("sweep scan groups expired, stale, duplicate, and archive candidates", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "working",
        title: "Expired migration checklist",
        summary: "A short-lived working note that should be removed.",
        detail: "## WORKING\n\nThis checklist expired already.",
        tags: ["working"],
        importance: "medium",
        date: "2026-01-01T09:00:00.000Z",
        updated: "2026-01-01",
        expires: "2026-01-05",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Keep auth writes inside one transaction",
        summary: "An old decision that should be downgraded.",
        detail: "## DECISION\n\nOld auth rollout guidance.",
        tags: ["auth"],
        importance: "high",
        date: "2025-12-10T09:00:00.000Z",
        updated: "2025-12-10",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Use JWT for stateless auth",
        summary: "Possible duplicate A.",
        detail: "## DECISION\n\nJWT duplicate example A.",
        tags: ["auth"],
        importance: "medium",
        date: "2026-03-01T09:00:00.000Z",
        updated: "2026-03-01",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Use JWT stateless auth",
        summary: "Possible duplicate B.",
        detail: "## DECISION\n\nJWT duplicate example B.",
        tags: ["auth"],
        importance: "medium",
        date: "2026-03-02T09:00:00.000Z",
        updated: "2026-03-02",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "goal",
        title: "Retire legacy auth flow",
        summary: "A finished goal ready for archive.",
        detail: "## GOAL\n\nRetire the legacy auth flow.",
        tags: ["auth"],
        importance: "high",
        date: "2026-01-15T09:00:00.000Z",
        updated: "2026-01-20",
        status: "done",
      },
      projectRoot,
    );

    const config = {
      ...(await loadConfig(projectRoot)),
      staleDays: 90,
    };
    const result = await scanSweepCandidates(projectRoot, config, new Date("2026-04-02T10:00:00"));

    assert.equal(result.expiredWorking.length, 1);
    assert.equal(result.staleMemories.length, 1);
    assert.equal(result.duplicatePairs.length, 1);
    assert.equal(result.archiveGoals.length, 1);

    const rendered = renderSweepDryRun(result);
    assert.match(rendered, /\[EXPIRED\].*\.brain\/working\//);
    assert.match(rendered, /\[STALE\].*importance: high → medium/);
    assert.match(rendered, /\[POSSIBLE-DUP\].*decisions\//);
    assert.match(rendered, /\[ARCHIVE\].*建议归档/);
    assert.match(rendered, /过期 working 记忆  1 条（待删除）/);
  });
});

await runTest("sweep auto deletes, downgrades, archives, and keeps duplicate warnings non-destructive", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "working",
        title: "Expired API checklist",
        summary: "Expired working note.",
        detail: "## WORKING\n\nThis expired checklist should be removed.",
        tags: ["api"],
        importance: "medium",
        date: "2026-01-01T09:00:00.000Z",
        updated: "2026-01-01",
        expires: "2026-01-02",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Keep auth writes transactional",
        summary: "Should be downgraded by sweep.",
        detail: "## DECISION\n\nKeep auth writes transactional.",
        tags: ["auth"],
        importance: "high",
        date: "2025-12-03T09:00:00.000Z",
        updated: "2025-12-03",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Use JWT for stateless auth",
        summary: "Possible duplicate A.",
        detail: "## DECISION\n\nDuplicate A.",
        tags: ["auth"],
        importance: "medium",
        date: "2026-03-01T09:00:00.000Z",
        updated: "2026-03-01",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "decision",
        title: "Use JWT stateless auth",
        summary: "Possible duplicate B.",
        detail: "## DECISION\n\nDuplicate B.",
        tags: ["auth"],
        importance: "medium",
        date: "2026-03-02T09:00:00.000Z",
        updated: "2026-03-02",
        status: "active",
      },
      projectRoot,
    );

    await saveMemory(
      {
        type: "goal",
        title: "Archive finished rollout",
        summary: "Done goal ready for archive.",
        detail: "## GOAL\n\nArchive this finished rollout.",
        tags: ["goal"],
        importance: "high",
        date: "2026-01-04T09:00:00.000Z",
        updated: "2026-01-10",
        status: "done",
      },
      projectRoot,
    );

    const config = await loadConfig(projectRoot);
    const result = await applySweepAuto(projectRoot, config, new Date("2026-04-02T10:00:00"));
    assert.equal(result.changed, true);
    assert.match(result.lines.join("\n"), /\[EXPIRED\].*已删除/);
    assert.match(result.lines.join("\n"), /\[STALE\].*已降权/);
    assert.match(result.lines.join("\n"), /\[POSSIBLE-DUP\]/);
    assert.match(result.lines.join("\n"), /\[ARCHIVE\].*已归档/);

    const records = await loadStoredMemoryRecords(projectRoot);
    assert.equal(
      records.some((entry) => entry.memory.title === "Expired API checklist"),
      false,
    );

    const downgraded = records.find((entry) => entry.memory.title === "Keep auth writes transactional");
    assert.ok(downgraded);
    assert.equal(downgraded.memory.importance, "medium");
    assert.match(
      downgraded.memory.detail,
      /<!-- brain-sweep: \d{4}-\d{2}-\d{2} 超过 90 天未更新，importance 已降权 -->/,
    );

    const duplicates = records.filter(
      (entry) => /stateless auth/i.test(entry.memory.title) || /jwt/i.test(entry.memory.title),
    );
    assert.equal(duplicates.length, 2);

    await access(path.join(projectRoot, ".brain", "archive"));
    const archiveFiles = await readdir(path.join(projectRoot, ".brain", "archive"));
    assert.equal(archiveFiles.length, 1);
    const archivedContent = await readFile(path.join(projectRoot, ".brain", "archive", archiveFiles[0]), "utf8");
    assert.equal(
      records.some((entry) => entry.memory.title === "Archive finished rollout"),
      false,
    );
    assert.match(archivedContent, /Archive finished rollout/);
  });
});

await runTest("sweep auto stays compatible with inject by cleaning before context generation", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "decision",
        title: "Old auth retry rule",
        summary: "This should be downgraded before inject.",
        detail: "## DECISION\n\nDowngrade this before inject.",
        tags: ["auth"],
        importance: "high",
        date: "2026-01-01T09:00:00.000Z",
        updated: "2026-01-15",
        status: "active",
      },
      projectRoot,
    );

    await applySweepAuto(
      projectRoot,
      {
        ...(await loadConfig(projectRoot)),
        staleDays: 30,
      },
      new Date("2026-04-02T10:00:00"),
    );

    const injection = await buildInjection(projectRoot, {
      ...(await loadConfig(projectRoot)),
      staleDays: 30,
      sweepOnInject: true,
    });
    assert.match(injection, /\[decision \| medium\] Old auth retry rule/);

    const records = await loadStoredMemoryRecords(projectRoot);
    const memory = records.find((entry) => entry.memory.title === "Old auth retry rule")?.memory;
    assert.ok(memory);
    assert.equal(memory.importance, "medium");
  });
});

console.log("All sweep tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-sweep-"));

  try {
    await initBrain(projectRoot);
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
