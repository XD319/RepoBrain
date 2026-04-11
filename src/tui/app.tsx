import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { DashboardScreen } from "./screens/dashboard.js";
import { ReviewScreen } from "./screens/review.js";
import { MemoriesScreen } from "./screens/memories.js";
import { PreferencesScreen } from "./screens/preferences.js";
import { RoutingScreen } from "./screens/routing.js";
import { SearchScreen } from "./screens/search.js";
import { ErrorBar } from "./components/error-bar.js";

export const SCREEN_IDS = ["dashboard", "review", "memories", "preferences", "routing", "search"] as const;
export type ScreenId = (typeof SCREEN_IDS)[number];

const SCREEN_LABELS: Record<ScreenId, string> = {
  dashboard: "Dashboard",
  review: "Review",
  memories: "Memories",
  preferences: "Preferences",
  routing: "Routing",
  search: "Search",
};

const SCREEN_ACTION_HINTS: Record<ScreenId, string> = {
  dashboard: "Dashboard: [r] refresh [v] toggle recent list",
  review: "Review: [a] approve [d] dismiss [s] safe-approve-all [r] refresh",
  memories: "Memories: [t] type [s] status [i] importance [d] detail [r] refresh",
  preferences: "Preferences: [d] detail [x] dismiss selected target [r] refresh",
  routing: "Routing: [t] edit task [p] edit paths [Enter] build route [r] refresh",
  search: "Search: type query [j/k] move [Enter] detail or run now []] type filter [r] refresh",
};

export function parseInitialScreen(value: string | undefined): ScreenId {
  const normalized = value?.trim().toLowerCase() ?? "dashboard";
  if (SCREEN_IDS.includes(normalized as ScreenId)) {
    return normalized as ScreenId;
  }
  throw new Error(`Unsupported screen "${value}". Expected one of: ${SCREEN_IDS.join(", ")}.`);
}

export function resolveScreenHotkey(input: string): ScreenId | null {
  switch (input) {
    case "1":
      return "dashboard";
    case "2":
      return "review";
    case "3":
      return "memories";
    case "4":
      return "preferences";
    case "5":
      return "routing";
    case "6":
      return "search";
    default:
      return null;
  }
}

export function getScreenLabel(screen: ScreenId): string {
  return SCREEN_LABELS[screen];
}

export function getNextScreen(current: ScreenId): ScreenId {
  const currentIndex = SCREEN_IDS.indexOf(current);
  const nextIndex = (currentIndex + 1) % SCREEN_IDS.length;
  return SCREEN_IDS[nextIndex] ?? current;
}

export function getGlobalShortcutHint(screen: ScreenId): string {
  const nav = "Navigate: [1-6] jump [Tab] next [q/Esc/Ctrl+C] exit";
  return `${nav} | ${SCREEN_ACTION_HINTS[screen]}`;
}

export interface AppProps {
  projectRoot: string;
  initialScreen: ScreenId;
}

export function App({ projectRoot, initialScreen }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<ScreenId>(initialScreen);
  const [globalMessage, setGlobalMessage] = useState<string>("Ready.");
  const [screenError, setScreenError] = useState<string | null>(null);
  const activeLabel = useMemo(() => getScreenLabel(screen), [screen]);
  const globalShortcutHint = useMemo(() => getGlobalShortcutHint(screen), [screen]);

  useInput((input, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    const screenHotkey = resolveScreenHotkey(input);
    if (screenHotkey) {
      setScreen(screenHotkey);
      setScreenError(null);
      return;
    }
    if (key.tab) {
      setScreen(getNextScreen(screen));
      setScreenError(null);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="cyan">RepoBrain TUI</Text>
      <Text>Screens: 1 Dashboard | 2 Review | 3 Memories | 4 Preferences | 5 Routing | 6 Search</Text>
      <Text>Active: {activeLabel}</Text>
      <Text color="gray">Message: {globalMessage}</Text>
      <Box marginTop={1} flexDirection="column">
        {screen === "dashboard" && (
          <DashboardScreen projectRoot={projectRoot} onMessage={setGlobalMessage} onError={setScreenError} />
        )}
        {screen === "review" && (
          <ReviewScreen projectRoot={projectRoot} onMessage={setGlobalMessage} onError={setScreenError} />
        )}
        {screen === "memories" && (
          <MemoriesScreen projectRoot={projectRoot} onMessage={setGlobalMessage} onError={setScreenError} />
        )}
        {screen === "preferences" && (
          <PreferencesScreen projectRoot={projectRoot} onMessage={setGlobalMessage} onError={setScreenError} />
        )}
        {screen === "routing" && (
          <RoutingScreen projectRoot={projectRoot} onMessage={setGlobalMessage} onError={setScreenError} />
        )}
        {screen === "search" && (
          <SearchScreen projectRoot={projectRoot} onMessage={setGlobalMessage} onError={setScreenError} />
        )}
      </Box>
      <ErrorBar error={screenError} />
      <Box marginTop={1}>
        <Text color="gray">{globalShortcutHint}</Text>
      </Box>
    </Box>
  );
}
