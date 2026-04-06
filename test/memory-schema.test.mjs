import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildMemorySchemaReport, initBrain, normalizeMemorySchemas, saveMemory } from "../dist/store-api.js";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");

await runTest("schema lint reports invalid enums, conflicts, and missing skill metadata", async () => {
  await withTempRepo(async (projectRoot) => {
    const invalidFile = path.join(projectRoot, ".brain", "decisions", "2026-04-03-invalid.md");
    await writeFile(
      invalidFile,
      [
        "---",
        'type: "decision"',
        'title: "Broken skill routing"',
        'summary: "This entry mixes conflicting metadata."',
        "tags:",
        '  - "skills"',
        'importance: "medium"',
        'date: "2026-04-03T10:00:00.000Z"',
        "required_skills:",
        '  - "playwright"',
        "suppressed_skills:",
        '  - "playwright"',
        'risk_level: "urgent"',
        "---",
        "",
        "## DECISION",
        "",
        "This entry intentionally breaks schema governance.",
        "",
      ].join("\n"),
      "utf8",
    );

    const report = await buildMemorySchemaReport(projectRoot);
    const file = report.files.find((entry) => entry.memory_id === "2026-04-03-invalid");

    assert.ok(file);
    assert.equal(file.healthy, false);
    assert.match(JSON.stringify(file.issues), /invalid_enum/);
    assert.match(JSON.stringify(file.issues), /conflict_field/);
    assert.match(JSON.stringify(file.issues), /missing_skill_metadata/);
  });
});

await runTest("schema normalize autofills dates and deduplicates tags scope and skills", async () => {
  await withTempRepo(async (projectRoot) => {
    const targetFile = path.join(projectRoot, ".brain", "patterns", "2026-04-03-normalize-me.md");
    await writeFile(
      targetFile,
      [
        "---",
        'type: "pattern"',
        'title: "Normalize metadata"',
        'summary: "Keep frontmatter compact and consistent."',
        "tags:",
        '  - "zeta"',
        '  - "alpha"',
        '  - "alpha"',
        'importance: "medium"',
        'date: "2026-04-03T10:30:00.000Z"',
        'created: "2026-04-01"',
        "path_scope:",
        '  - "./src/api//"',
        '  - "."',
        '  - "src/api"',
        "files:",
        '  - "src/api/user.ts"',
        '  - ".\\\\src\\\\api\\\\user.ts"',
        "recommended_skills:",
        '  - "playwright"',
        '  - "playwright"',
        "---",
        "",
        "## PATTERN",
        "",
        "Keep metadata compact and reviewable.",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await normalizeMemorySchemas(projectRoot);
    const file = result.files.find((entry) => entry.memory_id === "2026-04-03-normalize-me");
    assert.ok(file);
    assert.equal(file.fixable, true);

    const raw = await readFile(targetFile, "utf8");
    assert.match(raw, /created_at: "2026-04-01T00:00:00.000Z"/);
    assert.match(raw, /created: "2026-04-01"/);
    assert.match(raw, /updated: "2026-04-01"/);
    assert.ok(raw.indexOf('  - "alpha"') < raw.indexOf('  - "zeta"'));
    assert.equal((raw.match(/recommended_skills:/g) ?? []).length, 1);
    assert.match(raw, /recommended_skills:\n  - "playwright"/);
    assert.match(raw, /path_scope:\n  - "src\/api"/);
    assert.match(raw, /files:\n  - "src\/api\/user.ts"/);
  });
});

await runTest("brain lint-memory and normalize-memory expose schema health in CLI output", async () => {
  await withTempRepo(async (projectRoot) => {
    await saveMemory(
      {
        type: "working",
        title: "Legacy checklist",
        summary: "Keep a small working checklist during the migration.",
        detail: "## WORKING\n\nKeep the migration checklist short-lived.",
        tags: ["checklist", "checklist", "migration"],
        importance: "medium",
        date: "2026-04-03T09:00:00.000Z",
        created: "2026-04-02",
        files: ["src/auth//", ".\\src\\auth"],
        recommended_skills: ["playwright", "playwright"],
      },
      projectRoot,
    );

    const lintResult = await runCliProcess(["lint-memory"], projectRoot);
    assert.equal(lintResult.code, 0);
    assert.match(lintResult.stdout, /Schema health:/);
    assert.match(lintResult.stdout, /needs_normalize/);

    const normalizeResult = await runCliProcess(["normalize-memory"], projectRoot);
    assert.equal(normalizeResult.code, 0);
    assert.match(normalizeResult.stdout, /Normalized files: 1/);

    const statsResult = await runCliProcess(["stats"], projectRoot);
    assert.equal(statsResult.code, 0);
    assert.match(statsResult.stdout, /Schema health:/);

    const statusResult = await runCliProcess(["status"], projectRoot);
    assert.equal(statusResult.code, 0);
    assert.match(statusResult.stdout, /Schema health:/);
  });
});

console.log("All memory schema tests passed.");

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-schema-"));

  try {
    await initBrain(projectRoot);
    await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function runCliProcess(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
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
