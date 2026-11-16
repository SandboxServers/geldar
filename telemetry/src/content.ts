// Large text (prompts, thoughts, speech, tool results) as log fields or span events.
// Decision 0350 allows full text; this helper caps each field at 32 KiB and says when it cut.

import { type AttrValue, filterAttributes } from './attributes.ts';

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

/**
 * Attributes for one content field: `geldar.content.<name>` (the capped text),
 * `.bytes` (the original size) and `.truncated`. Goes through the allow-list, so a
 * forbidden name such as `password` yields nothing.
 */
export function contentAttributes(name: string, text: string): Record<string, AttrValue> {
  const capped = capText(text);
  const key = `geldar.content.${name}`;
  return filterAttributes(
    {
      [key]: capped.text,
      [`${key}.bytes`]: capped.bytes,
      [`${key}.truncated`]: capped.truncated,
    },
    'trace',
  ).attributes;
}

export interface EventSpan {
  addEvent(name: string, attributes?: Record<string, AttrValue>): unknown;
}

/** Records one content field as a span event. Returns whether the text was truncated. */
export function addContentEvent(span: EventSpan, name: string, text: string): boolean {
  const attributes = contentAttributes(name, text);
  span.addEvent(`geldar.content.${name}`, attributes);
  return attributes[`geldar.content.${name}.truncated`] === true;
}
