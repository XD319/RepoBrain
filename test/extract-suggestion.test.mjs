import assert from "node:assert/strict";

import {
  evaluateExtractWorthiness,
  renderExtractSuggestionJson,
  renderExtractSuggestionMarkdown,
} from "../dist/store-api.js";

await runTest("returns should_extract=true for architecture decision with rationale", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "We decided to adopt tsup as the build tool because it produces ESM output with declaration files in a single pass.",
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.confidence >= 0.5);
  assert.equal(result.suggested_type, "decision");
  assert.ok(result.evidence.some((e) => e.rule === "architecture_decision"));
});

await runTest("returns should_extract=true for gotcha / pitfall language", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "Never write directly to the payments table outside the transaction helper, otherwise you risk partial writes and data loss.",
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.confidence >= 0.5);
  assert.equal(result.suggested_type, "gotcha");
  assert.ok(result.evidence.some((e) => e.rule === "risk_or_pitfall"));
});

await runTest("returns should_extract=true for convention language", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "Convention: always put migration files under db/migrations/ and use the naming standard YYYYMMDD_description.sql.",
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.suggested_type === "convention" || result.suggested_type === "decision");
  assert.ok(result.evidence.some((e) => e.rule === "convention_established"));
});

await runTest("returns should_extract=true for reusable pattern language", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "Extract a reusable helper that wraps all S3 upload calls with retry logic and fan out the results through the shared parser.",
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.evidence.some((e) => e.rule === "reusable_pattern"));
});

await runTest("returns should_extract=true for goal / migration language", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "Long term goal: migrate all legacy REST endpoints to the new GraphQL API. The end state is removing the old Express router entirely.",
  });

  assert.equal(result.should_extract, true);
  assert.equal(result.suggested_type, "goal");
  assert.ok(result.evidence.some((e) => e.rule === "multi_session_goal"));
});

await runTest("returns should_extract=false for format-only changes", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "chore: run prettier on all files",
    changedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "format_only"));
});

await runTest("returns should_extract=false for dependency bump with only lock files", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "chore: bump version of lodash dependency update",
    changedFiles: ["package-lock.json", "package.json"],
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "dependency_bump"));
});

await runTest("returns should_extract=false for typo fix", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "fix typo in README",
    changedFiles: ["README.md"],
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "typo_fix"));
});

await runTest("returns should_extract=false for debug-only work", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "Added console.log statements for debugging the auth flow. This is temporary for now.",
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "debug_only"));
});

await runTest("returns should_extract=false for snapshot-only changes", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "update snapshots",
    changedFiles: [
      "test/__snapshots__/app.snap",
      "test/__snapshots__/header.snap",
    ],
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "snapshot_update"));
});

await runTest("returns should_extract=false for merge commits", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "Merge branch 'feature/auth' into main",
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "merge_commit"));
});

await runTest("returns should_extract=false for revert commits", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "Revert \"feat: add new login flow\"",
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "revert_commit"));
});

await runTest("returns should_extract=false for empty or trivial input", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "ok done",
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "empty_or_trivial_input"));
});

await runTest("detects cross-module changes as positive signal", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "Decided to refactor the authentication module because the old pattern was causing race conditions in the API layer.",
    changedFiles: [
      "src/auth/login.ts",
      "src/api/routes.ts",
      "db/migrations/001.sql",
      "test/auth.test.ts",
    ],
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.evidence.some((e) => e.rule === "cross_module_change"));
});

await runTest("detects schema/migration files as positive signal", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "feat: add user roles table",
    changedFiles: ["db/migrations/002_add_user_roles.sql", "src/models/user.ts"],
  });

  assert.ok(result.evidence.some((e) => e.rule === "schema_or_migration"));
});

await runTest("constraint language boosts confidence", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "You must never call the payment API without first acquiring a distributed lock. This is required to prevent double charges.",
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.evidence.some((e) => e.rule === "constraint_language"));
  assert.ok(result.confidence >= 0.5);
});

await runTest("positive signals override negative suppressions when strong enough", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "Decided to adopt a new convention: always use the transaction helper for payment writes because direct writes risk partial data loss. This is temporary debug log for now.",
    changedFiles: ["src/payments/handler.ts"],
  });

  assert.equal(result.should_extract, true);
  assert.ok(result.suppressions.some((s) => s.rule === "debug_only"));
  assert.ok(result.reasons.some((r) => r.includes("suppression")));
});

await runTest("ambiguous input produces low confidence", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "Updated the login page with a minor refactor.",
    changedFiles: ["src/login.tsx"],
  });

  assert.ok(result.confidence < 0.5);
});

await runTest("Chinese gotcha language is detected", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "不要直接往 payments 表里写数据，否则会导致数据丢失。必须通过 transaction helper 来操作。",
  });

  assert.equal(result.should_extract, true);
  assert.equal(result.suggested_type, "gotcha");
});

await runTest("Chinese decision language is detected", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "决定采用 tsup 作为构建工具，因为它能一次输出 ESM 和类型声明。",
  });

  assert.equal(result.should_extract, true);
  assert.equal(result.suggested_type, "decision");
});

await runTest("test failure fix with test file changes is detected", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "Fixed a flaky test that was failing intermittently.",
    testResultSummary: "3 tests fixed, 0 failing",
    changedFiles: ["test/auth.test.ts", "src/auth.ts"],
  });

  assert.ok(result.evidence.some((e) => e.rule === "test_failure_fix"));
});

await runTest("single_line_change suppression fires for tiny diffs", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "fix: update constant",
    diffStat: " src/config.ts | 2 ++\n 1 file changed, 2 insertions(+)",
  });

  assert.ok(result.evidence.some((e) => e.rule === "single_line_change"));
});

await runTest("rename-only changes are suppressed", () => {
  const result = evaluateExtractWorthiness({
    commitMessage: "rename getUserById to findUserById",
    changedFiles: ["src/user.ts"],
  });

  assert.equal(result.should_extract, false);
  assert.ok(result.suppressions.some((s) => s.rule === "rename_only"));
});

await runTest("CI config-only changes are suppressed when no learning signal", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "Updated the GitHub Actions config to add node version 22 to the build matrix for broader compatibility.",
    changedFiles: [".github/workflows/ci.yml"],
  });

  assert.ok(result.suppressions.some((s) => s.rule === "ci_config_only"));
  assert.equal(result.should_extract, false);
});

await runTest("renderExtractSuggestionMarkdown produces valid markdown output", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary:
      "We decided to use tsup because it produces clean ESM output. Never use webpack for this project.",
  });

  const md = renderExtractSuggestionMarkdown(result);
  assert.match(md, /# Extract Suggestion/);
  assert.match(md, /\*\*Should extract:\*\*/);
  assert.match(md, /\*\*Confidence:\*\*/);
  assert.match(md, /## Evidence/);
  assert.match(md, /## Summary/);
});

await runTest("renderExtractSuggestionJson produces valid JSON", () => {
  const result = evaluateExtractWorthiness({
    sessionSummary: "Decision: adopt GraphQL because REST is too chatty.",
  });

  const json = renderExtractSuggestionJson(result);
  const parsed = JSON.parse(json);
  assert.equal(typeof parsed.should_extract, "boolean");
  assert.equal(typeof parsed.confidence, "number");
  assert.ok(Array.isArray(parsed.evidence));
  assert.ok(Array.isArray(parsed.suppressions));
  assert.ok(Array.isArray(parsed.reasons));
  assert.equal(typeof parsed.summary, "string");
});

await runTest("result has stable shape with all required fields", () => {
  const result = evaluateExtractWorthiness({ sessionSummary: "hello" });

  assert.equal(typeof result.should_extract, "boolean");
  assert.equal(typeof result.confidence, "number");
  assert.ok(result.suggested_type === null || typeof result.suggested_type === "string");
  assert.ok(Array.isArray(result.reasons));
  assert.ok(Array.isArray(result.evidence));
  assert.ok(Array.isArray(result.suppressions));
  assert.equal(typeof result.summary, "string");

  for (const e of result.evidence) {
    assert.equal(typeof e.rule, "string");
    assert.ok(["positive", "negative", "neutral"].includes(e.signal));
    assert.equal(typeof e.weight, "number");
    assert.equal(typeof e.detail, "string");
  }

  for (const s of result.suppressions) {
    assert.equal(typeof s.rule, "string");
    assert.equal(typeof s.detail, "string");
  }
});

await runTest("confidence is always between 0 and 1", () => {
  const inputs = [
    { sessionSummary: "" },
    { sessionSummary: "ok" },
    { sessionSummary: "Decided to adopt because of safety. Must not skip. Never ignore. Avoid data loss. Risk of regression." },
    { commitMessage: "Merge branch 'x'" },
    { commitMessage: "Revert everything", sessionSummary: "console.log debug temporary" },
  ];

  for (const input of inputs) {
    const result = evaluateExtractWorthiness(input);
    assert.ok(result.confidence >= 0, `confidence ${result.confidence} < 0`);
    assert.ok(result.confidence <= 1, `confidence ${result.confidence} > 1`);
  }
});

console.log("All extract-suggestion tests passed.");

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
