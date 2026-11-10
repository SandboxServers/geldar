import { validateThought } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { thoughtDecodeSchema } from '../prompts/decode-schema.ts';
import { ACTION_FIELDS } from './action-shapes.ts';
import { PHASE0_VERBS } from './index.ts';

const POS = { x: 1, y: 64, z: 1 };
/** One contract-valid action per verb, with every field the table lists. */
const EXAMPLES: Record<string, Record<string, unknown>> = {
  goto: { do: 'goto', target: POS },
  mine: { do: 'mine', block: 'stone', count: 4 },
  craft: { do: 'craft', item: 'stick', count: 1 },
  place: { do: 'place', block: 'white_bed', at: 'feet' },
  eat: { do: 'eat' },
  sleep: { do: 'sleep' },
  open: { do: 'open', at: POS },
  deposit: { do: 'deposit', at: POS, item: 'stone', count: 1 },
  withdraw: { do: 'withdraw', at: POS, item: 'stone', count: 1 },
  attack: { do: 'attack', target: 'Adam' },
  wait: { do: 'wait', seconds: 5 },
};

function accepts(action: Record<string, unknown>): boolean {
  return validateThought({ reasoning: 'r', actions: [action] }).ok;
}

describe('the action table matches the contract', () => {
  it('has the Phase 0 verbs and one example for each', () => {
    expect(Object.keys(ACTION_FIELDS).sort()).toEqual([...PHASE0_VERBS].sort());
    expect(Object.keys(EXAMPLES).sort()).toEqual([...PHASE0_VERBS].sort());
  });

  it('accepts each example and rejects it without any one field or with an extra field', () => {
    for (const [verb, example] of Object.entries(EXAMPLES)) {
      expect(accepts(example), verb).toBe(true);
      for (const field of ACTION_FIELDS[verb] ?? []) {
        if (field === 'do') continue;
        const { [field]: _dropped, ...rest } = example;
        expect(accepts(rest), `${verb} without ${field}`).toBe(false);
      }
      expect(accepts({ ...example, extra: 1 }), `${verb} with extra`).toBe(false);
    }
  });

  it('gives the decode schema one variant per verb with the same required fields', () => {
    const schema = thoughtDecodeSchema() as {
      properties: {
        actions: {
          items: { oneOf: { properties: { do: { const: string } }; required: string[] }[] };
        };
      };
    };
    for (const variant of schema.properties.actions.items.oneOf) {
      const verb = variant.properties.do.const;
      expect(variant.required, verb).toEqual(ACTION_FIELDS[verb]);
    }
  });
});
