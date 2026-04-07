import { Command } from "commander";
import * as helpers from "./helpers.js";
import { runTui } from "../tui/index.js";
import { parseInitialScreen } from "../tui/app.js";

export function register(program: Command): void {
  program
    .command("tui")
    .description("Launch RepoBrain terminal UI.")
    .option("--screen <screen>", "Initial screen: dashboard | review | memories | preferences | routing.", "dashboard")
    .action(async (options: { screen?: string }) => {
      const projectRoot = await helpers.resolveProjectRoot();
      const initialScreen = parseInitialScreen(options.screen);
      await runTui({ projectRoot, initialScreen });
    });
}
