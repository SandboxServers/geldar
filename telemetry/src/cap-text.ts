// UTF-8 byte cap for large text. Lives apart from content.ts so attributes.ts can cap without a cycle.

export const CONTENT_CAP_BYTES = 32 * 1024;

export interface CappedText {
  text: string;
  bytes: number;
  truncated: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Caps text at `cap` UTF-8 bytes, cutting only on a character boundary. */
export function capText(text: string, cap: number = CONTENT_CAP_BYTES): CappedText {
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= cap) return { text, bytes: bytes.byteLength, truncated: false };
  let out = decoder.decode(bytes.subarray(0, cap));
  while (encoder.encode(out).byteLength > cap) out = out.slice(0, -1);
  return { text: out, bytes: bytes.byteLength, truncated: true };
}
