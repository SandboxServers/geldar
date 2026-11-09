import { describe, expect, it } from 'vitest';
import { validateThought } from '../src/index.ts';

/** The Appendix C intent, with a valid skill-style program name. */
const intent = {
  goal: 'maintain_food_supply',
  program: 'harvest_and_replant_v3',
  arguments: {},
  preconditions: ['field_is_known', 'seeds_available'],
  wake_on: ['directly_addressed', 'precondition_failed', 'unexpected_damage', 'goal_completed'],
  limits: { max_world_ticks: 12000, max_block_operations: 180 },
};

/** A blueprint with a few blocks, standing in for the `[ ... ]` in Appendix C. */
const blueprint = {
  name: 'shelter_2x2',
  blocks: [
    { block: 'oak_planks', dx: 0, dy: 0, dz: 0 },
    { block: 'oak_planks', dx: 1, dy: 0, dz: 0 },
    { block: 'oak_planks', dx: 0, dy: 0, dz: 1 },
    { block: 'oak_planks', dx: 1, dy: 0, dz: 1 },
  ],
};

/** Every Appendix C action, each returned as its own one-action thought. */
const appendixActions: Record<string, unknown>[] = [
  { do: 'goto', target: { x: 0, y: 0, z: 0 } },
  { do: 'goto', target: 'Pike' },
  { do: 'mine', block: 'oak_log', count: 10 },
  { do: 'craft', item: 'stone_pickaxe', count: 1 },
  { do: 'place', block: 'torch', at: 'feet' },
  { do: 'build', blueprint },
  { do: 'attack', target: 'zombie' },
  { do: 'eat' },
  { do: 'sleep' },
  { do: 'give', to: 'Pike', item: 'bread', count: 2 },
  { do: 'write_sign', text: 'KESTREL FIELD' },
  { do: 'write_book', title: 'Field notes', skill_id: 'sk_farm_01' },
  { do: 'write_book', title: 'Field notes', text: 'Wheat grows on the south slope.' },
  { do: 'read_book' },
  { do: 'use_skill', name: 'buildWheatFarm', args: {} },
  {
    do: 'define_skill',
    name: 'harvestWheat',
    description: 'Harvests ripe wheat.',
    code: 'return 1;',
  },
  { do: 'offer', item: 'iron_ingot', count: 3 },
  {
    do: 'propose',
    rule: 'gamerule.pvp',
    value: false,
    reason: 'Fewer deaths on the shared field.',
  },
  { do: 'vote', proposal_id: 'pr_01HZX3V9Q4M2K8R7T6Y5W4E3D2', vote: 'yes' },
  { do: 'note', text: 'The chest by the bed is shared.' },
  { do: 'wait', seconds: 30 },
  { do: 'open', at: { x: 123, y: 64, z: -45 } },
  { do: 'deposit', at: { x: 123, y: 64, z: -45 }, item: 'wheat', count: 12 },
  { do: 'withdraw', at: { x: 123, y: 64, z: -45 }, item: 'wheat', count: 4 },
];

/** A thought with the given actions and no intent or say, for brevity in the failure tests. */
function withActions(actions: unknown[]): unknown {
  return { reasoning: 'Gather food first.', actions };
}

describe('validateThought', () => {
  it('accepts an intent with a say and no actions', () => {
    const result = validateThought({
      reasoning: 'The field needs seed.',
      say: 'Pike, seeds?',
      intent,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a say alone', () => {
    const result = validateThought({ reasoning: 'Greeting.', say: 'Hello.' });
    expect(result.ok).toBe(true);
  });

  it('accepts an intent alone with null say', () => {
    const result = validateThought({ reasoning: 'Plan.', say: null, intent });
    expect(result.ok).toBe(true);
  });

  it('accepts six actions, the maximum', () => {
    const result = validateThought(withActions(appendixActions.slice(0, 6)));
    expect(result.ok).toBe(true);
  });

  it.each(appendixActions.map((action) => [action.do, action]))(
    'accepts the Appendix C %s action as a one-action thought',
    (_verb, action) => {
      const result = validateThought(withActions([action]));
      expect(result.ok).toBe(true);
    },
  );

  it('rejects seven actions', () => {
    const result = validateThought(withActions(appendixActions.slice(0, 7)));
    expect(result.ok).toBe(false);
  });

  it('rejects an empty object', () => {
    const result = validateThought({});
    expect(result.ok).toBe(false);
  });

  it('rejects reasoning with neither intent, actions nor a say', () => {
    const result = validateThought({ reasoning: 'Thinking.' });
    expect(result.ok).toBe(false);
  });

  it('rejects a null say on its own', () => {
    const result = validateThought({ reasoning: 'Quiet.', say: null });
    expect(result.ok).toBe(false);
  });

  it('rejects a mine action with count 0', () => {
    const result = validateThought(withActions([{ do: 'mine', block: 'oak_log', count: 0 }]));
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown verb', () => {
    const result = validateThought(withActions([{ do: 'fly' }]));
    expect(result.ok).toBe(false);
  });

  it('rejects an eat action with an extra field', () => {
    const result = validateThought(withActions([{ do: 'eat', item: 'bread' }]));
    expect(result.ok).toBe(false);
  });

  it('rejects an intent whose program is not a name', () => {
    const result = validateThought({
      reasoning: 'Plan.',
      intent: { ...intent, program: 'Travel!' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a write_book with both skill_id and text', () => {
    const result = validateThought(
      withActions([{ do: 'write_book', title: 'Both', skill_id: 'sk_farm_01', text: 'Text.' }]),
    );
    expect(result.ok).toBe(false);
  });
});
