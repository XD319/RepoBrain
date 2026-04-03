import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FailureEvent } from "./failure-detector.js";
import { getBrainDir } from "./config.js";

export interface PendingReinforcementState {
  updatedAt: string;
  events: FailureEvent[];
}

export async function loadPendingReinforcementState(projectRoot: string): Promise<PendingReinforcementState> {
  try {
    const raw = await readFile(getPendingReinforcementPath(projectRoot), "utf8");
    return parsePendingReinforcementState(raw);
  } catch {
    return {
      updatedAt: "",
      events: [],
    };
  }
}

export async function savePendingReinforcementEvents(
  projectRoot: string,
  events: FailureEvent[],
): Promise<void> {
  const pendingPath = getPendingReinforcementPath(projectRoot);
  const current = await loadPendingReinforcementState(projectRoot);
  const merged = dedupeFailureEvents([...current.events, ...events]);

  await mkdir(path.dirname(pendingPath), { recursive: true });
  await writeFile(
    pendingPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        events: merged,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function clearPendingReinforcementEvents(projectRoot: string): Promise<void> {
  await rm(getPendingReinforcementPath(projectRoot), { force: true });
}

function getPendingReinforcementPath(projectRoot: string): string {
  return path.join(getBrainDir(projectRoot), "reinforce-pending.json");
}

function parsePendingReinforcementState(raw: string): PendingReinforcementState {
  try {
    const parsed = JSON.parse(raw) as {
      updatedAt?: unknown;
      events?: unknown;
    };

    const events = Array.isArray(parsed.events)
      ? parsed.events.map(parseFailureEvent).filter((event): event is FailureEvent => event !== null)
      : [];

    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      events,
    };
  } catch {
    return {
      updatedAt: "",
      events: [],
    };
  }
}

function parseFailureEvent(value: unknown): FailureEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  const description = candidate.description;
  const suggestedAction = candidate.suggestedAction;

  if (
    (kind !== "violated_memory" && kind !== "new_failure") ||
    typeof description !== "string" ||
    !description.trim() ||
    (suggestedAction !== "boost_score" && suggestedAction !== "rewrite_memory" && suggestedAction !== "extract_new")
  ) {
    return null;
  }

  if (kind === "violated_memory") {
    return typeof candidate.relatedMemoryFile === "string" && candidate.relatedMemoryFile.trim()
      ? {
          kind,
          description: description.trim(),
          suggestedAction,
          relatedMemoryFile: candidate.relatedMemoryFile.trim(),
        }
      : null;
  }

  return typeof candidate.draftContent === "string" && candidate.draftContent.trim()
    ? {
        kind,
        description: description.trim(),
        suggestedAction,
        draftContent: candidate.draftContent.trim(),
      }
    : null;
}

function dedupeFailureEvents(events: FailureEvent[]): FailureEvent[] {
  const seen = new Set<string>();
  const result: FailureEvent[] = [];

  for (const event of events) {
    const key = JSON.stringify(event);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(event);
  }

  return result;
}
