import { mkdir, readdir, readFile, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBrainDir, hasBrain, writeDefaultConfig } from "./config.js";
import type { Memory, MemorySource, MemoryStatus, MemoryType } from "./types.js";
import { IMPORTANCE_LEVELS, MEMORY_STATUSES, MEMORY_TYPES, MEMORY_SOURCES } from "./types.js";

const DIRECTORY_BY_TYPE: Record<MemoryType, string> = {
  decision: "decisions",
  gotcha: "gotchas",
  convention: "conventions",
  pattern: "patterns",
};

export async function initBrain(projectRoot: string): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  const existedBeforeInit = await hasBrain(projectRoot);

  await mkdir(brainDir, { recursive: true });
  await Promise.all([
    mkdir(path.join(brainDir, "decisions"), { recursive: true }),
    mkdir(path.join(brainDir, "gotchas"), { recursive: true }),
    mkdir(path.join(brainDir, "conventions"), { recursive: true }),
    mkdir(path.join(brainDir, "patterns"), { recursive: true }),
  ]);

  if (!existedBeforeInit) {
    await writeDefaultConfig(projectRoot);
  } else {
    try {
      await readFile(path.join(brainDir, "config.yaml"), "utf8");
    } catch {
      await writeDefaultConfig(projectRoot);
    }
  }

  await Promise.all([
    touchFile(path.join(brainDir, "errors.log")),
    updateIndex(projectRoot),
  ]);
}

export async function saveMemory(memory: Memory, projectRoot: string): Promise<string> {
  validateMemory(memory);

  await initBrain(projectRoot);

  const directory = DIRECTORY_BY_TYPE[memory.type];
  const fileName = `${memory.date.slice(0, 10)}-${slugify(memory.title)}.md`;
  const brainDir = getBrainDir(projectRoot);
  const content = serializeMemory(memory);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const relativePath = path.join(directory, ensureUniqueFileNameSuffix(memory, fileName, attempt));
    const filePath = path.join(brainDir, relativePath);

    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileAlreadyExistsError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to allocate a unique memory file name for "${memory.title}".`);
}

export async function loadAllMemories(projectRoot: string): Promise<Memory[]> {
  const brainDir = getBrainDir(projectRoot);
  const memoriesByType = await Promise.all(
    MEMORY_TYPES.map(async (type) => {
      const directory = path.join(brainDir, DIRECTORY_BY_TYPE[type]);

      try {
        const files = await readdir(directory, { withFileTypes: true });
        const markdownFiles = files.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));

        const loaded = await Promise.all(
          markdownFiles.map(async (entry) => {
            const content = await readFile(path.join(directory, entry.name), "utf8");
            return parseMemory(content);
          }),
        );

        return loaded.filter((memory): memory is Memory => memory !== null);
      } catch {
        return [];
      }
    }),
  );

  return memoriesByType
    .flat()
    .sort((left, right) => right.date.localeCompare(left.date));
}

export async function updateIndex(projectRoot: string): Promise<void> {
  const memories = await loadAllMemories(projectRoot);
  const brainDir = getBrainDir(projectRoot);
  const indexPath = path.join(brainDir, "index.md");
  const byType = new Map<MemoryType, Memory[]>(
    MEMORY_TYPES.map((type) => [type, memories.filter((memory) => memory.type === type)]),
  );
  const total = memories.length;
  const lastUpdated = memories[0]?.date ?? "N/A";

  const sections = MEMORY_TYPES.map((type) => {
    const title = titleForType(type);
    const items = byType.get(type) ?? [];

    if (items.length === 0) {
      return [`## ${title}`, "", "_No memories yet._", ""].join("\n");
    }

    const lines = items.map((memory) => {
      const tags = memory.tags.length > 0 ? ` | tags: ${memory.tags.join(", ")}` : "";
      const status = memory.status ? ` | status: ${memory.status}` : "";
      return `- [${memory.importance}] ${memory.title} (${memory.date}) - ${memory.summary}${tags}${status}`;
    });

    return [`## ${title}`, "", ...lines, ""].join("\n");
  });

  const content = [
    "# Project Brain Index",
    "",
    `Updated: ${new Date().toISOString()}`,
    `Total memories: ${total}`,
    `Last memory date: ${lastUpdated}`,
    "",
    ...sections,
  ].join("\n");

  await writeFile(indexPath, content, "utf8");
}

export async function appendErrorLog(projectRoot: string, message: string): Promise<void> {
  const brainDir = getBrainDir(projectRoot);
  await mkdir(brainDir, { recursive: true });
  await appendFile(
    path.join(brainDir, "errors.log"),
    `[${new Date().toISOString()}] ${message}\n`,
    "utf8",
  );
}

function validateMemory(memory: Memory): void {
  if (!MEMORY_TYPES.includes(memory.type)) {
    throw new Error(`Unsupported memory type: ${memory.type}`);
  }

  if (!IMPORTANCE_LEVELS.includes(memory.importance)) {
    throw new Error(`Unsupported importance: ${memory.importance}`);
  }

  if (memory.source && !MEMORY_SOURCES.includes(memory.source)) {
    throw new Error(`Unsupported source: ${memory.source}`);
  }

  if (memory.status && !MEMORY_STATUSES.includes(memory.status)) {
    throw new Error(`Unsupported status: ${memory.status}`);
  }

  if (!memory.title.trim() || !memory.summary.trim() || !memory.detail.trim()) {
    throw new Error("Memory title, summary, and detail are required.");
  }
}

function serializeMemory(memory: Memory): string {
  const frontmatterLines = [
    "---",
    `type: ${quoteYaml(memory.type)}`,
    `title: ${quoteYaml(memory.title)}`,
    `summary: ${quoteYaml(memory.summary)}`,
    "tags:",
    ...memory.tags.map((tag) => `  - ${quoteYaml(tag)}`),
    `importance: ${quoteYaml(memory.importance)}`,
    `date: ${quoteYaml(memory.date)}`,
  ];

  if (memory.source) {
    frontmatterLines.push(`source: ${quoteYaml(memory.source)}`);
  }

  if (memory.status) {
    frontmatterLines.push(`status: ${quoteYaml(memory.status)}`);
  }

  frontmatterLines.push("---", "", memory.detail.trim(), "");

  return frontmatterLines.join("\n");
}

function parseMemory(content: string): Memory | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const rawFrontmatter = match[1];
  const rawDetail = match[2];
  if (!rawFrontmatter || rawDetail === undefined) {
    return null;
  }

  const frontmatter = parseFrontmatter(rawFrontmatter);
  const type = frontmatter.type;
  const importance = frontmatter.importance;
  const source = frontmatter.source;
  const status = frontmatter.status;

  if (!type || !importance || !frontmatter.title || !frontmatter.summary || !frontmatter.date) {
    return null;
  }

  if (!MEMORY_TYPES.includes(type as MemoryType) || !IMPORTANCE_LEVELS.includes(importance as any)) {
    return null;
  }

  if (source && !MEMORY_SOURCES.includes(source as any)) {
    return null;
  }

  if (status && !MEMORY_STATUSES.includes(status as any)) {
    return null;
  }

  const memory: Memory = {
    type: type as MemoryType,
    title: frontmatter.title,
    summary: frontmatter.summary,
    detail: rawDetail.trim(),
    tags: frontmatter.tags,
    importance: importance as Memory["importance"],
    date: frontmatter.date,
  };

  if (source) {
    memory.source = source as MemorySource;
  }

  if (status) {
    memory.status = status as MemoryStatus;
  }

  return memory;
}

function parseFrontmatter(raw: string): {
  type?: string;
  title?: string;
  summary?: string;
  tags: string[];
  importance?: string;
  date?: string;
  source?: string;
  status?: string;
} {
  const result: {
    type?: string;
    title?: string;
    summary?: string;
    tags: string[];
    importance?: string;
    date?: string;
    source?: string;
    status?: string;
  } = { tags: [] };

  let activeKey: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("  - ") && activeKey === "tags") {
      result.tags.push(unquoteYaml(line.slice(4).trim()));
      continue;
    }

    activeKey = null;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "tags") {
      activeKey = "tags";
      continue;
    }

    switch (key) {
      case "type":
      case "title":
      case "summary":
      case "importance":
      case "date":
      case "source":
      case "status":
        result[key] = unquoteYaml(value);
        break;
      default:
        break;
    }
  }

  return result;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function titleForType(type: MemoryType): string {
  switch (type) {
    case "decision":
      return "Decisions";
    case "gotcha":
      return "Gotchas";
    case "convention":
      return "Conventions";
    case "pattern":
      return "Patterns";
  }
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "memory";
}

function ensureUniqueFileNameSuffix(memory: Memory, fileName: string, attempt: number = 0): string {
  const stamp = memory.date
    .replace(/[^\d]/g, "")
    .slice(8, 17);

  const extension = path.extname(fileName);
  const baseName = fileName.slice(0, -extension.length);
  const parts = [baseName];

  if (stamp) {
    parts.push(stamp);
  }

  if (attempt > 0) {
    parts.push(String(attempt + 1));
  }

  return `${parts.join("-")}${extension}`;
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "EEXIST"
  );
}

async function touchFile(filePath: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(filePath, "", "utf8");
  }
}
