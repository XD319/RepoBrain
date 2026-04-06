import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { expect, it } from "vitest";

import { initBrain, saveMemory, loadStoredMemoryRecords } from "../dist/store-api.js";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "dist", "cli.js");

await runTest("mcp server exposes and serves the expanded toolset", async () => {
  await withTempRepo(async (projectRoot) => {
    await initBrain(projectRoot);
    const now = new Date().toISOString();
    await saveMemory(
      {
        type: "decision",
        title: "Route browser testing through Playwright",
        summary: "Prefer Playwright tooling for browser test debugging.",
        detail: "## DECISION\n\nUse Playwright guidance first for browser test related tasks.",
        tags: ["playwright", "testing"],
        importance: "medium",
        date: now,
        score: 60,
        hit_count: 0,
        last_used: null,
        created_at: now,
        stale: false,
        status: "active",
        source: "manual",
        skill_trigger_tasks: ["debug flaky browser tests"],
        recommended_skills: ["playwright"],
      },
      projectRoot,
    );
    await saveMemory(
      {
        type: "gotcha",
        title: "Candidate memory pending review",
        summary: "A pending candidate should show in review output.",
        detail: "## GOTCHA\n\nPending candidate detail.",
        tags: ["candidate"],
        importance: "medium",
        date: now,
        score: 60,
        hit_count: 0,
        last_used: null,
        created_at: now,
        stale: false,
        status: "candidate",
        source: "session",
      },
      projectRoot,
    );
    const client = createMcpClient(projectRoot);
    try {
      const initialize = await client.call("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "repobrain-test", version: "0.0.0" },
      });
      assert.equal(initialize.protocolVersion, "2025-06-18");

      const listed = await client.call("tools/list", {});
      const toolNames = listed.tools.map((tool) => tool.name);
      for (const name of [
        "brain_get_context",
        "brain_add_memory",
        "brain_suggest_skills",
        "brain_route",
        "brain_capture",
        "brain_review",
        "brain_approve",
        "brain_list",
        "brain_status",
      ]) {
        assert.ok(toolNames.includes(name), `Expected tool ${name} in tools/list`);
      }

      const shortlist = await client.callTool("brain_suggest_skills", {
        task: "debug flaky browser tests",
        paths: ["tests/e2e/login.spec.ts"],
      });
      assert.ok(shortlist.structuredContent?.invocation_plan);

      const route = await client.callTool("brain_route", {
        task: "debug flaky browser tests",
        paths: ["tests/e2e/login.spec.ts"],
      });
      assert.ok(route.structuredContent?.context_markdown);
      assert.ok(route.structuredContent?.skill_plan);

      const reviewBefore = await client.callTool("brain_review", {});
      assert.equal(reviewBefore.structuredContent.count, 1);

      const firstCandidate = reviewBefore.structuredContent.candidates[0];
      assert.ok(firstCandidate?.id);
      await client.callTool("brain_approve", { memoryId: firstCandidate.id });

      const reviewAfter = await client.callTool("brain_review", {});
      assert.equal(reviewAfter.structuredContent.count, 0);

      const list = await client.callTool("brain_list", { type: "decision" });
      assert.ok(list.structuredContent.count >= 1);

      const status = await client.callTool("brain_status", {});
      assert.ok(typeof status.structuredContent.total_memories === "number");

      const capture = await client.callTool("brain_capture", {
        task: "decided to route browser tests through playwright because flaky tests keep failing",
        summary:
          "decision: route browser tests through playwright because it reduces flaky retries and keeps CI behavior consistent",
        paths: ["tests/e2e/login.spec.ts"],
      });
      assert.ok(capture.structuredContent?.suggestion);

      const records = await loadStoredMemoryRecords(projectRoot);
      assert.ok(records.length >= 2);
    } finally {
      await client.close();
    }
  });
});

function createMcpClient(cwd) {
  // Run through CLI command so stdio server is started reliably.
  // Direct dist/mcp/server.js is currently a module-style entrypoint export.
  const viaCli = spawn(process.execPath, [cliPath, "mcp"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();

  viaCli.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (true) {
      const sep = buffer.indexOf("\r\n\r\n");
      if (sep === -1) {
        break;
      }
      const headerText = buffer.slice(0, sep).toString("utf8");
      const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        break;
      }
      const contentLength = Number(contentLengthMatch[1]);
      const bodyStart = sep + 4;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) {
        break;
      }
      const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.slice(bodyEnd);
      const message = JSON.parse(body);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });

  function send(payload) {
    const body = JSON.stringify(payload);
    viaCli.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  async function call(method, params) {
    const id = nextId++;
    const response = await new Promise((resolve, reject) => {
      pending.set(id, resolve);
      send({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`MCP request timeout for method: ${method}`));
        }
      }, 10000);
    });

    if (response.error) {
      throw new Error(response.error.message || `MCP error for ${method}`);
    }
    return response.result;
  }

  return {
    call,
    callTool(name, args) {
      return call("tools/call", { name, arguments: args });
    },
    async close() {
      viaCli.kill();
    },
  };
}

async function withTempRepo(callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "repobrain-mcp-"));
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
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
};
