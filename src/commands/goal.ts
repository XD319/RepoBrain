import { Command } from "commander";
import { stdout as output } from "node:process";
import { loadStoredMemoryRecords, overwriteStoredMemory, updateIndex } from "../store.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  const goalProgram = program.command("goal").description("Manage goal memories in the current project.");

  goalProgram
    .command("done <keyword>")
    .description("Mark a goal memory as done by matching a title keyword.")
    .action(async (keyword: string) => {
      const projectRoot = await helpers.resolveProjectRoot();
      const records = await loadStoredMemoryRecords(projectRoot);
      const query = keyword.trim().toLowerCase();

      if (!query) {
        throw new Error("Provide a keyword to match a goal title.");
      }

      const matches = records.filter(
        (entry) => entry.memory.type === "goal" && entry.memory.title.toLowerCase().includes(query),
      );

      if (matches.length === 0) {
        throw new Error(`No goal memory matched "${keyword}".`);
      }

      if (matches.length > 1) {
        const suggestions = matches.map((entry) => `- ${helpers.getStoredMemoryId(entry)} (${entry.memory.title})`);
        throw new Error(
          [`Multiple goal memories matched "${keyword}". Use a more specific keyword:`, ...suggestions].join("\n"),
        );
      }

      const [match] = matches;
      if (!match) {
        throw new Error(`No goal memory matched "${keyword}".`);
      }

      const today = helpers.getTodayDate();
      await overwriteStoredMemory({
        ...match,
        memory: {
          ...match.memory,
          status: "done",
          updated: today,
        },
      });

      await updateIndex(projectRoot);
      output.write(`Marked goal as done: ${match.memory.title} (${helpers.getStoredMemoryId(match)})\n`);
    });
}
