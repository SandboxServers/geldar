import { jsonString as animusJsonString } from '@geldar/animus/src/prompts/world-text.ts';
import { jsonString as playerCoreJsonString } from '@geldar/player-core/src/validate/json-string.ts';
import { describe, expect, it } from 'vitest';

/**
 * player-core keeps a copy of animus's jsonString (animus's prompts/** is frozen). These two must
 * agree on every input, at the default cap and at explicit ones, or the corrective text and the
 * prompt text would escape differently.
 */
const INPUTS: readonly string[] = [
  '',
  'plain words',
  'say "hi" and leave',
  'back\\slash and \\u0041',
  'line one\nline two\r\nline three',
  'tab\there',
  'control \u0000 \u0001 \u001f \u007f end',
  'café, naïve, Straße',
  '漢字テキスト and 한국어',
  'emoji 🙂 and astral 𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
  'line separators   and   and bidi ‮ reversed',
  'byte order mark ﻿ and zero width ​ joiner ‍',
  '<tag> and </tag> and &amp;',
  'a'.repeat(600),
  '🙂'.repeat(300),
  'x'.repeat(511) + 'é',
];

const CAPS: readonly (number | undefined)[] = [undefined, 1, 2, 8, 160, 512, 10_000];

describe('jsonString parity: animus and player-core copies', () => {
  for (const value of INPUTS) {
    it(`agrees on ${JSON.stringify(value).slice(0, 48)} (${value.length} code units)`, () => {
      for (const max of CAPS) {
        expect(playerCoreJsonString(value, max), `cap ${String(max)}`).toBe(
          animusJsonString(value, max),
        );
      }
    });
  }
});
