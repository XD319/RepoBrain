import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const VALID_STRATEGIES = new Set(["auto", "trusted", "token"]);

export function resolvePublishPlan({
  requestedStrategy = process.env.REPOBRAIN_PUBLISH_STRATEGY ?? "auto",
  npmToken = process.env.NPM_TOKEN ?? "",
  isGitHubActions = process.env.GITHUB_ACTIONS === "true",
} = {}) {
  const normalizedStrategy = String(requestedStrategy).trim().toLowerCase() || "auto";

  if (!VALID_STRATEGIES.has(normalizedStrategy)) {
    throw new Error(
      `Unsupported publish strategy "${requestedStrategy}". Expected one of: auto, trusted, token.`,
    );
  }

  const hasNpmToken = npmToken.trim().length > 0;
  const strategy = normalizedStrategy === "auto" ? (hasNpmToken ? "token" : "trusted") : normalizedStrategy;

  if (strategy === "token" && !hasNpmToken) {
    throw new Error("Publish strategy \"token\" requires the NPM_TOKEN environment variable.");
  }

  if (strategy === "trusted" && !isGitHubActions) {
    throw new Error(
      "Trusted publishing requires GitHub Actions with id-token: write. Set NPM_TOKEN to use the token fallback locally.",
    );
  }

  return {
    strategy,
    requestedStrategy: normalizedStrategy,
    command: "publish",
    args: strategy === "trusted" ? ["publish", "--provenance"] : ["publish"],
    summary:
      strategy === "trusted"
        ? "Using npm trusted publishing with provenance."
        : "Using the NPM_TOKEN fallback publish path.",
  };
}

export async function runPublish(plan, env = process.env) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const publishEnv =
    plan.strategy === "token"
      ? {
          ...env,
          NODE_AUTH_TOKEN: env.NODE_AUTH_TOKEN ?? env.NPM_TOKEN,
        }
      : env;

  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand, plan.args, {
      stdio: "inherit",
      env: publishEnv,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`npm publish was terminated by signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`npm publish exited with code ${code}.`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const plan = resolvePublishPlan();
  console.log(`[release] ${plan.summary}`);
  await runPublish(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[release] ${error.message}`);
    process.exitCode = 1;
  });
}
