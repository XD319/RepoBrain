import { readFileSync } from "node:fs";

const mode = process.env.DETECTOR_FIXTURE_MODE ?? "empty";
const stdin = readFileSync(0, "utf8");

switch (mode) {
  case "success":
    if (!stdin.includes("Existing memory index") || !stdin.includes("Session log:")) {
      console.error("prompt shape missing");
      process.exit(2);
    }

    process.stdout.write(
      JSON.stringify([
        {
          kind: "violated_memory",
          description: "Ignored the transaction helper memory and wrote directly to the payments table.",
          relatedMemoryFile: "2026-04-01-keep-payment-writes-inside-the-transaction-helper.md",
          suggestedAction: "boost_score",
        },
        {
          kind: "new_failure",
          description: "Repeated flaky browser test debugging without checking Playwright traces first.",
          suggestedAction: "extract_new",
          draftContent:
            "gotcha: Check Playwright traces before retrying flaky browser tests\n\nWhen a browser test flakes, inspect the saved Playwright trace first so debugging starts from captured evidence instead of repeated blind reruns.",
        },
      ]),
    );
    break;
  case "invalid-json":
    process.stdout.write("not json");
    break;
  case "empty":
    process.stdout.write("[]");
    break;
  case "partial-invalid":
    process.stdout.write(
      JSON.stringify([
        {
          kind: "violated_memory",
          description: "Ignored the transaction helper memory and wrote directly to the payments table.",
          relatedMemoryFile: "2026-04-01-keep-payment-writes-inside-the-transaction-helper.md",
          suggestedAction: "boost_score",
        },
        {
          kind: "new_failure",
          description: "",
          suggestedAction: "extract_new",
        },
      ]),
    );
    break;
  case "error":
    console.error("forced failure");
    process.exit(1);
    break;
  default:
    console.error(`unknown mode: ${mode}`);
    process.exit(3);
}
