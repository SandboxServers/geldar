// Large text (prompts, thoughts, speech, tool results) as log fields or span events.
// Decision 0350 allows full text; filterAttributes caps each `geldar.content.*` string at 32 KiB and says when it cut.

import { type AttrValue, filterAttributes } from './attributes.ts';

export { type CappedText, CONTENT_CAP_BYTES, capText } from './cap-text.ts';

const encoder = new TextEncoder();

/**
 * Attributes for one content field: `geldar.content.<name>` (the capped text),
 * `.bytes` (the original size) and `.truncated`. Goes through the allow-list, so a
 * forbidden name such as `password` yields nothing.
 */
export function contentAttributes(name: string, text: string): Record<string, AttrValue> {
  const key = `geldar.content.${name}`;
  return filterAttributes(
    {
      [key]: text,
      [`${key}.bytes`]: encoder.encode(text).byteLength,
      [`${key}.truncated`]: false,
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
