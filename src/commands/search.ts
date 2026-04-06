import { Command } from "commander";
import { stdout as output } from "node:process";

import { loadStoredMemoryRecords } from "../store.js";
import { searchMemories, formatSearchResultLine, renderSearchResultsJson } from "../search.js";
import type { SearchFilters } from "../search.js";
import { MEMORY_STATUSES } from "../types.js";
import type { MemoryType, MemoryStatus } from "../types.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("search")
    .description("Search memories by keyword.")
    .argument("<query>", "Keywords to search (AND semantics; case-insensitive).")
    .option("--type <type>", "Filter by memory type.", helpers.parseMemoryTypeOption)
    .option("--tag <tag>", "Filter by tag.")
    .option("--status <status>", "Filter by status (default: active only).", parseMemoryStatusOption)
    .option("--all", "Include memories of all statuses.")
    .option("--json", "Output results as JSON.")
    .action(
      async (
        query: string,
        options: {
          type?: MemoryType;
          tag?: string;
          status?: MemoryStatus;
          all?: boolean;
          json?: boolean;
        },
      ) => {
        const projectRoot = await helpers.resolveProjectRoot();
        const records = await loadStoredMemoryRecords(projectRoot);

        const filters: SearchFilters = {};
        if (options.type !== undefined) {
          filters.type = options.type;
        }
        if (options.tag !== undefined) {
          filters.tag = options.tag;
        }
        if (options.status !== undefined) {
          filters.status = options.status;
        }
        if (options.all !== undefined) {
          filters.all = options.all;
        }

        const results = searchMemories(records, query, filters);

        if (options.json) {
          output.write(`${JSON.stringify(renderSearchResultsJson(results), null, 2)}\n`);
          return;
        }

        if (results.length === 0) {
          output.write("No matching memories found.\n");
          return;
        }

        output.write(`Found ${results.length} matching memor${results.length === 1 ? "y" : "ies"}:\n`);
        for (const result of results) {
          output.write(`${formatSearchResultLine(result)}\n`);
        }
      },
    );
}

function parseMemoryStatusOption(value: string): MemoryStatus {
  const normalized = value.trim().toLowerCase();
  if (MEMORY_STATUSES.includes(normalized as MemoryStatus)) {
    return normalized as MemoryStatus;
  }

  throw new Error(`Unsupported memory status "${value}". Expected one of: ${MEMORY_STATUSES.join(", ")}.`);
}
