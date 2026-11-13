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
    expect(outcomeDetailText('goto', 'interrupted', 'x')).toBeUndefined();
    expect(outcomeDetailText('mine', 'busy', 'x')).toBeUndefined();
    expect(outcomeDetailText('craft', undefined, 'x')).toBeUndefined();
  });

  it.each([
    ['place', 'blocked', 'target is occupied'],
    ['place', 'blocked', 'no solid block to place against'],
    ['place', 'blocked', 'the target is out of reach'],
    ['place', 'blocked', 'another entity stands where the block goes'],
    ['place', 'blocked', 'no free space next to you'],
    ['place', 'blocked', 'the server did not place the block: refused'],
    ['give', 'not_found', 'the items are on the ground near Ada'],
    ['mine', 'not_found', 'no stone within 32 blocks'],
  ])('a %s failure (%s) keeps its Body detail: %s', (verb, reason, text) => {
    expect(outcomeDetailText(verb, reason, text)).toBe(text);
  });

  it.each(['goto', 'unstick', 'mine', 'craft'])(
    'a timeout on %s keeps its path-search detail',
    (verb) => {
      expect(outcomeDetailText(verb, 'timeout', 'the path search ran out of time')).toBe(
        'the path search ran out of time',
      );
    },
  );

  it('a blocked or not_found detail obeys the sanitiser, marker and coordinate rules', () => {
    expect(outcomeDetailText('place', 'blocked', 'the observer is in the way')).toBeUndefined();
    expect(outcomeDetailText('place', 'blocked', 'blocked at 120, 64, -33')).toBeUndefined();
    expect(outcomeDetailText('mine', 'not_found', 'the ore is near <x>')).toBeUndefined();
    expect(outcomeDetailText('goto', 'timeout', 'path lost at 12 64 9')).toBeUndefined();
    expect(outcomeDetailText('place', 'blocked', 'a'.repeat(200))?.length).toBe(160);
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
