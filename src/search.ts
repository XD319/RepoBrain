import type { Memory, MemoryStatus, MemoryType, StoredMemoryRecord } from "./types.js";
import { getMemoryStatus } from "./store.js";

export interface SearchFilters {
  type?: MemoryType;
  tag?: string;
  status?: MemoryStatus;
  all?: boolean;
}

export interface SearchResult {
  record: StoredMemoryRecord;
  /** Total relevance score (higher = more relevant). */
  relevance: number;
  /** Short snippets showing matched context around each keyword hit. */
  matchSnippets: string[];
}

/**
 * Search memories by one or more keywords (AND semantics).
 *
 * Search scope: title + summary + detail + tags.
 * Matching: case-insensitive, character-level (works for CJK without word splitting).
 * Ranking: relevance (keyword hit count) > importance > date.
 *
 * @returns Sorted search results (most relevant first).
 */
export function searchMemories(
  records: StoredMemoryRecord[],
  query: string,
  filters: SearchFilters = {},
): SearchResult[] {
  const keywords = parseKeywords(query);
  if (keywords.length === 0) {
    return [];
  }

  const filtered = records.filter((record) => matchesFilters(record, filters));

  const results: SearchResult[] = [];

  for (const record of filtered) {
    const { memory } = record;
    const searchableText = buildSearchableText(memory);
    const searchableTextLower = searchableText.toLowerCase();

    // AND semantics: all keywords must match.
    const allMatch = keywords.every((keyword) => searchableTextLower.includes(keyword));
    if (!allMatch) {
      continue;
    }

    const relevance = computeRelevance(memory, keywords);
    const matchSnippets = extractSnippets(memory, keywords);

    results.push({ record, relevance, matchSnippets });
  }

  results.sort((left, right) => {
    // Primary: relevance (descending).
    if (left.relevance !== right.relevance) {
      return right.relevance - left.relevance;
    }

    // Secondary: importance (high > medium > low).
    const importanceOrder = compareImportance(left.record.memory.importance, right.record.memory.importance);
    if (importanceOrder !== 0) {
      return importanceOrder;
    }

    // Tertiary: date (newer first).
    return right.record.memory.date.localeCompare(left.record.memory.date);
  });

  return results;
}

/** Render a human-readable search result line. */
export function formatSearchResultLine(result: SearchResult): string {
  const { memory } = result.record;
  const id = extractMemoryId(result.record);
  const snippetText = result.matchSnippets.length > 0 ? ` | ${result.matchSnippets.join("; ")}` : "";
  return `${id} | ${memory.type} | ${memory.importance} | ${memory.title}${snippetText}`;
}

/** Render search results as a JSON-serializable array. */
export function renderSearchResultsJson(results: SearchResult[]): unknown[] {
  return results.map((result) => ({
    id: extractMemoryId(result.record),
    type: result.record.memory.type,
    importance: result.record.memory.importance,
    status: getMemoryStatus(result.record.memory),
    title: result.record.memory.title,
    summary: result.record.memory.summary,
    date: result.record.memory.date,
    relevance: result.relevance,
    matchSnippets: result.matchSnippets,
    relativePath: result.record.relativePath.replace(/\\/g, "/"),
  }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseKeywords(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function matchesFilters(record: StoredMemoryRecord, filters: SearchFilters): boolean {
  const { memory } = record;
  const status = getMemoryStatus(memory);

  // Status filter: default is "active" only, unless --all is set.
  if (!filters.all && !filters.status) {
    if (status !== "active") {
      return false;
    }
  } else if (filters.status && status !== filters.status) {
    return false;
  }

  // Type filter.
  if (filters.type && memory.type !== filters.type) {
    return false;
  }

  // Tag filter.
  if (filters.tag) {
    const tagLower = filters.tag.toLowerCase();
    if (!memory.tags.some((tag) => tag.toLowerCase() === tagLower)) {
      return false;
    }
  }

  return true;
}

function buildSearchableText(memory: Memory): string {
  return [memory.title, memory.summary, memory.detail, ...memory.tags].join(" ");
}

/**
 * Compute a relevance score based on keyword hits across weighted fields.
 *
 * Weights:
 * - title hit:   10 per keyword
 * - tag hit:      8 per keyword
 * - summary hit:  5 per keyword
 * - detail hit:   2 per keyword occurrence (capped at 5 per keyword)
 */
function computeRelevance(memory: Memory, keywords: string[]): number {
  const titleLower = memory.title.toLowerCase();
  const summaryLower = memory.summary.toLowerCase();
  const detailLower = memory.detail.toLowerCase();
  const tagsLower = memory.tags.map((tag) => tag.toLowerCase());

  let score = 0;

  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) {
      score += 10;
    }

    if (tagsLower.some((tag) => tag.includes(keyword))) {
      score += 8;
    }

    if (summaryLower.includes(keyword)) {
      score += 5;
    }

    const detailHits = countOccurrences(detailLower, keyword);
    score += Math.min(detailHits, 5) * 2;
  }

  return score;
}

function countOccurrences(text: string, substring: string): number {
  let count = 0;
  let position = 0;

  while (true) {
    const index = text.indexOf(substring, position);
    if (index === -1) {
      break;
    }

    count += 1;
    position = index + substring.length;
  }

  return count;
}

function compareImportance(left: Memory["importance"], right: Memory["importance"]): number {
  const order: Record<Memory["importance"], number> = { high: 0, medium: 1, low: 2 };
  return (order[left] ?? 1) - (order[right] ?? 1);
}

/**
 * Extract short context snippets around the first occurrence of each keyword
 * in the searchable text of the memory.
 */
function extractSnippets(memory: Memory, keywords: string[]): string[] {
  const snippets: string[] = [];
  const fields: Array<{ label: string; text: string }> = [
    { label: "title", text: memory.title },
    { label: "summary", text: memory.summary },
    { label: "detail", text: memory.detail },
  ];

  const seen = new Set<string>();

  for (const keyword of keywords) {
    for (const field of fields) {
      const lowerText = field.text.toLowerCase();
      const position = lowerText.indexOf(keyword);
      if (position === -1) {
        continue;
      }

      const snippetKey = `${field.label}:${keyword}`;
      if (seen.has(snippetKey)) {
        continue;
      }

      seen.add(snippetKey);
      const snippet = buildSnippet(field.text, position, keyword.length);
      snippets.push(`${field.label}: ...${snippet}...`);
      break; // One snippet per keyword is enough.
    }
  }

  return snippets.slice(0, 3); // Cap at 3 snippets.
}

function buildSnippet(text: string, matchStart: number, matchLength: number): string {
  const CONTEXT_CHARS = 30;
  const start = Math.max(0, matchStart - CONTEXT_CHARS);
  const end = Math.min(text.length, matchStart + matchLength + CONTEXT_CHARS);
  let snippet = text.slice(start, end).replace(/\r?\n/g, " ");

  if (snippet.length > 80) {
    snippet = snippet.slice(0, 80);
  }

  return snippet;
}

function extractMemoryId(record: StoredMemoryRecord): string {
  const parts = record.relativePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1] ?? "";
  return fileName.replace(/\.md$/, "");
}
