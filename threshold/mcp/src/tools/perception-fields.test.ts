import { type Snapshot, validateToolResult } from '@geldar/contract';
import { buildSnapshot } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import type { BodyGateway, BudgetLedger, SleepMarks } from '../ports.ts';
import { type LookDeps, lookTool } from './look.ts';

const CALL = { playerId: 'pl_test_01', lifeId: 'lf_test_01' };

/** A hostile creeper in sight, with every PX entity field the Body can send. */
const CREEPER = {
  type: 'creeper',
  distance: 4,
  direction: 'north',
  x: 120,
  y: 64,
  z: -49,
  hostile: true,
  state: 'closing',
  closing: true,
  held_item: 'bow',
  fuse: 'hissing',
};

/**
 * The largest realistic Body reply: every optional PX field on self and surroundings, a lit furnace,
 * a sign with text, and the hostile creeper. Built the way the Body sends it, identifiers included.
 */
function fullBodySnapshot(): Snapshot {
  const base = buildSnapshot({
    agentId: 'ag_ranger_01',
    shard: 'phase0',
    revision: 4,
    snapshotN: 1,
    day: 3,
    ticks: 12000,
    timeOfDay: 'dusk',
    position: { x: 120, y: 64, z: -45 },
    health: 18,
    food: 15,
    inventory: [],
    neighbours: [],
    budget: 99,
    daysSinceSleep: 0,
  });
  return {
    ...base,
    shard: 'phase0',
    snapshot_id: 'sn_0000000000000001',
    body_generation: 7,
    self: {
      ...base.self,
      ground_below: 3,
      trapped: 'perched',
      sun: 'afternoon',
      light: 'dim',
      health_trend: 'falling',
      regen_hint:
        'Health does not regenerate naturally while hunger is low. Hunger falls over time.',
      air: 12,
      status_flags: ['burning', 'on_ground'],
      unlocked_recipes: ['oak_planks'],
    },
    surroundings: {
      ...base.surroundings,
      standing_on: 'grass_block',
      block_above_feet: 'air',
      enclosed: false,
      blocks_counted_in_sight: true,
      hazards: [{ kind: 'lava', dir: 'w', dist: 5 }],
      notable_blocks: [
        { type: 'furnace', x: 123, y: 64, z: -45, lit: true },
        { type: 'oak_sign', x: 118, y: 65, z: -40, text: 'SIGN-HOSTILE' },
      ],
      entities: [CREEPER, { type: 'cow', distance: 9, direction: 'south', x: 120, y: 64, z: -36 }],
      agents: [],
    },
  } as unknown as Snapshot;
}

/** Look dependencies over one fixed Body snapshot, 37.9 credits and a sleep on day 1. */
function lookDeps(snapshot: Snapshot): LookDeps {
  const body = { snapshot: async () => snapshot } as unknown as BodyGateway;
  const budget = { balance: async () => 37.9 } as unknown as BudgetLedger;
  const sleeps = {
    read: async () => ({ lastSleepDay: 1, cursor: 0 }),
    write: async () => undefined,
  } as SleepMarks;
  return { body, budget, sleeps, now: () => 0 };
}

describe('look with the PX perception fields', () => {
  it('a full Body snapshot passes the look result validator with no invalid_output', async () => {
    const result = await lookTool(lookDeps(fullBodySnapshot()), CALL);
    const check = validateToolResult('look', result);
    expect(check.ok ? [] : check.errors).toEqual([]);
  });

  it('keeps the hostile creeper fields and the lit furnace in the look result', async () => {
    const result = await lookTool(lookDeps(fullBodySnapshot()), CALL);
    const [creeper] = result.snapshot.surroundings.entities ?? [];
    expect(creeper).toMatchObject({
      type: 'creeper',
      hostile: true,
      state: 'closing',
      closing: true,
      held_item: 'bow',
      fuse: 'hissing',
    });
    expect(result.snapshot.surroundings.notable_blocks[0]).toMatchObject({
      type: 'furnace',
      lit: true,
    });
  });

  it('shows light, health trend, the regeneration hint and a situation line', async () => {
    const result = await lookTool(lookDeps(fullBodySnapshot()), CALL);
    expect(result.snapshot.self).toMatchObject({ light: 'dim', health_trend: 'falling' });
    expect(result.snapshot.self.regen_hint).toContain('does not regenerate');
    expect(result.situation).toBe(
      'Afternoon sun; dim here; not enclosed; closing: creeper north; health falling; hunger 15.',
    );
  });

  it('keeps sign text out of the snapshot; it goes to untrusted_world_text only', async () => {
    const result = await lookTool(lookDeps(fullBodySnapshot()), CALL);
    expect(JSON.stringify(result.snapshot)).not.toContain('SIGN-HOSTILE');
    expect(JSON.stringify(result.untrusted_world_text)).toContain('SIGN-HOSTILE');
  });
});
