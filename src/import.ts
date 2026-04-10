import path from "node:path";

import { DOMAIN_TAG_RULES } from "./extract.js";
import { normalizeMemory } from "./store/validate.js";
import type { Importance, Memory, MemoryType } from "./types.js";

export interface ImportOptions {
  defaultType?: MemoryType;
  defaultImportance?: Importance;
  dryRun?: boolean;
}

interface Section {
  heading: string;
  content: string;
}

const EXPLICIT_TYPE_PATTERN = /^(?:[-*+]\s*)?(decision|gotcha|convention|pattern|goal)\s*:\s*(.+)$/iu;
const RULE_HEADING_PATTERN = /(?:约定|規範|规范|convention|standard|rule)/iu;
const GOTCHA_HEADING_PATTERN = /(?:陷阱|pitfall|注意|gotcha|avoid|不要)/iu;
const DECISION_HEADING_PATTERN = /(?:决定|決定|decision|选择|選擇|choice|为什么|為什麼|why)/iu;
const PATTERN_HEADING_PATTERN = /(?:模式|pattern|流程|workflow)/iu;
const GOAL_HEADING_PATTERN = /(?:目标|目標|goal|roadmap|milestone)/iu;
const META_HEADING_PATTERN = /^(?:table of contents|contents|toc|目录|目次|参考资料|參考資料|references?)$/iu;
const LINK_ONLY_LINE_PATTERN =
  /^\s*(?:[-*+]\s+|\d+\.\s+)?(?:\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)(?:\s*(?:[-–:]\s*)?(?:\[[^\]]+\]\([^)]+\)|https?:\/\/\S+))*\s*$/u;
const BULLET_LINE_PATTERN = /^\s*(?:[-*+]\s+|\d+\.\s+)(.+)$/u;
const FILE_SEGMENT_STOP_WORDS = new Set([
  "agents",
  "claude",
  "conventions",
  "cursorrules",
  "docs",
  "file",
  "files",
  "main",
  "markdown",
  "md",
  "repo",
  "rules",
]);

export function parseRuleFileToMemories(content: string, filePath: string, options: ImportOptions = {}): Memory[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  const sections = splitMarkdownSections(trimmed, filePath);
  const importedAt = new Date().toISOString();
  const importedDate = importedAt.slice(0, 10);
  const defaultType = options.defaultType ?? "convention";
  const defaultImportance = options.defaultImportance ?? "medium";
  const normalizedFilePath = normalizeRuleFilePath(filePath);
  const memories: Memory[] = [];

  for (const section of sections) {
    if (isMetaHeading(section.heading) || isPureLinkList(section.content)) {
      continue;
    }

    const summary = deriveSummary(section.content);
    const textLength = measureInformationDensity(`${section.heading}\n${section.content}`);
    if (!summary || textLength < 20) {
      continue;
    }

    const explicitType = findExplicitType(section);
    const type = explicitType?.type ?? inferTypeFromHeading(section.heading, defaultType);

    memories.push(
      normalizeMemory({
        type,
        title: explicitType ? stripExplicitPrefix(section.heading) : section.heading.trim(),
        summary,
        detail: section.content.trim(),
        tags: deriveImportTags(section.heading, section.content, type, normalizedFilePath),
        importance: defaultImportance,
        date: importedDate,
        created: importedDate,
        updated: importedDate,
        created_at: importedAt,
        score: 60,
        hit_count: 0,
        last_used: null,
        stale: false,
        source: "manual",
        status: "candidate",
        files: [],
      }),
    );
  }

  return memories;
}

function splitMarkdownSections(content: string, filePath: string): Section[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.*\S)\s*$/u);
    if (!headingMatch) {
      currentLines.push(line);
      continue;
    }

    if (currentHeading !== null) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join("\n").trim(),
      });
    }

    currentHeading = headingMatch[1]?.trim() ?? "";
    currentLines = [];
  }

  if (currentHeading !== null) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
  }

  if (sections.length > 0) {
    return sections.filter((section) => section.heading || section.content);
  }

  return [
    {
      heading: deriveFallbackHeading(filePath),
      content: content.trim(),
    },
  ];
}

function deriveFallbackHeading(filePath: string): string {
  const baseName = path.basename(filePath);
  if (baseName.startsWith(".")) {
    return baseName.slice(1) || "Imported rules";
  }
  return baseName.replace(/\.[^.]+$/u, "") || "Imported rules";
}

function findExplicitType(section: Section): { type: MemoryType; value: string } | null {
  const headingMatch = section.heading.match(EXPLICIT_TYPE_PATTERN);
  if (headingMatch?.[1]) {
    return {
      type: headingMatch[1].toLowerCase() as MemoryType,
      value: headingMatch[2]?.trim() ?? "",
    };
  }

  for (const line of section.content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(EXPLICIT_TYPE_PATTERN);
    if (match?.[1]) {
      return {
        type: match[1].toLowerCase() as MemoryType,
        value: match[2]?.trim() ?? "",
      };
    }
  }

  return null;
}

function stripExplicitPrefix(value: string): string {
  const match = value.match(EXPLICIT_TYPE_PATTERN);
  return match?.[2]?.trim() || value.trim();
}

function inferTypeFromHeading(heading: string, defaultType: MemoryType): MemoryType {
  if (RULE_HEADING_PATTERN.test(heading)) return "convention";
  if (GOTCHA_HEADING_PATTERN.test(heading)) return "gotcha";
  if (DECISION_HEADING_PATTERN.test(heading)) return "decision";
  if (PATTERN_HEADING_PATTERN.test(heading)) return "pattern";
  if (GOAL_HEADING_PATTERN.test(heading)) return "goal";
  return defaultType;
}

function deriveSummary(content: string): string {
  const paragraphs = content
    .split(/\n\s*\n/u)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    const bullet = firstBulletFromBlock(paragraph);
    if (bullet) {
      return stripExplicitPrefix(bullet);
    }
    if (!isPureLinkList(paragraph)) {
      return stripExplicitPrefix(paragraph.replace(/\s+/g, " ").trim());
    }
  }

  return "";
}

function firstBulletFromBlock(block: string): string | null {
  for (const line of block.split("\n")) {
    const match = line.match(BULLET_LINE_PATTERN);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function isPureLinkList(content: string): boolean {
  const nonEmptyLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length === 0) {
    return false;
  }
  return nonEmptyLines.every((line) => LINK_ONLY_LINE_PATTERN.test(line));
}

function isMetaHeading(heading: string): boolean {
  return META_HEADING_PATTERN.test(heading.trim());
}

function measureInformationDensity(content: string): number {
  return content
    .replace(/`[^`]+`/gu, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/gu, " ")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/[#>*_\-\s]/gu, "")
    .trim().length;
}

function deriveImportTags(heading: string, detail: string, type: MemoryType, filePath: string): string[] {
  const tags = new Set<string>([type]);
  const combined = `${heading}\n${detail}`;

  for (const rule of DOMAIN_TAG_RULES) {
    if (rule.pattern.test(combined)) {
      tags.add(rule.tag);
    }
  }

  for (const segment of normalizeRuleFilePath(filePath).split(/[/.\\_-]+/u)) {
    const normalized = segment.trim().toLowerCase();
    if (normalized.length >= 3 && !FILE_SEGMENT_STOP_WORDS.has(normalized)) {
      tags.add(normalized);
    }
  }

  return Array.from(tags).slice(0, 6);
}

function normalizeRuleFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}
