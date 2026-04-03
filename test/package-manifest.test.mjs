import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();

await runTest("every explicit package.json files entry exists", async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const publishedEntries = packageJson.files.filter((entry) => !String(entry).endsWith("dist"));

  for (const relativePath of publishedEntries) {
    await access(path.join(projectRoot, relativePath));
  }
});

console.log("All package manifest tests passed.");

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}
