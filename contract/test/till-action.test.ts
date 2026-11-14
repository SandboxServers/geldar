import { describe, expect, it } from 'vitest';
import { markedWords } from '../src/agent-text.ts';
import { validateThought } from '../src/index.ts';
import { outcomeMessage, playerOutcomeText } from '../src/outcome-words.ts';

/** A till at a block position, the shape the Body receives for a hoe on dirt. */
const TILL = { do: 'till', at: { x: 12, y: 64, z: -7 } };

/** A thought with one action and no intent or say. */
function oneAction(action: unknown): unknown {
  return { reasoning: 'Farm the plot.', actions: [action] };
}

describe('till action schema', () => {
  it('accepts a till at a block position', () => {
    expect(validateThought(oneAction(TILL)).ok).toBe(true);
  });

  it('accepts a till alongside other actions in one thought', () => {
    const result = validateThought({
      reasoning: 'Plant the field.',
      actions: [TILL, { do: 'place', block: 'wheat_seeds', at: { x: 12, y: 65, z: -7 } }],
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['no position', { do: 'till' }],
    ['the feet keyword', { do: 'till', at: 'feet' }],
    ['a block name in place of a position', { do: 'till', at: 'dirt' }],
    ['a partial position', { do: 'till', at: { x: 12, y: 64 } }],
    ['a stray count', { ...TILL, count: 1 }],
    ['a stray block', { ...TILL, block: 'dirt' }],
  ])('rejects a till with %s', (_label, action) => {
    expect(validateThought(oneAction(action)).ok).toBe(false);
  });
});

describe('till outcome wording', () => {
  it('names the till when it worked', () => {
    expect(outcomeMessage('till', true)).toBe('Your till worked.');
  });

  it.each([
    'missing_materials',
    'blocked',
    'not_possible',
    'out_of_reach',
    'not_found',
    'no_effect',
  ])('reads a %s failure in plain words with no marker word', (reason) => {
    const text = playerOutcomeText({ verb: 'till', ok: false, reason });
    expect(text.startsWith('Your till failed: ')).toBe(true);
    expect(markedWords(text)).toEqual([]);
  });
});
