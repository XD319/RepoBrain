import { readFileSync } from "node:fs";

const stdin = readFileSync(0, "utf8");

if (stdin.includes("Task:") || stdin.includes("Session summary:") || stdin.includes("Changed files:")) {
  process.stdout.write(
    JSON.stringify({
      memories: [
        {
          type: "decision",
          title: "Adopt candidate-first capture workflow",
          summary: "Use brain capture to gate extraction behind suggest-extract worthiness checks.",
          detail:
            "## DECISION\n\nAdopt candidate-first capture workflow so only worthwhile sessions produce durable memory.",
          tags: ["workflow", "capture"],
          importance: "medium",
          source: "session",
        },
      ],
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ memories: [] }));
