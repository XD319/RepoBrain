import { getMemoryStatus, loadStoredMemoryRecords } from "../../store.js";
import { searchMemories, type SearchResult } from "../../search.js";
import type { Importance, MemoryStatus, MemoryType, StoredMemoryRecord } from "../../types.js";

export interface SearchScreenFilters {
  type: MemoryType | "all";
}

export interface SearchResultViewModel {
  id: string;
  type: MemoryType;
  importance: Importance;
  status: MemoryStatus;
  title: string;
  summary: string;
  detail: string;
  snippet: string;
  snippets: string[];
  relevance: number;
  date: string;
  relativePath: string;
  tags: string[];
}

export async function buildSearchResultsViewModel(
  projectRoot: string,
  query: string,
  filters: SearchScreenFilters,
): Promise<SearchResultViewModel[]> {
  const records = await loadStoredMemoryRecords(projectRoot);
  return searchRecordsForView(records, query, filters);
}

export function searchRecordsForView(
  records: StoredMemoryRecord[],
  query: string,
  filters: SearchScreenFilters,
): SearchResultViewModel[] {
  return createSearchResultsViewModel(
    searchMemories(records, query, {
      all: true,
      ...(filters.type !== "all" ? { type: filters.type } : {}),
    }),
  );
}

export function createSearchResultsViewModel(results: SearchResult[]): SearchResultViewModel[] {
  return results.map((result) => ({
    id: extractMemoryId(result.record.relativePath),
    type: result.record.memory.type,
    importance: result.record.memory.importance,
    status: getMemoryStatus(result.record.memory),
    title: result.record.memory.title,
    summary: result.record.memory.summary,
    detail: result.record.memory.detail,
    snippet: result.matchSnippets[0] ?? result.record.memory.summary,
    snippets: result.matchSnippets,
    relevance: result.relevance,
    date: result.record.memory.date,
    relativePath: result.record.relativePath.replace(/\\/g, "/"),
    tags: result.record.memory.tags,
  }));
}

function extractMemoryId(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  return fileName.replace(/\.md$/, "");
}
