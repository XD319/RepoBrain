import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { loadConfig } from "../../config.js";
import { buildRoutingInspectorViewModel, type RoutingInspectorViewModel } from "../adapters/routing.js";
import { Section } from "../components/section.js";
import { applyInputBuffer, InputLine, parseCommaSeparatedValues } from "../components/input-buffer.js";

export interface RoutingScreenProps {
  projectRoot: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

export function parsePathsInput(raw: string): string[] {
  return parseCommaSeparatedValues(raw);
}

export function buildRoutingInput(task: string, pathsInput: string): { task: string; paths: string[]; pathSource: "none" | "explicit" } {
  const paths = parsePathsInput(pathsInput);
  return {
    task: task.trim(),
    paths,
    pathSource: paths.length > 0 ? "explicit" : "none",
  };
}

export function RoutingScreen({ projectRoot, onMessage, onError }: RoutingScreenProps): React.JSX.Element {
  const [task, setTask] = useState("");
  const [pathsInput, setPathsInput] = useState("");
  const [inputMode, setInputMode] = useState<"task" | "paths">("task");
  const [result, setResult] = useState<RoutingInspectorViewModel | null>(null);
  const [busy, setBusy] = useState(false);

  useInput((input, key) => {
    if (busy) {
      return;
    }
    if (input === "t") {
      setInputMode("task");
      return;
    }
    if (input === "p") {
      setInputMode("paths");
      return;
    }
    if (input === "r") {
      const routeInput = buildRoutingInput(task, pathsInput);
      if (!routeInput.task) {
        return;
      }
      setBusy(true);
      void loadConfig(projectRoot)
        .then((config) =>
          buildRoutingInspectorViewModel(projectRoot, config, {
            task: routeInput.task,
            paths: routeInput.paths,
            path_source: routeInput.pathSource,
            modules: [],
            warnings: [],
          }),
        )
        .then((viewModel) => {
          setResult(viewModel);
          onError(null);
          onMessage(`Routing refreshed for task: ${routeInput.task}`);
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          onError(message);
          onMessage(`Routing failed: ${message}`);
        })
        .finally(() => setBusy(false));
      return;
    }
    if (key.return) {
      const routeInput = buildRoutingInput(task, pathsInput);
      if (!routeInput.task) {
        onMessage("Routing task is empty.");
        return;
      }
      setBusy(true);
      void loadConfig(projectRoot)
        .then((config) =>
          buildRoutingInspectorViewModel(projectRoot, config, {
            task: routeInput.task,
            paths: routeInput.paths,
            path_source: routeInput.pathSource,
            modules: [],
            warnings: [],
          }),
        )
        .then((viewModel) => {
          setResult(viewModel);
          onError(null);
          onMessage(`Routing built for task: ${routeInput.task}`);
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          onError(message);
          onMessage(`Routing failed: ${message}`);
        })
        .finally(() => setBusy(false));
      return;
    }

    if (inputMode === "task") {
      setTask((current) => applyInputBuffer(current, input, { backspace: key.backspace, return: key.return }));
      return;
    }
    setPathsInput((current) => applyInputBuffer(current, input, { backspace: key.backspace, return: key.return }));
  });

  return (
    <Box flexDirection="column">
      <Text color="green">Routing</Text>
      <Text>Keys: t edit task | p edit paths (comma-separated) | Enter build route | r refresh</Text>
      <Text>Input mode: {inputMode}</Text>
      <InputLine label="Task" value={task} active={inputMode === "task"} />
      <InputLine label="Paths" value={pathsInput || "(none)"} active={inputMode === "paths"} />
      {busy && <Text color="yellow">Routing...</Text>}
      {result && (
        <Box flexDirection="column">
          <Text>Display mode: {result.displayMode} | Path source: {result.pathSource}</Text>
          <Section title="Invocation Plan">
            <Text>required: {result.bundle.skill_plan.required.join(", ") || "-"}</Text>
            <Text>prefer_first: {result.bundle.skill_plan.prefer_first.join(", ") || "-"}</Text>
            <Text>optional_fallback: {result.bundle.skill_plan.optional_fallback.join(", ") || "-"}</Text>
            <Text>blocked: {result.bundle.skill_plan.blocked.join(", ") || "-"}</Text>
            <Text>human_review: {result.bundle.skill_plan.human_review.join(", ") || "-"}</Text>
          </Section>
          <Section title="Matched Memories">
            {result.bundle.matched_memories.length === 0 && <Text>- None</Text>}
            {result.bundle.matched_memories.slice(0, 8).map((entry) => (
              <Text key={`${entry.record.relativePath}-${entry.score}`}>
                - {entry.record.relativePath} | score={entry.score.toFixed(2)} | {entry.record.memory.title}
              </Text>
            ))}
          </Section>
          <Section title="Resolved Skills">
            {result.bundle.resolved_skills.length === 0 && <Text>- None</Text>}
            {result.bundle.resolved_skills.slice(0, 8).map((entry) => (
              <Text key={entry.skill}>
                - {entry.skill} | disposition={entry.disposition} | slot={entry.plan_slot}
              </Text>
            ))}
          </Section>
          <Section title="Conflicts">
            {result.bundle.conflicts.length === 0 && <Text>- None</Text>}
            {result.bundle.conflicts.map((entry) => (
              <Text key={`${entry.skill}-${entry.kind}`}>
                - {entry.skill} | {entry.kind} | result={entry.strategy_result}
              </Text>
            ))}
          </Section>
        </Box>
      )}
    </Box>
  );
}
