#!/usr/bin/env node

import { stdin as input, stdout as output, stderr } from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.js";
import { buildInjection } from "../inject.js";
import { initBrain, saveMemory, updateIndex } from "../store.js";
import type { Memory } from "../types.js";

const SERVER_INFO = {
  name: "repobrain",
  version: "0.1.0",
};

const SUPPORTED_PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

const TOOLS: ToolDefinition[] = [
  {
    name: "brain_get_context",
    title: "Get Repo Context",
    description: "Build RepoBrain session context from .brain memories.",
    inputSchema: {
      type: "object",
      properties: {
        maxTokens: {
          type: "integer",
          minimum: 1,
          description: "Optional override for the injection token budget.",
        },
        task: {
          type: "string",
          description: "Optional task description for task-aware memory selection.",
        },
        paths: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Optional target paths for task-aware memory selection.",
        },
        modules: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Optional module or subsystem keywords for task-aware memory selection.",
        },
      },
    },
    annotations: {
      title: "Get Repo Context",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "brain_add_memory",
    title: "Add Repo Memory",
    description: "Save a new decision, gotcha, convention, or pattern into .brain.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["decision", "gotcha", "convention", "pattern"],
        },
        title: {
          type: "string",
          minLength: 1,
        },
        content: {
          type: "string",
          minLength: 1,
        },
        importance: {
          type: "string",
          enum: ["high", "medium", "low"],
        },
      },
      required: ["type", "title", "content"],
    },
    annotations: {
      title: "Add Repo Memory",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

export async function runMcpServer(projectRoot: string = process.cwd()): Promise<void> {
  const parser = new StdioMessageParser(async (message) => {
    const request = safeParseRequest(message);
    if (!request) {
      return;
    }

    try {
      const result = await handleRequest(request, projectRoot);
      if (request.id !== undefined && request.id !== null && result !== undefined) {
        writeResponse({ jsonrpc: "2.0", id: request.id, result });
      }
    } catch (error) {
      if (request.id !== undefined && request.id !== null) {
        writeResponse({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } else {
        debugLog(error instanceof Error ? error.message : String(error));
      }
    }
  });

  for await (const chunk of input) {
    parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
}

async function handleRequest(
  request: JsonRpcRequest,
  projectRoot: string,
): Promise<Record<string, unknown> | undefined> {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: SUPPORTED_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
        instructions:
          "Use brain_get_context to load repo memory before coding. Use brain_add_memory to save durable decisions, gotchas, conventions, or patterns back into .brain.",
      };
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return {
        tools: TOOLS,
      };
    case "tools/call":
      return callTool(request.params ?? {}, projectRoot);
    case "ping":
      return {};
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

async function callTool(
  params: Record<string, unknown>,
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const name = typeof params.name === "string" ? params.name : "";
  const args = isPlainObject(params.arguments) ? params.arguments : {};

  switch (name) {
    case "brain_get_context":
      return handleGetContext(args, projectRoot);
    case "brain_add_memory":
      return handleAddMemory(args, projectRoot);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleGetContext(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const config = await loadConfig(projectRoot);
  const maxTokens = normalizePositiveInteger(args.maxTokens);
  const task = typeof args.task === "string" && args.task.trim() ? args.task.trim() : undefined;
  const paths = asOptionalStringArray(args.paths, "paths");
  const modules = asOptionalStringArray(args.modules, "modules");
  const injection = await buildInjection(projectRoot, {
    ...config,
    ...(maxTokens ? { maxInjectTokens: maxTokens } : {}),
  }, {
    ...(task ? { task } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    ...(modules.length > 0 ? { modules } : {}),
  });

  return {
    content: [
      {
        type: "text",
        text: injection,
      },
    ],
    structuredContent: {
      markdown: injection,
    },
  };
}

async function handleAddMemory(
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<Record<string, unknown>> {
  const type = asRequiredEnum(args.type, ["decision", "gotcha", "convention", "pattern"], "type");
  const title = asRequiredString(args.title, "title");
  const content = asRequiredString(args.content, "content");
  const importance = asEnum(args.importance, ["high", "medium", "low"]) ?? "medium";

  await initBrain(projectRoot);
  const now = new Date().toISOString();

  const memory: Memory = {
    type,
    title,
    summary: title,
    detail: `## ${type.toUpperCase()}\n\n${content}`,
    tags: deriveTagsFromText(`${title}\n${content}`),
    importance,
    date: now,
    score: 60,
    hit_count: 0,
    last_used: null,
    created_at: now,
    stale: false,
    source: "manual",
    status: "active",
  };

  const filePath = await saveMemory(memory, projectRoot);
  await updateIndex(projectRoot);

  return {
    content: [
      {
        type: "text",
        text: `Saved ${type} memory to ${path.relative(projectRoot, filePath).replace(/\\/g, "/")}`,
      },
    ],
    structuredContent: {
      success: true,
      filePath,
    },
  };
}

function deriveTagsFromText(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9/_-]{2,}/g) ?? [];
  return Array.from(new Set(matches.map((tag) => tag.toLowerCase()))).slice(0, 5);
}

function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool argument "${fieldName}" must be a non-empty string.`);
  }

  return value.trim();
}

function asEnum<T extends string>(value: unknown, allowed: T[]): T | null {
  if (typeof value !== "string") {
    return null;
  }

  return allowed.includes(value as T) ? (value as T) : null;
}

function asRequiredEnum<T extends string>(value: unknown, allowed: T[], fieldName: string): T {
  const normalized = asEnum(value, allowed);
  if (!normalized) {
    throw new Error(`Tool argument "${fieldName}" must be one of: ${allowed.join(", ")}.`);
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function asOptionalStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Tool argument "${fieldName}" must be an array of strings.`);
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalized.length !== value.length) {
    throw new Error(`Tool argument "${fieldName}" must be an array of strings.`);
  }

  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeParseRequest(value: string): JsonRpcRequest | null {
  try {
    const parsed = JSON.parse(value) as JsonRpcRequest;
    if (!parsed || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
      debugLog(`Ignoring invalid MCP message: ${value.slice(0, 200)}`);
      return null;
    }

    return parsed;
  } catch (error) {
    debugLog(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function writeResponse(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function debugLog(message: string): void {
  if (process.env.PROJECT_BRAIN_VERBOSE === "1") {
    stderr.write(`[repobrain:mcp] ${message}\n`);
  }
}

class StdioMessageParser {
  private buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (message: string) => Promise<void>) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    void this.flush();
  }

  private async flush(): Promise<void> {
    while (true) {
      const separatorIndex = this.buffer.indexOf("\r\n\r\n");
      if (separatorIndex === -1) {
        return;
      }

      const headerText = this.buffer.slice(0, separatorIndex).toString("utf8");
      const contentLength = parseContentLength(headerText);
      if (contentLength === null) {
        this.buffer = Buffer.alloc(0);
        throw new Error("Missing Content-Length header.");
      }

      const messageStart = separatorIndex + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const message = this.buffer.slice(messageStart, messageEnd).toString("utf8");
      this.buffer = this.buffer.slice(messageEnd);
      await this.onMessage(message);
    }
  }
}

function parseContentLength(headerText: string): number | null {
  const lines = headerText.split("\r\n");
  for (const line of lines) {
    const match = line.match(/^Content-Length:\s*(\d+)$/i);
    if (!match) {
      continue;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  runMcpServer().catch((error: unknown) => {
    debugLog(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
