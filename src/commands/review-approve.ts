import { Command } from "commander";
import { stdout as output } from "node:process";
import { loadConfig } from "../config.js";
import { reviewCandidateMemory } from "../reviewer.js";
import { approveCandidateMemory, loadStoredMemoryRecords, updateIndex, updateStoredMemoryStatus } from "../store.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
program
  .command("review")
  .description("Inspect candidate memories before approval; pairs naturally with brain approve --safe.")
  .action(async () => {
    const projectRoot = await helpers.resolveProjectRoot();
    const records = await loadStoredMemoryRecords(projectRoot);
    const candidates = helpers.getCandidateRecords(records);

    if (candidates.length === 0) {
      output.write("No candidate memories waiting for review.\n");
      return;
    }

    output.write(`Candidate memories: ${candidates.length}\n`);
    const safeCandidates = candidates.filter((entry) =>
      helpers.isSafeCandidateReview(
        reviewCandidateMemory(
          entry.memory,
          records.filter((record) => record.filePath !== entry.filePath),
        ),
      ),
    );
    for (const entry of candidates) {
      output.write(
        `- ${helpers.getStoredMemoryId(entry)} | ${entry.memory.type} | ${entry.memory.importance} | ${entry.memory.title}\n`,
      );
    }
    output.write(
      `Next: run "brain approve --safe" for ${safeCandidates.length} low-risk candidate memor${safeCandidates.length === 1 ? "y" : "ies"}, then "brain approve <id>" for anything that still needs manual judgment.\n`,
    );
  });

program

program
  .command("approve [memoryId]")
  .description("Promote candidate memories to active; use --safe for the normal low-risk review pass.")
  .option("--all", "Approve all candidate memories.")
  .option("--safe", "Approve only candidates that still review as low-risk novel memories.")
  .action(async (memoryId: string | undefined, options: { all?: boolean; safe?: boolean }) => {
    const projectRoot = await helpers.resolveProjectRoot();
    const records = await loadStoredMemoryRecords(projectRoot);
    const resolution = options.safe
      ? helpers.resolveSafeCandidateRecords(records, memoryId, options.all)
      : { matches: helpers.resolveCandidateRecords(records, memoryId, options.all), skipped: [] as helpers.SafeCandidateRecord[] };
    const matches = resolution.matches;

    if (options.safe && matches.length === 0) {
      const suffix =
        resolution.skipped.length > 0
          ? ` ${resolution.skipped.length} candidate memor${resolution.skipped.length === 1 ? "y still requires" : "ies still require"} manual review.`
          : "";
      output.write(`No safe candidate memories found.${suffix}\n`);
      return;
    }

    for (const entry of matches) {
      await approveCandidateMemory(entry, projectRoot);
    }

    await updateIndex(projectRoot);
    output.write(
      `Approved ${matches.length} ${options.safe ? "safe " : ""}candidate memor${matches.length === 1 ? "y" : "ies"}.\n`,
    );

    if (options.safe && resolution.skipped.length > 0) {
      output.write(
        `${resolution.skipped.length} candidate memor${resolution.skipped.length === 1 ? "y still requires" : "ies still require"} manual review.\n`,
      );
    }
  });

program

program
  .command("dismiss [memoryId]")
  .description("Dismiss one candidate memory, or all candidates with --all.")
  .option("--all", "Dismiss all candidate memories.")
  .action(async (memoryId: string | undefined, options: { all?: boolean }) => {
    const projectRoot = await helpers.resolveProjectRoot();
    const records = await loadStoredMemoryRecords(projectRoot);
    const matches = helpers.resolveCandidateRecords(records, memoryId, options.all);

    for (const entry of matches) {
      await updateStoredMemoryStatus(entry, "stale");
    }

    await updateIndex(projectRoot);
    output.write(`Dismissed ${matches.length} candidate memor${matches.length === 1 ? "y" : "ies"}.\n`);
  });

program

program
  .command("promote-candidates")
  .description(
    "Evaluate candidate memories and auto-promote those that pass strict safety checks. " +
    "Only novel, non-working, non-temporary candidates with accept/novel_memory review are promoted. " +
    "The rest stay in the candidate queue for manual review.",
  )
  .option("--dry-run", "Print the promotion plan without changing any files.")
  .action(async (options: { dryRun?: boolean }) => {
    const projectRoot = await helpers.resolveProjectRoot();
    const config = await loadConfig(projectRoot);

    if (!config.autoApproveSafeCandidates) {
      output.write(
        '[promote-candidates] autoApproveSafeCandidates is disabled in config. ' +
        'Set "autoApproveSafeCandidates: true" in .brain/config.yaml or use the automation-first workflow to enable.\n',
      );
      return;
    }

    const records = await loadStoredMemoryRecords(projectRoot);
    const result = helpers.evaluateAutoApprovalCandidates(records);

    if (result.promoted.length === 0 && result.kept.length === 0) {
      output.write("[promote-candidates] No candidate memories found.\n");
      return;
    }

    if (result.promoted.length > 0) {
      output.write(`Auto-promote (safe):\n`);
      for (const entry of result.promoted) {
        output.write(
          `  + ${helpers.getStoredMemoryId(entry.record)} | ${entry.record.memory.type} | ${entry.record.memory.importance} | ${entry.record.memory.title}\n`,
        );
      }
    }

    if (result.kept.length > 0) {
      output.write(`Kept as candidate (requires manual review):\n`);
      for (const entry of result.kept) {
        output.write(
          `  ~ ${helpers.getStoredMemoryId(entry.record)} | ${entry.record.memory.type} | ${entry.reason}\n`,
        );
      }
    }

    if (options.dryRun) {
      output.write(
        `\n[dry-run] Would promote ${result.promoted.length} candidate${result.promoted.length === 1 ? "" : "s"}, ` +
        `keep ${result.kept.length} for review.\n`,
      );
      return;
    }

    for (const entry of result.promoted) {
      await approveCandidateMemory(entry.record, projectRoot);
    }

    if (result.promoted.length > 0) {
      await updateIndex(projectRoot);
    }

    output.write(
      `\nPromoted ${result.promoted.length} safe candidate${result.promoted.length === 1 ? "" : "s"} to active. ` +
      `${result.kept.length} candidate${result.kept.length === 1 ? " remains" : "s remain"} for manual review.\n`,
    );
  });

program
}