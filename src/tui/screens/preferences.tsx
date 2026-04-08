import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  buildActivePreferenceListViewModel,
  dismissPreferenceByTarget,
  type ActivePreferenceListViewModel,
} from "../adapters/preferences.js";
import { Section } from "../components/section.js";

export interface PreferencesScreenProps {
  projectRoot: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

export function PreferencesScreen({ projectRoot, onMessage, onError }: PreferencesScreenProps): React.JSX.Element {
  const [model, setModel] = useState<ActivePreferenceListViewModel | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (cancelledRef?: { value: boolean }): Promise<void> => {
    onMessage("Loading preferences...");
    try {
      const result = await buildActivePreferenceListViewModel(projectRoot);
      if (cancelledRef?.value) {
        return;
      }
      setModel(result);
      setSelectedIndex((current) => Math.max(0, Math.min(current, Math.max(result.active.length - 1, 0))));
      onError(null);
      onMessage(`Loaded ${result.active.length} active preferences.`);
    } catch (reason: unknown) {
      if (cancelledRef?.value) {
        return;
      }
      const message = reason instanceof Error ? reason.message : String(reason);
      onError(message);
      onMessage(`Preferences load failed: ${message}`);
    }
  };

  useEffect(() => {
    const cancelledRef = { value: false };
    void load(cancelledRef);
    return () => {
      cancelledRef.value = true;
    };
  }, [onError, onMessage, projectRoot]);

  useInput((input, key) => {
    if (busy) {
      return;
    }
    if (input === "r") {
      void load();
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((current) => Math.min(current + 1, Math.max((model?.active.length ?? 1) - 1, 0)));
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (input === "d" || key.return) {
      setShowDetail((current) => !current);
      return;
    }
    if (input === "x") {
      const target = model?.active[selectedIndex]?.target;
      if (!target) {
        return;
      }
      setBusy(true);
      void dismissPreferenceByTarget(projectRoot, target)
        .then(async (count) => {
          onMessage(`Dismissed ${count} preference(s) for ${target}.`);
          await load();
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          onError(message);
          onMessage(`Dismiss preference failed: ${message}`);
        })
        .finally(() => setBusy(false));
    }
  });

  if (!model) {
    return <Text>Loading preferences...</Text>;
  }
  const selected = model.active[selectedIndex];

  return (
    <Box flexDirection="column">
      <Text color="green">Preferences</Text>
      <Text>Keys: j/k move | d/Enter detail | x dismiss selected target | r refresh</Text>
      {model.active.length === 0 && <Text>No active preferences found.</Text>}
      {model.active.map((entry, index) => (
        <Text
          key={`${entry.targetType}-${entry.target}-${entry.reason}`}
          {...(index === selectedIndex ? { color: "cyan" } : {})}
        >
          {index === selectedIndex ? ">" : " "}[{entry.preference}] {entry.targetType}:{entry.target} ({entry.reason})
        </Text>
      ))}
      {showDetail && selected && (
        <Section title="Preference Detail">
          <Text>target_type: {selected.targetType}</Text>
          <Text>target: {selected.target}</Text>
          <Text>preference: {selected.preference}</Text>
          <Text>reason: {selected.reason}</Text>
          <Text>confidence: {selected.confidence}</Text>
          <Text>source: {selected.source}</Text>
          <Text>updated_at: {selected.updatedAt}</Text>
          <Text>valid_until: {selected.validUntil ?? "N/A"}</Text>
          <Text>review_state: {selected.reviewState ?? "unset"}</Text>
        </Section>
      )}
      {busy && <Text color="yellow">Working...</Text>}
    </Box>
  );
}
