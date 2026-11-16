// UTF-8 byte cap for large text. Lives apart from content.ts so attributes.ts can cap without a cycle.

export const CONTENT_CAP_BYTES = 32 * 1024;

export interface CappedText {
  text: string;
  bytes: number;
  truncated: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Caps text at `cap` UTF-8 bytes, cutting only on a character boundary (never inside a multi-byte character). */
export function capText(text: string, cap: number = CONTENT_CAP_BYTES): CappedText {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= cap) return { text, bytes: bytes.byteLength, truncated: false };
  // Continuation bytes are 10xxxxxx. Back off while the first dropped byte is one, so a character
  // that straddles the cap is dropped whole and the kept bytes are always complete characters.
  let end = cap;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: decoder.decode(bytes.subarray(0, end)), bytes: bytes.byteLength, truncated: true };
}
