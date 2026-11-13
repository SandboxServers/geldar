import { readFileSync } from 'node:fs';
import { markedWords } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { NOT_IN_SIGHT } from './give.ts';
import { MESSAGE } from './place.ts';

/** Texts an agent reads as failure reasons: facts only, no marker words, no digits, no Minecraft ids. */
function assertFactsOnly(text: string): void {
  expect(markedWords(text)).toEqual([]);
  expect(text).not.toMatch(/\d|minecraft:/);
}

/** The source of an action file, so a pinned text cannot come back unnoticed. */
function source(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf8');
}

describe('failure texts state facts only', () => {
  it('keeps every fixed place message and the give message free of marker words, digits and ids', () => {
    for (const text of Object.values(MESSAGE)) assertFactsOnly(text);
    assertFactsOnly(NOT_IN_SIGHT);
  });

  it('pins the texts that carry no library error, and drops the raw error from each', () => {
    const pinned: Array<[file: string, text: string, raw: string]> = [
      ['container.ts', 'the container did not open', "failed('blocked', `container did not open"],
      ['craft-table-window.ts', 'that is not a crafting table', "failed('blocked', `opened"],
      [
        'craft-table-window.ts',
        'the crafting table did not open',
        "failed('blocked', `crafting table did not open",
      ],
      ['sleep.ts', 'it is not night', 'can only sleep at night'],
      ['smelt.ts', 'the furnace did not open', "failed('blocked', `furnace did not open"],
      ['pathing.ts', "return 'the walk failed';", 'return error instanceof Error ? error.message'],
      [
        'pillar.ts',
        'no headroom for a pillar: the dig failed',
        'refusals.push(`no headroom for a pillar: ${errorText',
      ],
    ];
    for (const [file, text, raw] of pinned) {
      const code = source(file);
      expect(code, file).toContain(text);
      expect(code, file).not.toContain(raw);
      if (!text.startsWith('return')) assertFactsOnly(text);
    }
  });
});
