import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connectNats: vi.fn() }));
vi.mock('@geldar/contract/nats', () => ({ connectNats: mocks.connectNats }));

import { main } from './life-cli.ts';

const LIFE = 'ag_sheetdrv_01';
const SCRATCH_ENV = {
  SHEET_SHARD: 'scratch-sheet0',
  SHEET_PROJECT: 'scratch-sheet0',
  SHEET_RESULT_TIMEOUT_MS: '1000',
};
const MINE_ARGV = ['mine-once', LIFE, 'stone', '1'];

/** A Snapshot the contract accepts, for the life above, at world tick 5000 and revision 4. */
const SNAPSHOT = {
  snapshot_id: 'sn_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  agent_id: LIFE,
  shard: 'scratch-sheet0',
  revision: 4,
  body_generation: 2,
  world_time: { day: 1, time_of_day: 'day', ticks: 5000, weather: 'clear' },
  self: {
    position: { x: 0, y: 64, z: 0 },
    health: 20,
    hunger: 20,
    armor: 0,
    held_item: null,
    inventory: [],
    effects: [],
    budget_remaining_thoughts: 0,
    days_since_sleep: 0,
  },
  surroundings: { blocks_summary: 'stone', notable_blocks: [], entities: [], agents: [] },
  heard: [],
  events_since_last_thought: [],
};

function reply(text: string) {
  return { string: () => text };
}

/**
 * A fake NATS connection. The snapshot request gets SNAPSHOT. The plan request is read for its thought id and
 * answered with `ack(thoughtId)`. The plan_result subscription yields nothing, so the wait ends at once with null.
 */
function fakeNc(ack: (thoughtId: string) => unknown) {
  const sub = {
    unsubscribe: vi.fn(),
    async *[Symbol.asyncIterator]() {},
  };
  return {
    request: vi.fn(async (subject: string, body: string) => {
      if (subject.endsWith('.snapshot')) return reply(JSON.stringify(SNAPSHOT));
      const plan = JSON.parse(body) as { thought_id: string };
      return reply(JSON.stringify(ack(plan.thought_id)));
    }),
    subscribe: vi.fn(() => sub),
    drain: vi.fn(async () => {}),
  };
}

describe('life-cli main', () => {
  beforeEach(() => {
    mocks.connectNats.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses an unguarded shard with 1 and never connects', async () => {
    const code = await main(MINE_ARGV, { SHEET_SHARD: 'colo', SHEET_PROJECT: 'colo' });
    expect(code).toBe(1);
    expect(mocks.connectNats).not.toHaveBeenCalled();
  });

  it('exits 1 when the Body rejects the plan in its ack', async () => {
    const nc = fakeNc((thoughtId) => ({
      thought_id: thoughtId,
      accepted: false,
      rejection: { reason: 'stale_snapshot', detail: 'revision moved' },
    }));
    mocks.connectNats.mockResolvedValue(nc);
    expect(await main(MINE_ARGV, SCRATCH_ENV)).toBe(1);
    expect(nc.drain).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when no plan_result arrives for an accepted plan', async () => {
    const nc = fakeNc((thoughtId) => ({ thought_id: thoughtId, accepted: true, rejection: null }));
    mocks.connectNats.mockResolvedValue(nc);
    expect(await main(MINE_ARGV, SCRATCH_ENV)).toBe(1);
    expect(nc.drain).toHaveBeenCalledTimes(1);
  });

  it('exits 2 for a result timeout that is not a whole number of ms of 1000 or more', async () => {
    for (const bad of ['abc', '999', '1.5', '']) {
      const code = await main(MINE_ARGV, { ...SCRATCH_ENV, SHEET_RESULT_TIMEOUT_MS: bad });
      expect(code).toBe(2);
    }
    expect(mocks.connectNats).not.toHaveBeenCalled();
  });
});
