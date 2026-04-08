import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  approveCandidateAction,
  buildCandidateListViewModel,
  dismissCandidateAction,
  type CandidateListViewModel,
} from "../adapters/review.js";

export interface ReviewScreenProps {
  projectRoot: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

export function clampSelection(length: number, selectedIndex: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(selectedIndex, length - 1));
}

export function getSelectedCandidateId(
  model: CandidateListViewModel | null,
  selectedIndex: number,
): string | undefined {
  if (!model || model.candidates.length === 0) {
    return undefined;
  }
  const safeIndex = clampSelection(model.candidates.length, selectedIndex);
  return model.candidates[safeIndex]?.id;
}

export function ReviewScreen({ projectRoot, onMessage, onError }: ReviewScreenProps): React.JSX.Element {
  const [model, setModel] = useState<CandidateListViewModel | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await buildCandidateListViewModel(projectRoot);
    setModel(next);
    setSelectedIndex((current) => clampSelection(next.candidates.length, current));
  }, [projectRoot]);

  useEffect(() => {
    let cancelled = false;
    onMessage("Loading review candidates...");
    void reload()
      .then(() => {
        if (!cancelled) {
          onError(null);
          onMessage("Review candidates loaded.");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(message);
          onError(message);
          onMessage(`Review load failed: ${message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError, onMessage, reload]);

  useInput((input, key) => {
    if (busy) {
      return;
    }
    if (input === "r") {
      void reload();
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((current) => clampSelection(model?.candidates.length ?? 0, current + 1));
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((current) => clampSelection(model?.candidates.length ?? 0, current - 1));
      return;
    }
    if (input === "a" || key.return) {
      const selectedId = getSelectedCandidateId(model, selectedIndex);
      if (!selectedId) {
        return;
      }
      setBusy(true);
      setError(null);
      void approveCandidateAction(projectRoot, selectedId, { safe: false })
        .then(async (result) => {
          onMessage(`Approved ${result.affectedCount} candidate.`);
          await reload();
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(message);
          onError(message);
          onMessage(`Approve failed: ${message}`);
        })
        .finally(() => setBusy(false));
      return;
    }
    if (input === "d") {
      const selectedId = getSelectedCandidateId(model, selectedIndex);
      if (!selectedId) {
        return;
      }
      setBusy(true);
      setError(null);
      void dismissCandidateAction(projectRoot, selectedId, {})
        .then(async (result) => {
          onMessage(`Dismissed ${result.affectedCount} candidate.`);
          await reload();
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(message);
          onError(message);
          onMessage(`Dismiss failed: ${message}`);
        })
        .finally(() => setBusy(false));
      return;
    }
    if (input === "s") {
      setBusy(true);
      setError(null);
      void approveCandidateAction(projectRoot, undefined, { safe: true })
        .then(async (result) => {
          const skipped = result.skippedManualReviewCount ?? 0;
          onMessage(`Approved ${result.affectedCount} safe candidates, skipped ${skipped}.`);
          await reload();
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(message);
          onError(message);
          onMessage(`Approve-safe failed: ${message}`);
        })
        .finally(() => setBusy(false));
    }
  });

  if (error) {
    return <Text color="red">Review error: {error}</Text>;
  }
  if (!model) {
    return <Text>Loading review candidates...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Review</Text>
      <Text>
        Keys: Up/Down or j/k move | a/Enter approve selected | d dismiss selected | s approve safe | r refresh
      </Text>
      <Text>
        Candidates: {model.totalCandidates} | Safe now: {model.safeCandidates}
      </Text>
      {model.candidates.length === 0 && <Text>No candidate memories waiting for review.</Text>}
      {model.candidates.slice(0, 12).map((entry, index) => (
        <Text key={entry.id} {...(index === selectedIndex ? { color: "cyan" } : {})}>
          {index === selectedIndex ? ">" : " "} {entry.id} | {entry.type} | {entry.importance} | {entry.title}
        </Text>
      ))}
      {busy && <Text color="yellow">Working...</Text>}
    </Box>
  );
}
