import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/audit-memory.ts",
    "src/cli.ts",
    "src/failure-detector.ts",
    "src/inject.ts",
    "src/integrations.ts",
    "src/store-api.ts",
    "src/suggest-skills.ts",
    "src/hooks/session-start.ts",
    "src/hooks/session-end.ts",
    "src/mcp/server.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  shims: false,
});
