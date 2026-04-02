import { readFileSync } from "node:fs";

const stdin = readFileSync(0, "utf8");

if (stdin.includes("You are a repo failure detector.")) {
  const relatedMemoryFile =
    process.env.DETECT_RELATED_FILE ??
    "2026-04-01-keep-payment-writes-inside-the-transaction-helper.md";
  process.stdout.write(
    JSON.stringify([
      {
        kind: "violated_memory",
        description: "The session skipped the transaction helper and wrote directly to payments storage.",
        relatedMemoryFile,
        suggestedAction: "boost_score",
      },
      {
        kind: "new_failure",
        description: "The session repeated flaky browser test retries without opening the trace.",
        suggestedAction: "extract_new",
        draftContent:
          "gotcha: Check Playwright traces before retrying flaky browser tests\n\nOpen the saved trace first so debugging starts from captured evidence instead of repeated blind reruns.",
      },
    ]),
  );
  process.exit(0);
}

if (stdin.includes("Rewrite the memory body as a short warning for future agents.")) {
  process.stdout.write(
    JSON.stringify({
      body: "⚠️ 不要绕过 transaction helper 直接写 payments。反例：本次 session 直接写表，导致既有约束再次失效。",
    }),
  );
  process.exit(0);
}

if (stdin.includes("Improve this gotcha memory draft for RepoBrain.")) {
  process.stdout.write(
    JSON.stringify({
      title: "Check Playwright traces before retrying flaky browser tests",
      summary: "Inspect the saved Playwright trace before rerunning a flaky browser test.",
      detail:
        "## GOTCHA\n\nInspect the saved Playwright trace before retrying a flaky browser test. Repeated blind reruns hide the first useful failure signal.",
      tags: ["playwright", "tests", "trace"],
      importance: "medium",
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ memories: [] }));
