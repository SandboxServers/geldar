import { describe, expect, it } from 'vitest';
import { MAX_RECALL_STACKS, type RecallDeps, type RecallRead, recallTool } from './recall.ts';

const CALL = { playerId: 'pl_jason', lifeId: 'ag_jason_01' };
const AT = { x: 10, y: 64, z: -3 };

/** A recall port that returns the given read for any position. */
function remembered(read: RecallRead): RecallDeps {
  return { remembered: async () => read };
}

describe('recall: what a container held at its last open', () => {
  it('recalls a chest opened just now with its contents and age 0', async () => {
    const result = await recallTool(
      remembered({
        status: 'known',
        age_days: 0,
        contents: [{ item: 'oak_planks', count: 12 }],
      }),
      CALL,
      AT,
    );
    expect(result).toEqual({
      status: 'known',
      age_days: 0,
      contents: [{ item: 'oak_planks', count: 12 }],
    });
  });

  it('recalls the same chest at age 2 after two days', async () => {
    const result = await recallTool(
      remembered({
        status: 'known',
        age_days: 2,
        contents: [{ item: 'oak_planks', count: 12 }],
      }),
      CALL,
      AT,
    );
    expect(result).toEqual({
      status: 'known',
      age_days: 2,
      contents: [{ item: 'oak_planks', count: 12 }],
    });
  });

  it('gives unknown, with no contents, for a container never opened', async () => {
    const result = await recallTool(remembered({ status: 'unknown' }), CALL, AT);
    expect(result).toEqual({ status: 'unknown' });
  });

  it('keeps a furnace slots and progress on the recall', async () => {
    const furnace = {
      input: { item: 'iron_ore', count: 3 },
      fuel: null,
      output: { item: 'iron_ingot', count: 1 },
      progress: 100,
    };
    const result = await recallTool(
      remembered({ status: 'known', age_days: 1, contents: [], furnace }),
      CALL,
      AT,
    );
    expect(result).toEqual({ status: 'known', age_days: 1, contents: [], furnace });
  });

  it('returns at most the contract limit of stacks', async () => {
    const stacks = Array.from({ length: MAX_RECALL_STACKS + 6 }, (_, i) => ({
      item: `item_${i}`,
      count: 1,
    }));
    const result = await recallTool(
      remembered({ status: 'known', age_days: 0, contents: stacks }),
      CALL,
      AT,
    );
    expect(result.status === 'known' && result.contents).toHaveLength(MAX_RECALL_STACKS);
    expect(MAX_RECALL_STACKS).toBe(54);
  });
});
