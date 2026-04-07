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

  // UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString("utf8");
  }
  // UTF-16LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  // UTF-16BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return swap16AndDecode(buffer.subarray(2));
  }

  const utf16leCandidate = decodeLikelyUtf16Le(buffer);
  if (utf16leCandidate) {
    return utf16leCandidate;
  }

  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) {
    return utf8;
  }

  try {
    const legacy = new TextDecoder("gb18030").decode(buffer);
    if (legacy.includes("\uFFFD") || hasTooManyControlChars(legacy)) {
      return utf8;
    }
    return legacy;
  } catch {
    return utf8;
  }
}

function decodeLikelyUtf16Le(buffer: Buffer): string | null {
  if (buffer.length < 4 || buffer.length % 2 !== 0) {
    return null;
  }
  let zeroHighBytes = 0;
  let zeroLowBytes = 0;
  for (let index = 0; index < buffer.length; index += 2) {
    if (buffer[index] === 0) {
      zeroLowBytes += 1;
    }
    if (buffer[index + 1] === 0) {
      zeroHighBytes += 1;
    }
  }
  const pairCount = buffer.length / 2;
  // Typical UTF-16LE text containing mostly ASCII has 0x00 in most high bytes.
  if (zeroHighBytes / pairCount < 0.35 || zeroLowBytes / pairCount > 0.35) {
    return null;
  }
  const decoded = buffer.toString("utf16le").replace(/^\uFEFF/, "");
  if (hasTooManyControlChars(decoded)) {
    return null;
  }
  return decoded;
}

function swap16AndDecode(buffer: Buffer): string {
  const swapped = Buffer.from(buffer);
  swapped.swap16();
  return swapped.toString("utf16le");
}

function hasTooManyControlChars(text: string): boolean {
  if (!text) {
    return false;
  }
  let controlChars = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20 && char !== "\n" && char !== "\r" && char !== "\t") {
      controlChars += 1;
    }
  }
  return controlChars / text.length > 0.2;
}
