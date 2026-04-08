import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Section } from "../components/section.js";
import {
  buildMemoryBrowserViewModel,
  type MemoryBrowserFilters,
  type MemoryBrowserItemViewModel,
} from "../adapters/memories.js";

export interface MemoriesScreenProps {
  projectRoot: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

const TYPE_FILTERS: MemoryBrowserFilters["type"][] = [
  "all",
  "decision",
  "gotcha",
  "convention",
  "pattern",
  "working",
  "goal",
];
const STATUS_FILTERS: MemoryBrowserFilters["status"][] = ["all", "active", "candidate", "done", "stale", "superseded"];
const IMPORTANCE_FILTERS: MemoryBrowserFilters["importance"][] = ["all", "high", "medium", "low"];

export function nextFilterValue<T>(values: readonly T[], current: T): T {
  const currentIndex = values.indexOf(current);
  const nextIndex = (currentIndex + 1) % values.length;
  const next = values[nextIndex];
  return next ?? current;
}

export function MemoriesScreen({ projectRoot, onMessage, onError }: MemoriesScreenProps): React.JSX.Element {
  const [entries, setEntries] = useState<MemoryBrowserItemViewModel[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [filters, setFilters] = useState<MemoryBrowserFilters>({
    type: "all",
    status: "all",
    importance: "all",
  });

  const load = async (nextFilters: MemoryBrowserFilters): Promise<void> => {
    onMessage("Loading memories...");
    try {
      const result = await buildMemoryBrowserViewModel(projectRoot, nextFilters);
      setEntries(result);
      setSelectedIndex(0);
      onError(null);
      onMessage(`Loaded ${result.length} memories after filters.`);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      onError(message);
      onMessage(`Memories load failed: ${message}`);
    }
  };

  useEffect(() => {
    void load(filters);
  }, [projectRoot]);

  useInput((input, key) => {
    if (input === "r") {
      void load(filters);
      return;
    }
    if (input === "t") {
      const next = { ...filters, type: nextFilterValue(TYPE_FILTERS, filters.type) };
      setFilters(next);
      void load(next);
      return;
    }
    if (input === "s") {
      const next = { ...filters, status: nextFilterValue(STATUS_FILTERS, filters.status) };
      setFilters(next);
      void load(next);
      return;
    }
    if (input === "i") {
      const next = { ...filters, importance: nextFilterValue(IMPORTANCE_FILTERS, filters.importance) };
      setFilters(next);
      void load(next);
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((current) => Math.min(current + 1, Math.max((entries?.length ?? 1) - 1, 0)));
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (input === "d" || key.return) {
      setShowDetail((current) => !current);
    }
  });

  if (!entries) {
    return <Text>Loading memories...</Text>;
  }
  const selected = entries[selectedIndex];

  return (
    <Box flexDirection="column">
      <Text color="green">Memories</Text>
      <Text>Keys: t type filter | s status filter | i importance filter | j/k move | d/Enter detail | r refresh</Text>
      <Text>
        Filters: type={filters.type} status={filters.status} importance={filters.importance}
      </Text>
      <Text>
        Showing {Math.min(entries.length, 15)} / {entries.length}
      </Text>
      {entries.slice(0, 15).map((entry, index) => (
        <Text
          key={`${entry.memory.date}-${entry.memory.title}`}
          {...(index === selectedIndex ? { color: "cyan" } : {})}
        >
          {index === selectedIndex ? ">" : " "} {entry.memory.date} | {entry.memory.type} | {entry.memory.importance} |{" "}
          {entry.status} | {entry.memory.title}
        </Text>
      ))}
      {showDetail && selected && (
        <Section title="Memory Detail">
          <Text>type: {selected.memory.type}</Text>
          <Text>status: {selected.status}</Text>
          <Text>importance: {selected.memory.importance}</Text>
          <Text>date: {selected.memory.date}</Text>
          <Text>score: {selected.memory.score}</Text>
          <Text>hit_count: {selected.memory.hit_count}</Text>
          <Text>last_used: {selected.memory.last_used ?? "N/A"}</Text>
          <Text>tags: {selected.memory.tags.join(", ") || "-"}</Text>
          <Text>path_scope: {(selected.memory.path_scope ?? []).join(", ") || "-"}</Text>
          <Text>review_state: {selected.memory.review_state ?? "unset"}</Text>
          <Text>detail: {selected.memory.detail}</Text>
        </Section>
      )}
    </Box>
  );
}
