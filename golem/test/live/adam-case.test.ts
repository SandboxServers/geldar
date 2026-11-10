import { describe, expect, it } from 'vitest';
import {
  type AdamCaseKind,
  caseSetup,
  caseTime,
  checkCaseInventory,
  inventoryItems,
  planEvidence,
} from './adam-case.ts';
import { type ActionRow, ADAM_LIFE_ID, type IntentRow, type ThoughtRow } from './adam-stack.ts';

const KINDS: AdamCaseKind[] = ['smoke', 'chatter', 'restart', 'sleep'];

function thought(id: string, valid: boolean): ThoughtRow {
  return {
    thought_id: id,
    wake_reason: 'chatter',
    at: '2026-11-09T10:00:00.000Z',
    latency_ms: 800,
    valid,
    has_output: true,
    body_generation: 1,
    model_input: null,
  };
}

function intent(id: string, thoughtId: string | null, state = 'accepted'): IntentRow {
  return {
    intent_id: id,
    thought_id: thoughtId,
    body_generation: 1,
    state,
    program: 'travel',
    goal: null,
  };
}

function action(id: string, intentId: string | null, state: string): ActionRow {
  return { action_id: id, intent_id: intentId, body_generation: 1, state, kind: 'goto' };
}

const CENTER = { x: 100, y: 200, z: -50 };

describe('the case setup', () => {
  it('starts only the sleep case at night, with a bed in the inventory', () => {
    expect(caseTime('sleep')).toBe('night');
    expect(caseSetup('sleep', CENTER)).toContain(`give ${ADAM_LIFE_ID} white_bed 1`);
    for (const kind of KINDS.filter((k) => k !== 'sleep')) {
      expect(caseTime(kind)).toBe('day');
      expect(caseSetup(kind, CENTER).some((c) => c.includes('white_bed'))).toBe(false);
      expect(caseSetup(kind, CENTER).some((c) => c.includes('time set night'))).toBe(false);
    }
  });

  it('kills the arena drops before Adam walks in, and empties his inventory after he is there', () => {
    for (const kind of KINDS) {
      const commands = caseSetup(kind, CENTER);
      expect(commands[0]).toBe('kill @e[type=item,x=100,y=200,z=-50,distance=..40]');
      expect(commands[1]).toBe(`tp ${ADAM_LIFE_ID} 101 201 -49`);
      expect(commands).toContain(`time set ${caseTime(kind)}`);
      // The clear runs after the move, so a pickup the move could cause is cleared, not kept.
      expect(commands.indexOf(`clear ${ADAM_LIFE_ID}`)).toBeGreaterThan(1);
    }
  });
});

describe('the case inventory check', () => {
  const EMPTY = `${ADAM_LIFE_ID} has the following entity data: []`;
  const BED = `${ADAM_LIFE_ID} has the following entity data: [{Slot:0b,id:"minecraft:white_bed",count:1}]`;
  const LOG = `${ADAM_LIFE_ID} has the following entity data: [{Slot:0b,id: "minecraft:oak_log",count:3}]`;

  it('reads the item ids out of the NBT reply', () => {
    expect(inventoryItems(BED)).toEqual(['white_bed']);
    expect(inventoryItems(LOG)).toEqual(['oak_log']);
    expect(inventoryItems(EMPTY)).toEqual([]);
  });

  it('accepts an empty inventory for every case but sleep, which holds exactly one bed', () => {
    for (const kind of KINDS.filter((k) => k !== 'sleep')) {
      expect(() => checkCaseInventory(kind, EMPTY)).not.toThrow();
    }
    expect(() => checkCaseInventory('sleep', BED)).not.toThrow();
  });

  it('fails with what Adam holds when the setup left something behind', () => {
    expect(() => checkCaseInventory('smoke', BED)).toThrow(
      /holds \[white_bed\], expected \[nothing\]/,
    );
    expect(() => checkCaseInventory('sleep', EMPTY)).toThrow(
      /holds \[nothing\], expected \[white_bed\]/,
    );
    expect(() => checkCaseInventory('sleep', LOG)).toThrow(/before the Mind started/);
  });

  it('fails when the reply is not an inventory at all', () => {
    expect(() => checkCaseInventory('smoke', 'No entity was found')).toThrow(
      /could not read ag_adam_02's inventory: No entity was found/,
    );
  });
});

describe('planEvidence', () => {
  const good = thought('t_good', true);
  const bad = thought('t_bad', false);

  it('is null until an intent of a valid thought or a completed action appears', () => {
    expect(planEvidence([good], [], [])).toBeNull();
    expect(planEvidence([bad], [intent('i1', 't_bad')], [])).toBeNull();
    expect(planEvidence([good], [intent('i1', null)], [])).toBeNull();
    expect(planEvidence([good], [], [action('a1', 'i1', 'running')])).toBeNull();
  });

  it('accepts an intent made from a valid thought, whatever its state', () => {
    expect(planEvidence([good], [intent('i1', 't_good', 'failed')], [])).toEqual({
      via: 'intent',
      id: 't_good',
      state: 'failed',
    });
  });

  it('accepts a completed action when the case has a valid thought and no intent', () => {
    const actions = [action('a1', 'i1', 'running'), action('a2', 'i1', 'completed')];
    expect(planEvidence([good], [], actions)).toEqual({
      via: 'action',
      id: 'a2',
      state: 'completed',
    });
  });

  it('does not accept actions without a valid thought', () => {
    expect(planEvidence([bad], [], [action('a1', 'i1', 'completed')])).toBeNull();
  });
});
