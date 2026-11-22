import { describe, expect, it } from 'vitest';
import { MAX_ITEM_CHARS, isRiskyCodePoint, jsonString } from './json-string';

describe('jsonString escaping', () => {
  it('wraps plain text in quotes and leaves it unchanged', () => {
    expect(jsonString('plain text')).toBe('"plain text"');
    expect(jsonString('')).toBe('""');
  });

  it('escapes double quotes and backslashes the JSON way', () => {
    expect(jsonString('say "hi"')).toBe('"say \\"hi\\""');
    expect(jsonString('a\\b')).toBe('"a\\\\b"');
  });

  it('escapes ASCII control characters', () => {
    expect(jsonString('\n')).toBe('"\\n"');
    expect(jsonString('\t')).toBe('"\\t"');
    expect(jsonString('\u0000')).toBe('"\\u0000"');
    expect(jsonString('\u0001')).toBe('"\\u0001"');
    expect(jsonString('\u001f')).toBe('"\\u001f"');
  });

  it('escapes angle brackets, DEL and C1 controls as unicode escapes', () => {
    expect(jsonString('<')).toBe('"\\u003c"');
    expect(jsonString('>')).toBe('"\\u003e"');
    expect(jsonString('\u007f')).toBe('"\\u007f"');
    expect(jsonString('\u0085')).toBe('"\\u0085"');
  });

  it('escapes the line and paragraph separators U+2028 and U+2029', () => {
    expect(jsonString(' ')).toBe('"\\u2028"');
    expect(jsonString(' ')).toBe('"\\u2029"');
  });

  it('escapes format characters: soft hyphen, zero-width space and BOM', () => {
    expect(jsonString('­')).toBe('"\\u00ad"');
    expect(jsonString('​')).toBe('"\\u200b"');
    expect(jsonString('﻿')).toBe('"\\ufeff"');
  });

  it('escapes a risky astral code point as two UTF-16 unit escapes', () => {
    // U+E0001 (language tag) is a surrogate pair: D B40 DC01.
    expect(jsonString('\u{e0001}')).toBe('"\\udb40\\udc01"');
  });

  it('passes ordinary unicode through raw, astral included', () => {
    expect(jsonString('café')).toBe('"café"');
    expect(jsonString('\u{1f600}')).toBe('"\u{1f600}"');
  });

  it('escapes lone surrogates instead of emitting broken UTF-16', () => {
    expect(jsonString('\ud800')).toBe('"\\ud800"');
    expect(jsonString('\udc00')).toBe('"\\udc00"');
  });

  it('cuts by code points and appends an ellipsis at the limit', () => {
    expect(jsonString('abcdef', 4)).toBe('"abc…"');
    expect(jsonString('\u{1f600}\u{1f600}\u{1f600}', 2)).toBe('"\u{1f600}…"');
  });

  it('keeps a string of exactly the limit whole and cuts one character over it', () => {
    expect(jsonString('x'.repeat(MAX_ITEM_CHARS))).toBe(`"${'x'.repeat(MAX_ITEM_CHARS)}"`);
    expect(jsonString('x'.repeat(MAX_ITEM_CHARS + 1))).toBe(
      `"${'x'.repeat(MAX_ITEM_CHARS - 1)}…"`,
    );
  });

  it('reports risky code points for the same classes it escapes', () => {
    expect(isRiskyCodePoint(0x2028)).toBe(true);
    expect(isRiskyCodePoint(0x41)).toBe(false);
  });
});
