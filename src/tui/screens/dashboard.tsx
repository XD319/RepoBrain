import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { renderSchemaHealthSummary } from "../../memory-schema.js";
import { buildDashboardStatusViewModel, type DashboardStatusViewModel } from "../adapters/dashboard.js";
import { Section } from "../components/section.js";

export interface DashboardScreenProps {
  projectRoot: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

export function DashboardScreen({ projectRoot, onMessage, onError }: DashboardScreenProps): React.JSX.Element {
  const [status, setStatus] = useState<DashboardStatusViewModel | null>(null);
  const [recentView, setRecentView] = useState<"loaded" | "captured">("loaded");

  const load = async (cancelledRef?: { value: boolean }): Promise<void> => {
    onMessage("Loading dashboard...");
    try {
      const result = await buildDashboardStatusViewModel(projectRoot);
      if (cancelledRef?.value) {
        return;
      }
      setStatus(result);
      onError(null);
      onMessage("Dashboard loaded.");
    } catch (reason: unknown) {
      if (cancelledRef?.value) {
        return;
      }
      const message = reason instanceof Error ? reason.message : String(reason);
      onError(message);
      onMessage(`Dashboard failed: ${message}`);
    }
  };

  useEffect(() => {
    const cancelledRef = { value: false };
    void load(cancelledRef);
    return () => {
      cancelledRef.value = true;
    };
  }, [onMessage, onError, projectRoot]);

  useInput((input) => {
    if (input === "v") {
      setRecentView((current) => (current === "loaded" ? "captured" : "loaded"));
      return;
    }
    if (input === "r") {
      void load();
    }
  });

  if (!status) {
    return <Text>Loading dashboard...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Dashboard</Text>
      <Text>Keys: v toggle recent loaded/captured | r refresh</Text>
      <Text>Workflow: {status.snapshot.workflow.label}</Text>
      <Text>Total memories: {status.totalMemories}</Text>
      <Text>Pending review: {status.snapshot.candidateCount}</Text>
      <Text>Pending reinforce: {status.snapshot.pendingReinforceCount}</Text>
      <Text>Pending cleanup: {status.snapshot.cleanupCount}</Text>
      <Text>Last updated: {status.lastUpdated}</Text>
      <Text>Last injected: {status.lastInjectedAt}</Text>
      <Text>Steering rules: {status.steeringRulesStatusText}</Text>
      <Text>{renderSchemaHealthSummary(status.schemaSummary)}</Text>
      <Section title="Reminders">
        {status.reminders.length === 0 && <Text>- None</Text>}
        {status.reminders.slice(0, 4).map((line) => (
          <Text key={line}>- {line}</Text>
        ))}
      </Section>
      <Section title="Next Steps">
        {status.snapshot.nextSteps.map((line) => (
          <Text key={line}>- {line}</Text>
        ))}
      </Section>
      <Section title={recentView === "loaded" ? "Recent Loaded Memories" : "Recent Captured Memories"}>
        {recentView === "loaded" &&
          status.recentLoadedMemories.map((entry) => (
            <Text key={`${entry.date}-${entry.title}`}>
              - {entry.type} | {entry.importance} | {entry.title} ({entry.date})
            </Text>
          ))}
        {recentView === "captured" &&
          status.recentCapturedMemories.map((entry) => (
            <Text key={`${entry.date}-${entry.title}`}>
              - {entry.type} | {entry.importance} | {entry.title} ({entry.date})
            </Text>
          ))}
      </Section>
    </Box>
  );
}
