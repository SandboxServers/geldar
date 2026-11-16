import { describe, expect, it } from 'vitest';
import { CONTENT_CAP_BYTES, capText } from '../src/cap-text.ts';

const encoder = new TextEncoder();
const bytesOf = (text: string): number => encoder.encode(text).byteLength;

describe('capText character boundary', () => {
  it('never cuts a 4-byte emoji in half', () => {
    const text = `a${'😀'.repeat(10_000)}`;
    const capped = capText(text);
    expect(capped.truncated).toBe(true);
    expect(bytesOf(capped.text)).toBeLessThanOrEqual(CONTENT_CAP_BYTES);
    expect(capped.text).not.toContain('�');
    expect(text.startsWith(capped.text)).toBe(true);
    // 'a' plus whole emoji: the largest such prefix within 32768 bytes is 1 + 4 * 8191 = 32765 bytes.
    expect(bytesOf(capped.text)).toBe(32_765);
    expect(capped.bytes).toBe(bytesOf(text));
  });

  it('leaves text of exactly the cap length untouched', () => {
    const text = 'a'.repeat(CONTENT_CAP_BYTES);
    expect(capText(text)).toEqual({ text, bytes: 32_768, truncated: false });
  });

  it('cuts text one byte over the cap to exactly the cap', () => {
    const text = 'a'.repeat(CONTENT_CAP_BYTES + 1);
    const capped = capText(text);
    expect(capped.truncated).toBe(true);
    expect(capped.text).toBe('a'.repeat(CONTENT_CAP_BYTES));
    expect(capped.bytes).toBe(32_769);
  });

  it('keeps a whole emoji that ends exactly at the cap', () => {
    const text = `${'a'.repeat(32_764)}😀`;
    expect(bytesOf(text)).toBe(32_768);
    expect(capText(text)).toEqual({ text, bytes: 32_768, truncated: false });
  });

  it('backs off an emoji that straddles the cap and keeps the text valid', () => {
    const text = `${'a'.repeat(32_765)}😀`;
    expect(bytesOf(text)).toBe(32_769);
    const capped = capText(text);
    expect(capped.text).toBe('a'.repeat(32_765));
    expect(capped.text).not.toContain('�');
    expect(capped.truncated).toBe(true);
  });
});
