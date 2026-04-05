/**
 * Decode stdin bytes piped from shells that use legacy Windows code pages (e.g. GB18030/GBK)
 * while Node reads the stream as UTF-8 by default. When UTF-8 decoding yields replacement
 * characters (U+FFFD), re-decode the same buffer as GB18030 — the usual encoding for
 * Chinese text from PowerShell/cmd pipelines.
 */
export function decodeStdinBuffer(buffer: Buffer): string {
  if (buffer.length === 0) {
    return "";
  }

  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  try {
    const legacy = new TextDecoder("gb18030").decode(buffer);
    if (legacy.includes("\uFFFD")) {
      return utf8;
    }
    return legacy;
  } catch {
    return utf8;
  }
}
