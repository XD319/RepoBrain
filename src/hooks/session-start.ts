#!/usr/bin/env node

import { stderr, stdout } from "node:process";

import { findProjectRoot, loadConfig } from "../config.js";
import { buildInjection } from "../inject.js";

async function main(): Promise<void> {
  const projectRoot = await findProjectRoot(process.cwd());
  if (!projectRoot) {
    return;
  }

  try {
    const config = await loadConfig(projectRoot);
    const injection = await buildInjection(projectRoot, config);
    stdout.write(injection);
    if (!injection.endsWith("\n")) {
      stdout.write("\n");
    }
  } catch (error) {
    debugLog(error instanceof Error ? error.message : String(error));
  }
}

function debugLog(message: string): void {
  if (process.env.PROJECT_BRAIN_VERBOSE === "1") {
    stderr.write(`[repobrain] ${message}\n`);
  }
}

main().catch((error: unknown) => {
  debugLog(error instanceof Error ? error.message : String(error));
  process.exitCode = 0;
});
