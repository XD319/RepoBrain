import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { slugifyMemoryTitle } from "./memory-identity.js";
import type { FailureEvent } from "./failure-detector.js";
import { saveMemory } from "./store.js";
import type { Memory } from "./types.js";

type ViolatedBoostEvent = FailureEvent & {
  kind: "violated_memory";
  suggestedAction: "boost_score";
  relatedMemoryFile: string;
};

type ViolatedRewriteEvent = FailureEvent & {
  kind: "violated_memory";
  suggestedAction: "rewrite_memory";
  relatedMemoryFile: string;
};

type NewFailureExtractEvent = FailureEvent & {
  kind: "new_failure";
  suggestedAction: "extract_new";
  draftContent: string;
};

export type ReinforceResult = {
  boosted: string[];
  rewritten: string[];
  extracted: string[];
};

const REINFORCEMENT_INCREMENT = 15;
const NEW_FAILURE_SCORE = 70;
const BOOST_NOTE_PREFIX = "> ⚡ score 因 session 失败而提升，日期：";

export async function reinforceMemories(
  events: FailureEvent[],
  memoriesDir: string,
): Promise<ReinforceResult> {
  const result: ReinforceResult = {
    boosted: [],
    rewritten: [],
    extracted: [],
  };

  for (const event of events) {
    console.log(`[brain] reinforcing: ${getTargetFileName(event)}`);

    try {
      if (isViolatedBoostEvent(event)) {
        const updatedFile = await boostMemoryScore(event.relatedMemoryFile, memoriesDir);
        if (updatedFile) {
          result.boosted.push(updatedFile);
        }
        continue;
      }

      if (isViolatedRewriteEvent(event)) {
        const updatedFile = await rewriteMemoryFromFailure(event, memoriesDir);
        if (updatedFile) {
          result.rewritten.push(updatedFile);
        }
        continue;
      }

      if (isNewFailureExtractEvent(event)) {
        const createdFile = await extractNewFailureMemory(event, memoriesDir);
        if (createdFile) {
          result.extracted.push(createdFile);
        }
      }
    } catch {
      continue;
    }
  }

  return result;
}

async function boostMemoryScore(fileName: string, memoriesDir: string): Promise<string | null> {
  const filePath = await findMemoryFile(memoriesDir, fileName);
  if (!filePath) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = parseMemoryFile(raw);
    if (!parsed) {
      return null;
    }

    const nextFrontmatter = upsertFrontmatterField(
      parsed.frontmatter,
      "score",
      String(boostScoreValue(parsed.frontmatter)),
    );
    const nextBody = appendFooterLine(parsed.body, `${BOOST_NOTE_PREFIX}${todayDate()}`);

    await writeFile(filePath, renderMemoryFile(parsed.opening, nextFrontmatter, nextBody), "utf8");
    return path.basename(filePath);
  } catch {
    return null;
  }
}

async function rewriteMemoryFromFailure(
  event: ViolatedRewriteEvent,
  memoriesDir: string,
): Promise<string | null> {
  const filePath = await findMemoryFile(memoriesDir, event.relatedMemoryFile);
  if (!filePath) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = parseMemoryFile(raw);
    if (!parsed) {
      return null;
    }

    const nextFrontmatter = upsertFrontmatterField(
      parsed.frontmatter,
      "score",
      String(boostScoreValue(parsed.frontmatter)),
    );
    const rewrittenBody = await rewriteBodyWithLlm(event, parsed.body);

    await writeFile(filePath, renderMemoryFile(parsed.opening, nextFrontmatter, rewrittenBody), "utf8");
    return path.basename(filePath);
  } catch {
    return null;
  }
}

async function extractNewFailureMemory(
  event: NewFailureExtractEvent,
  memoriesDir: string,
): Promise<string | null> {
  const projectRoot = path.dirname(memoriesDir);

  try {
    await mkdir(path.join(memoriesDir, "gotchas"), { recursive: true });
    const memory = await completeFailureMemory(event);
    const filePath = await saveMemory(memory, projectRoot);
    return path.basename(filePath);
  } catch {
    return null;
  }
}

async function rewriteBodyWithLlm(event: ViolatedRewriteEvent, existingBody: string): Promise<string> {
  const prompt = [
    "Rewrite the memory body as a short warning for future agents.",
    'Return strict JSON only: {"body":"..."}',
    "Requirements:",
    "- Start with a warning line that begins with ⚠️ and directly says what not to do.",
    "- Include one concrete counterexample from this failure.",
    "- Keep the full body under 150 characters.",
    "- Do not include frontmatter.",
    "",
    `Failure description: ${event.description}`,
    "",
    "Current body:",
    existingBody,
  ].join("\n");

  const body = await runJsonFieldCompletion(prompt, "body");
  return normalizeRewriteBody(body ?? buildFallbackRewriteBody(event));
}

async function completeFailureMemory(event: NewFailureExtractEvent): Promise<Memory> {
  const prompt = [
    "Improve this gotcha memory draft for RepoBrain.",
    "Return strict JSON only:",
    '{"title":"Short title","summary":"One sentence","detail":"Markdown body","tags":["tag1"],"importance":"high|medium|low"}',
    "Requirements:",
    "- The detail should start with ## GOTCHA.",
    "- Keep the detail concise and durable.",
    "- Use the failure draft as the primary source of truth.",
    "",
    `Failure description: ${event.description}`,
    "",
    "Draft content:",
    event.draftContent,
  ].join("\n");

  const completed = await runStructuredMemoryCompletion(prompt);
  return completed ?? buildFallbackFailureMemory(event);
}

async function runJsonFieldCompletion(prompt: string, field: string): Promise<string | null> {
  const command = process.env.BRAIN_EXTRACTOR_COMMAND?.trim();
  if (!command) {
    return null;
  }

  try {
    const raw = await runCommand(command, prompt);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

async function runStructuredMemoryCompletion(prompt: string): Promise<Memory | null> {
  const command = process.env.BRAIN_EXTRACTOR_COMMAND?.trim();
  if (!command) {
    return null;
  }

  try {
    const raw = await runCommand(command, prompt);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const title = asNonEmptyString(parsed.title);
    const summary = asNonEmptyString(parsed.summary);
    const detail = asNonEmptyString(parsed.detail);
    const importance = asImportance(parsed.importance);

    if (!title || !summary || !detail || !importance) {
      return null;
    }

    return {
      type: "gotcha",
      title,
      summary,
      detail: normalizeFailureDetail(detail),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 5)
        : deriveTagsFromText(`${title}\n${summary}\n${detail}`),
      importance,
      date: new Date().toISOString(),
      score: NEW_FAILURE_SCORE,
      hit_count: 0,
      last_used: null,
      created_at: todayDate(),
      stale: false,
      source: "session",
      status: "active",
      origin: "failure",
    };
  } catch {
    return null;
  }
}

async function runCommand(command: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
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

async function findMemoryFile(memoriesDir: string, fileName: string): Promise<string | null> {
  const normalizedTarget = fileName.trim().toLowerCase();
  if (!normalizedTarget) {
    return null;
  }

  for (const directory of ["decisions", "gotchas", "conventions", "patterns"]) {
    try {
      const entries = await readdir(path.join(memoriesDir, directory), { withFileTypes: true });
      const match = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === normalizedTarget);
      if (match) {
        return path.join(memoriesDir, directory, match.name);
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseMemoryFile(raw: string): { opening: string; frontmatter: string; body: string } | null {
  const match = raw.match(/^(---\r?\n)([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const opening = match[1];
  const frontmatter = match[2];
  const body = match[3];
  if (!opening || frontmatter === undefined || body === undefined) {
    return null;
  }

  return {
    opening,
    frontmatter,
    body: body.trim(),
  };
}

function renderMemoryFile(opening: string, frontmatter: string, body: string): string {
  return `${opening}${frontmatter}\n---\n\n${body.trim()}\n`;
}

function boostScoreValue(frontmatter: string): number {
  const current = readNumericFrontmatter(frontmatter, "score") ?? 60;
  return Math.min(100, current + REINFORCEMENT_INCREMENT);
}

function readNumericFrontmatter(frontmatter: string, field: string): number | null {
  const pattern = new RegExp(`^${field}:\\s*(\\d+)\\s*$`, "m");
  const match = frontmatter.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function upsertFrontmatterField(frontmatter: string, field: string, value: string): string {
  const pattern = new RegExp(`^${field}:\\s*.*$`, "m");
  if (pattern.test(frontmatter)) {
    return frontmatter.replace(pattern, `${field}: ${value}`);
  }

  return `${frontmatter}\n${field}: ${value}`;
}

function appendFooterLine(body: string, footerLine: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return footerLine;
  }

  return trimmed.includes(footerLine) ? trimmed : `${trimmed}\n\n${footerLine}`;
}

function normalizeRewriteBody(body: string): string {
  const compact = body.replace(/\r/g, "").trim();
  const limited = compact.length <= 150 ? compact : compact.slice(0, 150).trim();
  return limited.startsWith("⚠️") ? limited : `⚠️ ${limited}`.slice(0, 150).trim();
}

function normalizeFailureDetail(detail: string): string {
  const trimmed = detail.trim();
  return trimmed.startsWith("## GOTCHA") ? trimmed : `## GOTCHA\n\n${trimmed}`;
}

function buildFallbackRewriteBody(event: ViolatedRewriteEvent): string {
  const description = event.description.replace(/\s+/g, " ").trim();
  return `⚠️ 不要重复这类做法。\n反例：${description}`.slice(0, 150).trim();
}

function buildFallbackFailureMemory(event: NewFailureExtractEvent): Memory {
  const title = deriveTitleFromDraft(event.draftContent);
  return {
    type: "gotcha",
    title,
    summary: event.description,
    detail: normalizeFailureDetail(event.draftContent),
    tags: deriveTagsFromText(`${title}\n${event.description}\n${event.draftContent}`),
    importance: /critical|must|never|avoid|严重|必须|不要/u.test(event.draftContent) ? "high" : "medium",
    date: new Date().toISOString(),
    score: NEW_FAILURE_SCORE,
    hit_count: 0,
    last_used: null,
    created_at: todayDate(),
    stale: false,
    source: "session",
    status: "active",
    origin: "failure",
  };
}

function deriveTitleFromDraft(draft: string): string {
  const firstLine = draft.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Failure reinforcement";
  return firstLine.replace(/^gotcha:\s*/i, "").trim().slice(0, 80) || "Failure reinforcement";
}

function deriveTagsFromText(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9/_-]{2,}/g) ?? [];
  return Array.from(new Set(matches.map((entry) => entry.toLowerCase()))).slice(0, 5);
}

function asImportance(value: unknown): Memory["importance"] | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTargetFileName(event: FailureEvent): string {
  if (isViolatedFailureEvent(event)) {
    return event.relatedMemoryFile;
  }

  const draftSource = event.draftContent ?? event.description;
  return `${todayDate()}-${slugifyMemoryTitle(deriveTitleFromDraft(draftSource))}.md`;
}

function isViolatedFailureEvent(
  event: FailureEvent,
): event is FailureEvent & { kind: "violated_memory"; relatedMemoryFile: string } {
  return event.kind === "violated_memory" && typeof event.relatedMemoryFile === "string" && Boolean(event.relatedMemoryFile.trim());
}

function isViolatedBoostEvent(event: FailureEvent): event is ViolatedBoostEvent {
  return isViolatedFailureEvent(event) && event.suggestedAction === "boost_score";
}

function isViolatedRewriteEvent(event: FailureEvent): event is ViolatedRewriteEvent {
  return isViolatedFailureEvent(event) && event.suggestedAction === "rewrite_memory";
}

function isNewFailureExtractEvent(event: FailureEvent): event is NewFailureExtractEvent {
  return (
    event.kind === "new_failure" &&
    event.suggestedAction === "extract_new" &&
    typeof event.draftContent === "string" &&
    Boolean(event.draftContent.trim())
  );
}
