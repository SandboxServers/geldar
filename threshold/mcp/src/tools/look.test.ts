import type { Snapshot } from '@geldar/contract';
import { buildSnapshot } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import type { BodyGateway, BudgetLedger, SleepMarks } from '../ports.ts';
import { type LookDeps, lookTool } from './look.ts';

/** Internal identifiers the look output must never carry, at any depth (decision 0095). */
const INTERNAL_KEYS = ['shard', 'snapshot_id', 'body_generation'];
/** A key a later Body might add (an observer or watch flag): the contract does not know it. */
const UNKNOWN_KEY = 'observer_flag';

/** Every object key in a JSON-like value, depth first. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
  }
  return [];
}

/** A Body snapshot that still carries the internal identifiers the Body sends. */
function bodySnapshot(): Snapshot {
  const snapshot = buildSnapshot({
    agentId: 'ag_ranger_01',
    shard: 'phase0',
    revision: 4,
    snapshotN: 1,
    day: 3,
    ticks: 12000,
    timeOfDay: 'dusk',
    position: { x: 10, y: 64, z: -5 },
    health: 18,
    food: 15,
    inventory: [],
    neighbours: [],
    budget: 99,
    daysSinceSleep: 0,
  });
  // The same keys, and one the contract does not know, planted inside self and surroundings too.
  const planted = { ...Object.fromEntries(INTERNAL_KEYS.map((key) => [key, 'x'])), [UNKNOWN_KEY]: 1 };
  Object.assign(snapshot.self, planted);
  Object.assign(snapshot.surroundings, planted);
  return Object.assign(snapshot, {
    shard: 'phase0',
    snapshot_id: 'sn_0000000000000001',
    body_generation: 7,
  });
}

/** Look dependencies over fixed answers: a snapshot, 37.9 credits, and a sleep on day 1. */
function lookDeps(snapshot: Snapshot): LookDeps {
  // Only the methods look calls are faked; the casts stand in for the rest of each port.
  const body = { snapshot: async () => snapshot } as unknown as BodyGateway;
  const budget = { balance: async () => 37.9 } as unknown as BudgetLedger;
  const sleeps = {
    read: async () => ({ lastSleepDay: 1, cursor: 0 }),
    write: async () => undefined,
  } as SleepMarks;
  return { body, budget, sleeps, now: () => 0 };
}

const CALL = { playerId: 'pl_test_01', lifeId: 'lf_test_01' };

describe('lookTool', () => {
  it('returns no shard, snapshot_id or body_generation key at any depth', async () => {
    const result = await lookTool(lookDeps(bodySnapshot()), CALL);
    const keys = keysDeep(result);

    for (const key of [...INTERNAL_KEYS, UNKNOWN_KEY]) {
      expect(keys, key).not.toContain(key);
    }
  });

  it('carries the in-world time: the day and the time of day, as the status tool names them', async () => {
    const result = await lookTool(lookDeps(bodySnapshot()), CALL);

    expect(result.snapshot.world_time).toEqual({
      day: 3,
      time_of_day: 'dusk',
      weather: 'clear',
    });
  });

  it('floors the budget and counts the days since the last sleep', async () => {
    const result = await lookTool(lookDeps(bodySnapshot()), CALL);

    expect(result.snapshot.self.budget_remaining_thoughts).toBe(37);
    expect(result.snapshot.self.days_since_sleep).toBe(2);
  });
});
