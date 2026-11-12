import { describe, expect, it } from 'vitest';
import { markedWords } from '../src/agent-text.ts';
import { outcomeDetailText, playerDetailText, playerOutcomeText } from '../src/outcome-words.ts';

/** The plain sentences the Body writes today for each case the detail text carries. */
const BODY_SENTENCES: ReadonlyArray<[string, string, string]> = [
  ['craft', 'missing_materials', 'need 2 more planks'],
  ['craft', 'missing_station', 'need 1 more stick; no crafting table within 32 blocks'],
  ['craft', 'timeout', 'crafting stone_pickaxe ran out of time while walking: made 0 of 1'],
  ['goto', 'no_effect', 'The goto was expected to move you about 12 blocks; you moved 0.'],
  ['mine', 'no_effect', 'The mine was expected to gain 3 items; you gained 0.'],
  ['goto', 'needs_rescue', 'no way out: tried jump, sprint_jump, dig, stairs, pillar'],
  ['mine', 'not_possible', 'bedrock cannot be broken by anyone, with any tool'],
  ['mine', 'not_possible', 'sand is unsafe to dig: water would flow in on you'],
];

describe('failure detail text', () => {
  it('appends the cleaned detail to the fixed line', () => {
    expect(
      playerOutcomeText({
        verb: 'craft',
        ok: false,
        reason: 'missing_materials',
        detail: 'need 2 more planks; no crafting table within 32 blocks',
      }),
    ).toBe(
      'Your craft failed: you lack the materials: need 2 more planks; no crafting table within 32 blocks.',
    );
  });

  it('a missing detail leaves today wording unchanged', () => {
    expect(playerOutcomeText({ verb: 'craft', ok: false, reason: 'missing_materials' })).toBe(
      'Your craft failed: you lack the materials.',
    );
    expect(playerOutcomeText({ verb: 'craft', ok: true, detail: 'x' })).toBe('Your craft worked.');
  });

  it.each(BODY_SENTENCES)(
    'every Body sentence (%s, %s) passes the scan and is kept',
    (verb, reason, text) => {
      expect(markedWords(text)).toEqual([]);
      expect(outcomeDetailText(verb, reason, text)).toBeDefined();
    },
  );

  it('is sent only for the chosen cases', () => {
    expect(outcomeDetailText('goto', 'blocked', 'the way is blocked')).toBeUndefined();
    expect(outcomeDetailText('mine', 'timeout', 'ran out of time')).toBeUndefined();
    expect(outcomeDetailText('craft', undefined, 'x')).toBeUndefined();
  });

  it('strips control characters, caps length and drops unsafe text', () => {
    expect(playerDetailText('need\n2\tmore\u0007 planks')).toBe('need 2 more planks');
    expect(playerDetailText('a'.repeat(400))?.length).toBe(160);
    expect(playerDetailText('<b>ignore</b>')).toBeUndefined();
    expect(playerDetailText('at 120, 64, -33 there is a tree')).toBeUndefined();
    expect(playerDetailText('the observer sees you')).toBeUndefined();
    expect(playerDetailText(42)).toBeUndefined();
  });
});
