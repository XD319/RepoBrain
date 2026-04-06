import { Command } from "commander";
import { rm } from "node:fs/promises";
import path from "node:path";
import { stdout as output } from "node:process";
import { loadConfig, renderConfigWarnings } from "../config.js";
import { renderSweepDryRun, scanSweepCandidates } from "../sweep.js";
import { initBrain, loadStoredMemoryRecords, updateIndex, updateStoredMemoryStatus } from "../store.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("sweep")
    .description(
      "Clean stale, expired, duplicate, or archive-ready memories after score/review has told you what to inspect.",
    )
    .option("--auto", "Apply all safe sweep rules without prompting.")
    .option("--dry-run", "Print the sweep report without changing any files.")
    .action(async (options: { auto?: boolean; dryRun?: boolean }) => {
      if (options.auto && options.dryRun) {
        throw new Error('Use either "--auto" or "--dry-run", not both.');
      }

      const projectRoot = await helpers.resolveProjectRoot();
      await initBrain(projectRoot);
      const config = await loadConfig(projectRoot);
      renderConfigWarnings(config).forEach((warning) => process.stderr.write(`[repobrain] ${warning}\n`));

      if (options.dryRun) {
        const result = await scanSweepCandidates(projectRoot, config);
        output.write(`${renderSweepDryRun(result)}\n`);
        return;
      }

      if (options.auto) {
        await helpers.runSweepAuto(projectRoot, config, (line) => output.write(`${line}\n`));
        return;
      }

      await helpers.runSweepInteractive(projectRoot, config);
    });

  program;

  program
    .command("score")
    .description("Find low-quality or outdated memories before running brain sweep to clean them up.")
    .option("--mark-all", "Mark all matched memories as stale without prompting.")
    .option("--delete-all", "Delete all matched memories without prompting.")
    .option("--json", "Print matched memories as JSON and do not prompt.")
    .action(async (options: { markAll?: boolean; deleteAll?: boolean; json?: boolean }) => {
      const projectRoot = await helpers.resolveProjectRoot();
      const records = await loadStoredMemoryRecords(projectRoot);
      const candidates = helpers.buildScoreCandidates(records);

      if (candidates.length === 0) {
        output.write(
          options.json ? `${JSON.stringify([], null, 2)}\n` : "No memories matched the current score review rules.\n",
        );
        return;
      }

      if (options.markAll && options.deleteAll) {
        throw new Error('Choose only one of "--mark-all" or "--delete-all".');
      }

      if (options.json) {
        output.write(`${JSON.stringify(candidates.map(helpers.toScoreCandidateJson), null, 2)}\n`);
        return;
      }

      output.write(`${helpers.renderScoreTable(candidates)}\n`);

      let marked = 0;
      let deleted = 0;
      let skipped = 0;
      let quit = false;

      if (options.markAll) {
        for (const candidate of candidates) {
          await updateStoredMemoryStatus(candidate.record, "stale");
          marked += 1;
        }

        await updateIndex(projectRoot);
        output.write(`Summary: marked=${marked}, deleted=${deleted}, skipped=${skipped}\n`);
        return;
      }

      if (options.deleteAll) {
        for (const candidate of candidates) {
          await rm(candidate.record.filePath, { force: true });
          deleted += 1;
        }

        await updateIndex(projectRoot);
        output.write(`Summary: marked=${marked}, deleted=${deleted}, skipped=${skipped}\n`);
        return;
      }

      const promptAction = await helpers.createScoreActionPrompter();

      try {
        for (const candidate of candidates) {
          const action = await promptAction(path.basename(candidate.record.filePath));
          if (action === "q") {
            quit = true;
            break;
          }

          if (action === "s") {
            await updateStoredMemoryStatus(candidate.record, "stale");
            marked += 1;
            continue;
          }

          if (action === "d") {
            await rm(candidate.record.filePath, { force: true });
            deleted += 1;
            continue;
          }

          skipped += 1;
        }
      } finally {
        await promptAction.close();
      }

      if (marked > 0 || deleted > 0) {
        await updateIndex(projectRoot);
      }

      if (quit) {
        output.write("Score review exited early.\n");
      }

      output.write(`Summary: marked=${marked}, deleted=${deleted}, skipped=${skipped}\n`);
    });

  program;
}
