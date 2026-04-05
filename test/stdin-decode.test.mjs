import assert from "node:assert/strict";

import { decodeStdinBuffer } from "../dist/stdin-decode.js";

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await runTest("decodeStdinBuffer leaves valid UTF-8 unchanged", () => {
  const buf = Buffer.from("convention: 每次改完都提交，使用 Conventional Commits", "utf8");
  assert.equal(decodeStdinBuffer(buf), buf.toString("utf8"));
});

await runTest("decodeStdinBuffer re-decodes GB18030 when UTF-8 has replacement characters", () => {
  // "convention: " in ASCII + GBK/GB2312 encoding of U+4E2D (中) = 0xD6 0xD0
  const buf = Buffer.concat([Buffer.from("convention: ", "latin1"), Buffer.from([0xd6, 0xd0])]);
  const utf8Lossy = buf.toString("utf8");
  assert.ok(utf8Lossy.includes("\uFFFD"), "expected invalid UTF-8 to produce replacement chars");
  const decoded = decodeStdinBuffer(buf);
  assert.ok(decoded.includes("中"), `expected Chinese character, got: ${JSON.stringify(decoded)}`);
  assert.ok(decoded.startsWith("convention:"), decoded);
});

await runTest("decodeStdinBuffer handles empty buffer", () => {
  assert.equal(decodeStdinBuffer(Buffer.alloc(0)), "");
});
