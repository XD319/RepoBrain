import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const storeApiPath = path.join(projectRoot, "dist", "store-api.js");
const extractPath = path.join(projectRoot, "dist", "extract.js");
const injectPath = path.join(projectRoot, "dist", "inject.js");

await assertBuilt();

const storeApi = await import(pathToFileURL(storeApiPath).href);
const { extractMemories } = await import(pathToFileURL(extractPath).href);
const { buildInjection } = await import(pathToFileURL(injectPath).href);

const config = {
  maxInjectTokens: 1200,
  extractMode: "suggest",
  language: "en",
  staleDays: 30,
  sweepOnInject: false,
  injectDiversity: true,
  injectExplainMaxItems: 4,
};

const results = [];

await runCase("extract_quality", "accepts a durable repo-specific lesson", async () => {
  const memories = await extractMemories(
    [
      "Keep release notes and install smoke validation in docs/release-guide.md because the first npm publish should prove installability, not just packaging.",
      "When package.json changes, use docs/release-guide.md and docs/release-checklist.md together so release validation stays repeatable.",
    ].join("\n\n"),
    config,
  );

  assert.ok(memories.length >= 1);
  assert.ok(memories.some((entry) => entry.type === "decision"));
  assert.ok(memories.some((entry) => entry.files?.includes("docs/release-guide.md")));
});

await runCase("extract_quality", "rejects low-information status chatter", async () => {
  const memories = await extractMemories(
    ["ran tests", "updated one comment", "looked at package.json"].join("\n"),
    config,
  );

  assert.equal(memories.length, 0);
});

await runCase("inject_hit", "prioritizes the task-matched memory over generic guidance", async () => {
  await withTempRepo(async (repoRoot) => {
    await storeApi.saveMemory(
      {
        type: "decision",
        title: "Use package smoke validation before npm publish",
        summary: "Package changes should run the packaged install smoke flow before publish.",
        detail: "## DECISION\n\nPackage changes should run the packaged install smoke flow before publish.",
        tags: ["release", "npm"],
        importance: "high",
        date: "2026-04-03T10:00:00.000Z",
        status: "active",
        path_scope: ["package.json", "docs/release-guide.md"],
        skill_trigger_tasks: ["prepare npm release"],
        skill_trigger_paths: ["package.json"],
        invocation_mode: "required",
        risk_level: "high",
      },
      repoRoot,
    );

    await storeApi.saveMemory(
      {
        type: "gotcha",
        title: "General release reminder",
        summary: "Generic release guidance should not outrank the package-specific memory.",
        detail: "## GOTCHA\n\nGeneric release guidance should not outrank the package-specific memory.",
        tags: ["release"],
        importance: "medium",
        date: "2026-04-03T09:00:00.000Z",
        status: "active",
      },
      repoRoot,
    );

    const injection = await buildInjection(repoRoot, config, {
      task: "prepare npm release smoke validation",
      paths: ["package.json"],
      modules: ["release"],
    });

    assert.ok(
      injection.indexOf("Use package smoke validation before npm publish") <
        injection.indexOf("General release reminder"),
    );
    assert.match(injection, /Selection mode: task-aware/);
    assert.match(injection, /Task Phrase Match: prepare npm release/);
  });
});

await runCase("review_supersede", "marks a replacement memory as supersede", async () => {
  await withTempRepo(async (repoRoot) => {
    const existingPath = await storeApi.saveMemory(
      {
        type: "convention",
        title: "Use npm test for release validation",
        summary: "Release validation currently runs through npm test.",
        detail: "## CONVENTION\n\nRelease validation currently runs through npm test.",
        tags: ["release"],
        importance: "medium",
        date: "2026-04-03T08:00:00.000Z",
        status: "active",
        path_scope: ["package.json"],
      },
      repoRoot,
    );

    const records = await storeApi.loadStoredMemoryRecords(repoRoot);
    const review = storeApi.reviewCandidateMemory(
      {
        type: "convention",
        title: "Use npm test for release validation",
        summary: "Release validation now needs npm run smoke:package instead of npm test before publish.",
        detail:
          "## CONVENTION\n\nReplace npm test with npm run smoke:package for release validation before publish. The npm-test-only guidance is obsolete for packaged release validation.",
        tags: ["release", "smoke"],
        importance: "high",
        date: "2026-04-03T09:00:00.000Z",
        path_scope: ["package.json"],
      },
      records,
    );

    assert.equal(review.decision, "supersede");
    assert.deepEqual(review.target_memory_ids, [path.basename(existingPath, ".md")]);
  });
});

await runCase("review_supersede", "keeps novel routing guidance as accept", async () => {
  await withTempRepo(async (repoRoot) => {
    const records = await storeApi.loadStoredMemoryRecords(repoRoot);
    const review = storeApi.reviewCandidateMemory(
      {
        type: "pattern",
        title: "Use focused fixtures for release smoke demos",
        summary: "Focused fixtures keep release smoke demos easier to debug than full demo repos.",
        detail: "## PATTERN\n\nFocused fixtures keep release smoke demos easier to debug than full demo repos.",
        tags: ["release", "demo"],
        importance: "medium",
        date: "2026-04-03T09:30:00.000Z",
        path_scope: ["test/fixtures/**"],
      },
      records,
    );

    assert.equal(review.decision, "accept");
    assert.equal(review.reason, "novel_memory");
  });
});

renderResults(results);

async function assertBuilt() {
  const candidates = [storeApiPath, extractPath, injectPath];
  try {
    await Promise.all(candidates.map((candidate) => import(pathToFileURL(candidate).href)));
  } catch {
    throw new Error('Build output missing. Run "npm run build" before running proof evaluations.');
  }
}

async function runCase(category, name, callback) {
  try {
    await callback();
    results.push({ category, name, status: "PASS" });
  } catch (error) {
    results.push({
      category,
      name,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function withTempRepo(callback) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-proof-eval-"));
  try {
    await storeApi.initBrain(repoRoot);
    await callback(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function renderResults(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const bucket = grouped.get(entry.category) ?? [];
    bucket.push(entry);
    grouped.set(entry.category, bucket);
  }

  process.stdout.write("# RepoBrain Proof Evaluations\n\n");
  for (const [category, bucket] of grouped.entries()) {
    process.stdout.write(`## ${category}\n\n`);
    for (const entry of bucket) {
      process.stdout.write(`- ${entry.status}: ${entry.name}\n`);
      if (entry.detail) {
        process.stdout.write(`  ${entry.detail}\n`);
      }
    }
    process.stdout.write("\n");
  }
}
