#!/usr/bin/env node

import { Command } from "commander";

import { register as registerInitSetup } from "./commands/init-setup.js";
import { register as registerExtract } from "./commands/extract.js";
import { register as registerInject } from "./commands/inject.js";
import { register as registerReviewApprove } from "./commands/review-approve.js";
import { register as registerListStats } from "./commands/list-stats.js";
import { register as registerGoal } from "./commands/goal.js";
import { register as registerSweepScore } from "./commands/sweep-score.js";
import { register as registerPreference } from "./commands/preference.js";
import { register as registerSession } from "./commands/session.js";
import { register as registerRouting } from "./commands/routing.js";
import { register as registerMemoryOps } from "./commands/memory-ops.js";
import { register as registerShare } from "./commands/share.js";
import { register as registerMcp } from "./commands/mcp.js";

const program = new Command();

program
  .name("brain")
  .description("Repo-native project knowledge memory for coding agents.")
  .version("0.1.0");

registerInitSetup(program);
registerExtract(program);
registerInject(program);
registerReviewApprove(program);
registerListStats(program);
registerGoal(program);
registerSweepScore(program);
registerPreference(program);
registerSession(program);
registerRouting(program);
registerMemoryOps(program);
registerShare(program);
registerMcp(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
