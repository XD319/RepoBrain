import { expect, it } from "vitest";

import { decodeStdinBuffer } from "../dist/stdin-decode.js";

function runTest(name, callback) {
  it(name, callback);
}

const assert = {
  equal(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  strictEqual(actual, expected, message) {
    expect(actual, message).toBe(expected);
  },
  notEqual(actual, expected, message) {
    expect(actual, message).not.toBe(expected);
  },
  deepEqual(actual, expected, message) {
    expect(actual, message).toEqual(expected);
  },
  notDeepEqual(actual, expected, message) {
    expect(actual, message).not.toEqual(expected);
  },
  ok(value, message) {
    expect(value, message).toBeTruthy();
  },
  match(value, pattern, message) {
    expect(value, message).toMatch(pattern);
  },
  doesNotMatch(value, pattern, message) {
    expect(value, message).not.toMatch(pattern);
  },
  throws(action, matcher, message) {
    if (matcher === undefined) {
      expect(action, message).toThrow();
      return;
    }
    expect(action, message).toThrow(matcher);
  },
  async rejects(action, matcher, message) {
    let failure;
    try {
      await action();
    } catch (error) {
      failure = error;
    }
    expect(failure, message ?? "expected promise to reject").toBeTruthy();
    if (typeof matcher === "function") {
      const handled = matcher(failure);
      expect(handled, message ?? "reject matcher should confirm the error").toBe(true);
      return;
    }
    if (matcher instanceof RegExp) {
      expect(failure.message, message).toMatch(matcher);
      return;
    }
    if (matcher && typeof matcher === "object") {
      expect(failure, message).toMatchObject(matcher);
    }
  },
  fail(message) {
    throw new Error(message ?? "assert.fail was called");
  },
};

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

await runTest("decodeStdinBuffer decodes UTF-16LE stdin payloads", () => {
  const utf16le = Buffer.from("gotcha: 修复审批重试", "utf16le");
  const decoded = decodeStdinBuffer(utf16le);
  assert.equal(decoded, "gotcha: 修复审批重试");
});

await runTest("decodeStdinBuffer decodes UTF-16LE payloads dominated by Chinese characters", () => {
  const utf16le = Buffer.from("城市名必须 encodeURIComponent，否则会失败", "utf16le");
  const decoded = decodeStdinBuffer(utf16le);
  assert.equal(decoded, "城市名必须 encodeURIComponent，否则会失败");
});
