import { spawn } from "node:child_process";

import { appendErrorLog } from "./store.js";
import type { BrainConfig, ExtractedMemoriesPayload, Memory, MemoryType } from "./types.js";
import { IMPORTANCE_LEVELS, MEMORY_TYPES } from "./types.js";

const EXTRACTION_PROMPT = `You are a repo knowledge extractor. Analyze the completed coding conversation or change summary and extract only project knowledge that deserves to persist across future sessions.

Only extract these categories:
1. DECISION: important architecture or technology choices and why they were made
2. GOTCHA: known pitfalls, limitations, or "do not do X because Y"
3. CONVENTION: naming, directory layout, code style, or collaboration conventions
4. PATTERN: reusable implementation or workflow patterns

Extraction rules:
- Only keep knowledge that is still useful in future sessions
- Prefer why and scope, not a plain description of what changed
- Ignore temporary discussion, greetings, and one-off details
- Fewer and more accurate memories are better than many weak ones

Return strict JSON only:
{
  "memories": [
    {
      "type": "decision",
      "title": "Short title",
      "summary": "One-sentence summary",
      "detail": "Markdown detail with background, decision or limitation, and scope",
      "tags": ["tag1", "tag2"],
      "importance": "high|medium|low",
      "source": "session"
    }
  ]
}

If there is nothing worth saving, return {"memories": []}. Do not output anything except JSON.`;

export async function extractMemories(
  conversationText: string,
  config: BrainConfig,
  projectRoot: string = process.cwd(),
): Promise<Memory[]> {
  const trimmed = conversationText.trim();
  if (!trimmed) {
    return [];
  }

  const prompt = buildExtractionPrompt(trimmed, config);
  const extractorCommand = process.env.BRAIN_EXTRACTOR_COMMAND?.trim();

  if (!extractorCommand) {
    return heuristicExtract(trimmed, config);
  }

  try {
    const rawOutput = await runExtractorCommand(extractorCommand, prompt);
    const parsed = safeParsePayload(rawOutput);
    if (!parsed.ok) {
      await appendErrorLog(projectRoot, `Extractor output invalid: ${parsed.error}`);
      return heuristicExtract(trimmed, config);
    }

    return parsed.payload.memories;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendErrorLog(projectRoot, `Extractor command failed: ${message}`);
    return heuristicExtract(trimmed, config);
  }
}

export function buildExtractionPrompt(conversationText: string, config: BrainConfig): string {
  return [
    EXTRACTION_PROMPT,
    "",
    `Preferred output language: ${config.language}`,
    "",
    "Content to analyze:",
    conversationText,
  ].join("\n");
}

async function runExtractorCommand(command: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // The extractor command receives the full prompt on stdin and must return strict JSON on stdout.
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Extractor exited with code ${code}`));
        return;
      }

      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function safeParsePayload(
  raw: string,
):
  | { ok: true; payload: ExtractedMemoriesPayload }
  | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as { memories?: unknown };
    if (!Array.isArray(parsed.memories)) {
      return { ok: false, error: "JSON payload must include a memories array." };
    }

    const memories = parsed.memories
      .map((entry) => normalizeMemory(entry))
      .filter((memory): memory is Memory => memory !== null);

    if (memories.length !== parsed.memories.length) {
      return {
        ok: false,
        error: "One or more memory entries were missing required fields or used unsupported values.",
      };
    }

    return { ok: true, payload: { memories } };
  } catch {
    return { ok: false, error: buildJsonParseErrorMessage(raw) };
  }
}

function normalizeMemory(value: unknown): Memory | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const type = asNonEmptyString(candidate.type);
  const title = asNonEmptyString(candidate.title);
  const summary = asNonEmptyString(candidate.summary);
  const detail = asNonEmptyString(candidate.detail);
  const importance = asNonEmptyString(candidate.importance);

  if (
    !type ||
    !title ||
    !summary ||
    !detail ||
    !importance ||
    !MEMORY_TYPES.includes(type as MemoryType) ||
    !IMPORTANCE_LEVELS.includes(importance as Memory["importance"])
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const createdAt = toIsoDateOnly(now);

  const memory: Memory = {
    type: type as MemoryType,
    title,
    summary,
    detail,
    tags: Array.isArray(candidate.tags)
      ? candidate.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [],
    importance: importance as Memory["importance"],
    date: now,
    score: getInitialExtractedMemoryScore(type as MemoryType, importance as Memory["importance"]),
    hit_count: 0,
    last_used: null,
    created_at: createdAt,
    stale: false,
    status: "active",
  };

  const source = normalizeSource(candidate.source);
  if (source) {
    memory.source = source;
  }

  return memory;
}

function heuristicExtract(conversationText: string, config: BrainConfig): Memory[] {
  const blocks = conversationText
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const extracted = blocks
    .map((block) => blockToMemory(block, config))
    .filter((memory): memory is Memory => memory !== null);

  return dedupeByTitle(extracted);
}

function blockToMemory(block: string, config: BrainConfig): Memory | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = lines.at(0);

  if (!firstLine) {
    return null;
  }

  const prefixMatch = firstLine.match(
    /^(?:[-*]\s*)?(decision|gotcha|convention|pattern)\s*[:\-]\s*(.+)$/i,
  );
  if (!prefixMatch) {
    return null;
  }

  const rawType = prefixMatch[1];
  const rawHeadline = prefixMatch[2];
  if (!rawType || !rawHeadline) {
    return null;
  }

  const type = rawType.toLowerCase() as MemoryType;
  const title = rawHeadline.trim().slice(0, 80);
  const summary = summarizeBlock(lines, config.language);

  const now = new Date().toISOString();
  const importance = deriveImportance(block);

  return {
    type,
    title,
    summary,
    detail: buildDetail(type, block),
    tags: deriveTags(block),
    importance,
    date: now,
    score: getInitialExtractedMemoryScore(type, importance),
    hit_count: 0,
    last_used: null,
    created_at: toIsoDateOnly(now),
    stale: false,
    source: "session",
    status: "active",
  };
}

function summarizeBlock(lines: string[], language: string): string {
  const headline = lines
    .at(0)
    ?.replace(/^(?:[-*]\s*)?(decision|gotcha|convention|pattern)\s*[:\-]\s*/i, "")
    .trim();
  if (headline) {
    return headline.slice(0, 120);
  }

  return language.startsWith("zh")
    ? "Extracted one reusable project memory."
    : "Extracted one reusable project memory.";
}

function buildDetail(type: MemoryType, block: string): string {
  const heading = `## ${type.toUpperCase()}`;
  return `${heading}\n\n${block.trim()}`;
}

function deriveTags(block: string): string[] {
  const matches = block.match(/[A-Za-z][A-Za-z0-9/_-]{2,}/g) ?? [];
  return Array.from(new Set(matches.map((tag) => tag.toLowerCase()))).slice(0, 5);
}

function deriveImportance(block: string): Memory["importance"] {
  if (/(must|critical|core|never|avoid|always)/i.test(block)) {
    return "high";
  }

  if (/(prefer|should|convention|recommended|use)/i.test(block)) {
    return "medium";
  }

  return "low";
}

function normalizeSource(value: unknown): Memory["source"] | null {
  if (typeof value !== "string") {
    return "session";
  }

  if (value === "session" || value === "git-commit" || value === "manual" || value === "pr") {
    return value;
  }

  return "session";
}

function getInitialExtractedMemoryScore(
  type: MemoryType,
  importance: Memory["importance"],
): number {
  if (type === "gotcha") {
    if (importance === "high") {
      return 75;
    }

    if (importance === "medium") {
      return 60;
    }
  }

  if (type === "decision") {
    return 65;
  }

  if (type === "convention") {
    return 55;
  }

  return 50;
}

function toIsoDateOnly(value: string): string {
  return value.slice(0, 10);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dedupeByTitle(memories: Memory[]): Memory[] {
  const seen = new Set<string>();
  return memories.filter((memory) => {
    const key = `${memory.type}:${memory.title.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildJsonParseErrorMessage(raw: string): string {
  const preview = raw.replace(/\s+/g, " ").trim().slice(0, 200);
  return preview
    ? `stdout was not valid JSON. Preview: ${preview}`
    : "stdout was empty or not valid JSON.";
}
