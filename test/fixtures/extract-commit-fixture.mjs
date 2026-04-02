import { readFileSync } from "node:fs";

const stdin = readFileSync(0, "utf8");

if (
  stdin.includes("Source: git-commit") &&
  stdin.includes("## Commit metadata") &&
  stdin.includes("## Changed files") &&
  stdin.includes("## Diff stat") &&
  stdin.includes("Subject: feat: add commit extraction input") &&
  stdin.includes("A\tfeature.txt") &&
  stdin.includes("1 file changed, 1 insertion(+)")
) {
  process.stdout.write(
    JSON.stringify({
      memories: [
        {
          type: "decision",
          title: "Use richer git commit context for extraction",
          summary: "Commit extraction should include changed files and diff stat, not only the commit message.",
          detail:
            "## DECISION\n\nUse richer git commit context for extraction so the extractor sees the commit message, changed files, and diff stat together.",
          tags: ["git", "extract"],
          importance: "medium",
          source: "git-commit",
        },
      ],
    }),
  );
  process.exit(0);
}

process.stdout.write(JSON.stringify({ memories: [] }));
