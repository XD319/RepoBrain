import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { MemoryType } from "../../types.js";
import { Section } from "../components/section.js";
import { InputLine, applyInputBuffer } from "../components/input-buffer.js";
import {
  buildSearchResultsViewModel,
  type SearchResultViewModel,
  type SearchScreenFilters,
} from "../adapters/search.js";

export interface SearchScreenProps {
  projectRoot: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

const TYPE_FILTERS: SearchScreenFilters["type"][] = ["all", "decision", "gotcha", "convention", "pattern", "working", "goal"];
const MAX_VISIBLE_RESULTS = 12;
const SEARCH_DEBOUNCE_MS = 250;

export function clampSearchSelection(length: number, selectedIndex: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(selectedIndex, length - 1));
}

export function nextSearchTypeFilter(current: SearchScreenFilters["type"]): SearchScreenFilters["type"] {
  const currentIndex = TYPE_FILTERS.indexOf(current);
  const nextIndex = (currentIndex + 1) % TYPE_FILTERS.length;
  return TYPE_FILTERS[nextIndex] ?? current;
}

export function hasSearchSelection(results: SearchResultViewModel[], selectedIndex: number): boolean {
  return results.length > 0 && selectedIndex >= 0 && selectedIndex < results.length;
}

export function SearchScreen({ projectRoot, onMessage, onError }: SearchScreenProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchScreenFilters>({ type: "all" });
  const [results, setResults] = useState<SearchResultViewModel[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const latestSearchKeyRef = useRef<string>("");

  const runSearch = (nextQuery: string, nextFilters: SearchScreenFilters, mode: "debounced" | "immediate"): void => {
    const trimmedQuery = nextQuery.trim();
    const searchKey = `${trimmedQuery}::${nextFilters.type}`;

    if (!trimmedQuery) {
      latestSearchKeyRef.current = "";
      setBusy(false);
      setResults([]);
      setSelectedIndex(0);
      setShowDetail(false);
      onError(null);
      onMessage("Type a query to search memories.");
      return;
    }

    latestSearchKeyRef.current = searchKey;
    setBusy(true);

    void buildSearchResultsViewModel(projectRoot, trimmedQuery, nextFilters)
      .then((nextResults) => {
        if (latestSearchKeyRef.current !== searchKey) {
          return;
        }
        setResults(nextResults);
        setSelectedIndex((current) => clampSearchSelection(nextResults.length, current));
        if (nextResults.length === 0) {
          setShowDetail(false);
        }
        onError(null);
        onMessage(
          `${mode === "immediate" ? "Search updated" : "Search refreshed"}: ${nextResults.length} result${
            nextResults.length === 1 ? "" : "s"
          } for "${trimmedQuery}".`,
        );
      })
      .catch((reason: unknown) => {
        if (latestSearchKeyRef.current !== searchKey) {
          return;
        }
        const message = reason instanceof Error ? reason.message : String(reason);
        setResults([]);
        setSelectedIndex(0);
        setShowDetail(false);
        onError(message);
        onMessage(`Search failed: ${message}`);
      })
      .finally(() => {
        if (latestSearchKeyRef.current === searchKey) {
          setBusy(false);
        }
      });
  };

  useEffect(() => {
    if (!query.trim()) {
      latestSearchKeyRef.current = "";
      setResults([]);
      setBusy(false);
      setSelectedIndex(0);
      setShowDetail(false);
      return;
    }

    const timer = globalThis.setTimeout(() => {
      runSearch(query, filters, "debounced");
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [filters, projectRoot, query]);

  useInput((input, key) => {
    if (input === "r") {
      runSearch(query, filters, "immediate");
      return;
    }
    if (input === "]") {
      const nextFilters = { ...filters, type: nextSearchTypeFilter(filters.type) };
      setFilters(nextFilters);
      setSelectedIndex(0);
      setShowDetail(false);
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((current) => clampSearchSelection(results.length, current + 1));
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((current) => clampSearchSelection(results.length, current - 1));
      return;
    }
    if (key.return) {
      const currentSearchKey = `${query.trim()}::${filters.type}`;
      if (query.trim() && latestSearchKeyRef.current !== currentSearchKey) {
        runSearch(query, filters, "immediate");
        return;
      }
      if (hasSearchSelection(results, selectedIndex)) {
        setShowDetail((current) => !current);
      }
      return;
    }
    setQuery((current) => applyInputBuffer(current, input, { backspace: key.backspace, return: key.return }));
  });

  const selected = results[selectedIndex];

  return (
    <Box flexDirection="column">
      <Text color="green">Search</Text>
      <Section title="Query">
        <InputLine label="Keyword" value={query || "(type to search)"} active />
        <Text>Type filter: {filters.type}</Text>
      </Section>
      <Section title="Results">
        <Text>
          {busy ? "Searching..." : `Showing ${Math.min(results.length, MAX_VISIBLE_RESULTS)} / ${results.length} results`}
        </Text>
        {results.length === 0 && !busy && <Text>No results yet. Type a keyword to search all memory types.</Text>}
        {results.slice(0, MAX_VISIBLE_RESULTS).map((entry, index) => (
          <Text key={entry.relativePath} {...(index === selectedIndex ? { color: "cyan" } : {})}>
            {index === selectedIndex ? ">" : " "} {entry.type} | {entry.importance} | {entry.title} | {entry.snippet}
          </Text>
        ))}
      </Section>
      {showDetail && selected && (
        <Section title="Search Detail">
          <Text>id: {selected.id}</Text>
          <Text>type: {selected.type}</Text>
          <Text>importance: {selected.importance}</Text>
          <Text>status: {selected.status}</Text>
          <Text>relevance: {selected.relevance}</Text>
          <Text>date: {selected.date}</Text>
          <Text>path: {selected.relativePath}</Text>
          <Text>tags: {selected.tags.join(", ") || "-"}</Text>
          <Text>summary: {selected.summary}</Text>
          <Text>detail: {selected.detail}</Text>
        </Section>
      )}
      <Section title="Hints">
        <Text>Keys: type to edit query | Backspace delete | ] cycle type filter | j/k or Up/Down move</Text>
        <Text>Enter toggles detail, or runs an immediate search if the latest query has not executed yet.</Text>
      </Section>
    </Box>
  );
}
