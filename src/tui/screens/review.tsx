import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  approveCandidateAction,
  buildCandidateListViewModel,
  dismissCandidateAction,
  type CandidateActionResultViewModel,
  type CandidateListItemViewModel,
  type CandidateListViewModel,
} from "../adapters/review.js";
import { Section } from "../components/section.js";

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

export type ReviewPendingAction =
  | {
      kind: "approve";
      candidate: CandidateListItemViewModel;
    }
  | {
      kind: "dismiss";
      candidate: CandidateListItemViewModel;
    }
  | {
      kind: "safe-approve-all";
      safeCandidates: number;
      totalCandidates: number;
    };

export function getSelectedCandidate(
  model: CandidateListViewModel | null,
  selectedIndex: number,
): CandidateListItemViewModel | undefined {
  if (!model || model.candidates.length === 0) {
    return undefined;
  }
  const safeIndex = clampSelection(model.candidates.length, selectedIndex);
  return model.candidates[safeIndex];
}

export function buildPendingAction(
  kind: ReviewPendingAction["kind"],
  model: CandidateListViewModel | null,
  selectedIndex: number,
): ReviewPendingAction | null {
  if (!model) {
    return null;
  }
  if (kind === "safe-approve-all") {
    if (model.safeCandidates <= 0) {
      return null;
    }
    return {
      kind,
      safeCandidates: model.safeCandidates,
      totalCandidates: model.totalCandidates,
    };
  }
  const candidate = getSelectedCandidate(model, selectedIndex);
  if (!candidate) {
    return null;
  }
  return { kind, candidate };
}

export function renderPendingActionSummary(pendingAction: ReviewPendingAction | null): string {
  if (!pendingAction) {
    return "[a]pprove [d]ismiss [s]afe-approve-all [r]efresh";
  }
  if (pendingAction.kind === "safe-approve-all") {
    return `Confirm safe approve for ${pendingAction.safeCandidates} candidate(s) out of ${pendingAction.totalCandidates}: [y]es Enter / [n]o Esc`;
  }
  return `Confirm ${pendingAction.kind} ${pendingAction.candidate.id} | ${pendingAction.candidate.type} | ${pendingAction.candidate.importance} | ${pendingAction.candidate.title}: [y]es Enter / [n]o Esc`;
}

export function ReviewScreen({ projectRoot, onMessage, onError }: ReviewScreenProps): React.JSX.Element {
  const [model, setModel] = useState<CandidateListViewModel | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<ReviewPendingAction | null>(null);

  const reload = useCallback(async () => {
    const next = await buildCandidateListViewModel(projectRoot);
    setModel(next);
    setSelectedIndex((current) => clampSelection(next.candidates.length, current));
    setPendingAction(null);
  }, [projectRoot]);

  const runConfirmedAction = useCallback(
    async (action: ReviewPendingAction): Promise<CandidateActionResultViewModel> => {
      switch (action.kind) {
        case "approve":
          return approveCandidateAction(projectRoot, action.candidate.id, { safe: false });
        case "dismiss":
          return dismissCandidateAction(projectRoot, action.candidate.id, {});
        case "safe-approve-all":
          return approveCandidateAction(projectRoot, undefined, { safe: true });
      }
    },
    [projectRoot],
  );

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
    if (pendingAction) {
      if (input === "n" || key.escape) {
        setPendingAction(null);
        onMessage("Review action cancelled.");
        return;
      }
      if (input === "y" || key.return) {
        setBusy(true);
        onError(null);
        void runConfirmedAction(pendingAction)
          .then(async (result) => {
            if (pendingAction.kind === "safe-approve-all") {
              const skipped = result.skippedManualReviewCount ?? 0;
              onMessage(`Approved ${result.affectedCount} safe candidates, skipped ${skipped}.`);
            } else {
              onMessage(
                `${pendingAction.kind === "approve" ? "Approved" : "Dismissed"} ${result.affectedCount} candidate.`,
              );
            }
            await reload();
          })
          .catch((reason: unknown) => {
            const message = reason instanceof Error ? reason.message : String(reason);
            onError(message);
            onMessage(`${pendingAction.kind} failed: ${message}`);
          })
          .finally(() => {
            setBusy(false);
            setPendingAction(null);
          });
        return;
      }
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
      const nextAction = buildPendingAction("approve", model, selectedIndex);
      if (!nextAction || nextAction.kind !== "approve") {
        return;
      }
      setPendingAction(nextAction);
      onMessage(`Ready to approve ${nextAction.candidate.id}. Press y or Enter to confirm.`);
      return;
    }
    if (input === "d") {
      const nextAction = buildPendingAction("dismiss", model, selectedIndex);
      if (!nextAction || nextAction.kind !== "dismiss") {
        return;
      }
      setPendingAction(nextAction);
      onMessage(`Ready to dismiss ${nextAction.candidate.id}. Press y or Enter to confirm.`);
      return;
    }
    if (input === "s") {
      const nextAction = buildPendingAction("safe-approve-all", model, selectedIndex);
      if (!nextAction || nextAction.kind !== "safe-approve-all") {
        onMessage("No safe candidates available to approve.");
        return;
      }
      setPendingAction(nextAction);
      onMessage(`Ready to safe-approve ${nextAction.safeCandidates} candidate(s). Press y or Enter to confirm.`);
    }
  });

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
      {pendingAction && (
        <Section title="Confirm Action">
          <Text>{renderPendingActionSummary(pendingAction)}</Text>
        </Section>
      )}
      <Box marginTop={1}>
        <Text color="gray">Status: {renderPendingActionSummary(pendingAction)}</Text>
      </Box>
      {busy && <Text color="yellow">Working...</Text>}
    </Box>
  );
}
