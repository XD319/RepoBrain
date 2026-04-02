import assert from "node:assert/strict";
import path from "node:path";

import {
  buildFailureDetectionPrompt,
  detectFailures,
} from "../dist/failure-detector.js";

const repoRoot = process.cwd();
const fixturePath = path.join(repoRoot, "test", "fixtures", "failure-detector-fixture.mjs");
const fixtureCommand = `"${process.execPath}" "${fixturePath}"`;

await runTest("detectFailures returns parsed violation and new failure events", async () => {
  await withEnv(
    {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
      DETECTOR_FIXTURE_MODE: "success",
    },
    async () => {
      const events = detectFailures(
        [
          "The agent edited the refund flow.",
          "It skipped the transaction helper and wrote directly to the payments table.",
          "Later it retried the flaky browser test several times without checking the Playwright trace.",
        ].join("\n"),
        [
          createMemory({
            title: "Keep payment writes inside the transaction helper",
            type: "decision",
            date: "2026-04-01T08:00:00.000Z",
          }),
          createMemory({
            title: "Check Playwright traces before browser test retries",
            type: "gotcha",
            date: "2026-04-01T09:00:00.000Z",
          }),
        ],
      );

      assert.deepEqual(events, [
        {
          kind: "violated_memory",
          description: "Ignored the transaction helper memory and wrote directly to the payments table.",
          relatedMemoryFile: "2026-04-01-keep-payment-writes-inside-the-transaction-helper.md",
          suggestedAction: "boost_score",
        },
        {
          kind: "new_failure",
          description: "Repeated flaky browser test debugging without checking Playwright traces first.",
          suggestedAction: "extract_new",
          draftContent:
            "gotcha: Check Playwright traces before retrying flaky browser tests\n\nWhen a browser test flakes, inspect the saved Playwright trace first so debugging starts from captured evidence instead of repeated blind reruns.",
        },
      ]);
    },
  );
});

await runTest("detectFailures returns an empty array for normal sessions", async () => {
  await withEnv(
    {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
      DETECTOR_FIXTURE_MODE: "empty",
    },
    async () => {
      const events = detectFailures("The session completed cleanly without regressions.", [createMemory()]);
      assert.deepEqual(events, []);
    },
  );
});

await runTest("detectFailures is silent when the command fails or returns invalid JSON", async () => {
  await withEnv(
    {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
      DETECTOR_FIXTURE_MODE: "error",
    },
    async () => {
      assert.deepEqual(detectFailures("bad session", [createMemory()]), []);
    },
  );

  await withEnv(
    {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
      DETECTOR_FIXTURE_MODE: "invalid-json",
    },
    async () => {
      assert.deepEqual(detectFailures("bad session", [createMemory()]), []);
    },
  );
});

await runTest("detectFailures keeps valid events and drops malformed ones", async () => {
  await withEnv(
    {
      BRAIN_EXTRACTOR_COMMAND: fixtureCommand,
      DETECTOR_FIXTURE_MODE: "partial-invalid",
    },
    async () => {
      const events = detectFailures("bad session", [createMemory()]);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.kind, "violated_memory");
    },
  );
});

await runTest("buildFailureDetectionPrompt keeps the request inside the single-call token budget", async () => {
  const prompt = buildFailureDetectionPrompt(
    Array.from({ length: 500 }, (_, index) => `Step ${index}: repeated failure details for the session log.`).join("\n"),
    Array.from({ length: 100 }, (_, index) =>
      createMemory({
        title: `Memory ${index} with a long descriptive title for prompt trimming`,
        type: index % 2 === 0 ? "decision" : "gotcha",
        date: `2026-04-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
      }),
    ),
  );

  assert.ok(approximateTokens(prompt) <= 2000, `prompt exceeded budget: ${approximateTokens(prompt)}`);
  assert.match(prompt, /Existing memory index/);
  assert.match(prompt, /Session log:/);
  assert.match(prompt, /\[truncated\]|\.\.\. \(\d+ more memories omitted/);
});

await runTest("buildFailureDetectionPrompt uses explicit filenames when memory metadata includes them", async () => {
  const memory = {
    ...createMemory(),
    relativePath: ".brain/gotchas/real-file-name.md",
  };

  const prompt = buildFailureDetectionPrompt("session log", [memory]);
  assert.match(prompt, /real-file-name\.md/);
});

console.log("All failure-detector tests passed.");

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function withEnv(values, callback) {
  const previous = new Map();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createMemory(overrides = {}) {
  return {
    type: "gotcha",
    title: "Example memory",
    summary: "Example summary",
    detail: "## GOTCHA\n\nExample detail that is long enough to stay realistic.",
    tags: ["example"],
    importance: "medium",
    date: "2026-04-01T08:00:00.000Z",
    score: 60,
    hit_count: 0,
    last_used: null,
    created_at: "2026-04-01",
    stale: false,
    status: "active",
    ...overrides,
  };
}

function approximateTokens(text) {
  let asciiChars = 0;
  let nonAsciiTokens = 0;

  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiTokens += 1;
    }
  }

  return Math.ceil(asciiChars / 4) + nonAsciiTokens;
}
