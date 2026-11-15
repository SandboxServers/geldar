import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markedWords } from '../src/agent-text.ts';
import { validateThought } from '../src/index.ts';
import { outcomeMessage, playerOutcomeText } from '../src/outcome-words.ts';

/** A use of the held item on a block, the shape the Body receives. */
const USE_BLOCK = { do: 'use', item: 'oak_boat', at: { x: 12, y: 62, z: -7 } };

/** A use of the held item on an entity, named as the perception snapshot lists it. */
const USE_ENTITY = { do: 'use', item: 'wheat', entity: 'cow:123' };

/** A thought with one action and no intent or say. */
function oneAction(action: unknown): unknown {
  return { reasoning: 'Put the boat on the lake.', actions: [action] };
}

/** Read a file of this repository from the contract package. */
function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('use action schema', () => {
  it.each([
    ['the empty hand in the air', { do: 'use' }],
    ['a held item on a block', USE_BLOCK],
    ['a held item on an entity', USE_ENTITY],
    ['an item in the air with no target', { do: 'use', item: 'fishing_rod' }],
    ['a block with no item equipped', { do: 'use', at: { x: 3, y: 64, z: 8 } }],
  ])('accepts a use of %s', (_label, action) => {
    expect(validateThought(oneAction(action)).ok).toBe(true);
  });

  it('leaves the at and entity pair to the Body, so the schema accepts both', () => {
    const both = { do: 'use', at: { x: 3, y: 64, z: 8 }, entity: 'cow:123' };
    expect(validateThought(oneAction(both)).ok).toBe(true);
  });

  it.each([
    ['the feet keyword as a position', { do: 'use', at: 'feet' }],
    ['a partial position', { do: 'use', at: { x: 3, y: 64 } }],
    ['an entity name with a space', { do: 'use', entity: 'cow 123' }],
    ['an entity of 65 characters', { do: 'use', entity: 'x'.repeat(65) }],
    ['an item name in capitals', { do: 'use', item: 'Oak Boat' }],
    ['a face field', { do: 'use', at: { x: 3, y: 64, z: 8 }, face: 'up' }],
    ['a count field', { do: 'use', item: 'wheat', count: 2 }],
    ['a hand field', { do: 'use', hand: 'off' }],
    ['the target key of an attack', { do: 'use', target: 'cow' }],
  ])('rejects a use with %s', (_label, action) => {
    expect(validateThought(oneAction(action)).ok).toBe(false);
  });

  it('rejects mount, which is a later packet of decision 0218', () => {
    expect(validateThought(oneAction({ do: 'mount', entity: 'oak_boat:456' })).ok).toBe(false);
  });
});

describe('use outcome wording', () => {
  it('names the use when it worked', () => {
    expect(outcomeMessage('use', true)).toBe('Your use worked.');
  });

  it.each([
    ['invalid_args', 'Your use failed: use takes a block or an entity, not both.'],
    ['not_possible', 'Your use failed: that cannot be used that way.'],
    ['missing_materials', 'Your use failed: you lack the item to use.'],
    ['not_found', 'Your use failed: there was nothing to use it on.'],
  ])('words a failed use with %s in its own plain phrase', (reason, text) => {
    expect(outcomeMessage('use', false, reason)).toBe(text);
  });

  it('keeps the shared phrase for a reason the use wording does not list', () => {
    expect(outcomeMessage('use', false, 'timeout')).toBe('Your use failed: it took too long.');
  });

  it('keeps the shared phrase for other verbs with the same reason', () => {
    expect(outcomeMessage('till', false, 'not_possible')).toBe(
      'Your till failed: that was not possible right now.',
    );
  });

  it.each([
    'invalid_args',
    'not_possible',
    'missing_materials',
    'not_found',
    'out_of_reach',
    'no_effect',
    'blocked',
  ])('reads a use failure for %s in plain words with no marker word', (reason) => {
    const text = playerOutcomeText({ verb: 'use', ok: false, reason });
    expect(text.startsWith('Your use failed: ')).toBe(true);
    expect(markedWords(text)).toEqual([]);
  });
});

describe('use in the MCP act description and the body-api prompt', () => {
  it('lists use among the verbs of the act tool', () => {
    expect(readRepoFile('contract/schemas/mcp-play.schema.json')).toContain(
      'till, edit_sign, use.',
    );
  });

  it('adds a v9 prompt with one use entry, and leaves released v8 without it', () => {
    const v9 = JSON.parse(readRepoFile('prompts/body-api/v9.json'));
    expect(v9.version).toBe(9);
    const entry = v9.verbs.find((v: { do: string }) => v.do === 'use');
    expect(entry).toBeDefined();
    expect(validateThought(oneAction(entry.example)).ok).toBe(true);
    const v8 = readRepoFile('prompts/body-api/v8.json');
    expect(v8).not.toContain('"do": "use"');
  });

  it('keeps the use entry of v9 within the token margin (about 50 tokens, 200 characters)', () => {
    const v9 = JSON.parse(readRepoFile('prompts/body-api/v9.json'));
    const entry = v9.verbs.find((v: { do: string }) => v.do === 'use');
    expect(JSON.stringify(entry).length).toBeLessThanOrEqual(200);
  });
});
