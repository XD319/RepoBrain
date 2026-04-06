import { Command } from "commander";
import { runMcpServer } from "../mcp/server.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("mcp")
    .description("Run RepoBrain as a minimal MCP stdio server.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      await runMcpServer(projectRoot);
    });
}
