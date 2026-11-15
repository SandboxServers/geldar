import { describe, expect, it } from 'vitest';
import {
  buildMineOncePlan,
  buildSnapshotRequest,
  newMineOnceIds,
  parseAck,
  parseSnapshotReply,
  planResultFor,
} from './life-payload.ts';

const LIFE = 'ag_sheetdrv_01';
const THOUGHT = 'th_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ACTION = 'ac_01ARZ3NDEKTSV4RRFFQ69G5FAW';

/** A Snapshot the contract accepts, for the life above, at world tick 5000 and revision 4. */
function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

const ids = { thoughtId: THOUGHT, actionId: ACTION };

function plan(overrides: { block?: string; count?: number; snap?: Record<string, unknown> } = {}) {
  return buildMineOncePlan({
    lifeId: LIFE,
    snapshot: parseSnapshotReply(JSON.stringify(overrides.snap ?? snapshot())),
    block: overrides.block ?? 'stone',
    count: overrides.count ?? 1,
    ids,
  });
}

describe('buildSnapshotRequest', () => {
  it('builds a snapshot request for a well-formed life', () => {
    expect(buildSnapshotRequest(LIFE, 'sheet-driver0')).toEqual({
      life_id: LIFE,
      reason: 'sheet-driver0',
    });
  });

  it('throws for a life id the contract refuses', () => {
    expect(() => buildSnapshotRequest('sheet_driver', 'sheet-driver0')).toThrow(/refused/);
    expect(() => buildSnapshotRequest(LIFE, '')).toThrow(/refused/);
  });
});

describe('parseSnapshotReply', () => {
  it('reads a valid snapshot', () => {
    expect(parseSnapshotReply(JSON.stringify(snapshot())).revision).toBe(4);
  });

  it('throws on text that is not JSON, and on JSON that is not a snapshot', () => {
    expect(() => parseSnapshotReply('no snapshot for this life')).toThrow(/not JSON/);
    expect(() => parseSnapshotReply('{}')).toThrow(/invalid/);
  });
});

describe('buildMineOncePlan', () => {
  it('builds a plan the contract accepts, bound to the snapshot it came from', () => {
    const built = plan();
    expect(built).toMatchObject({
      thought_id: THOUGHT,
      life_id: LIFE,
      body_generation: 2,
      source_snapshot_id: 'sn_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      snapshot_revision: 4,
      action_ids: [ACTION],
      thought: { actions: [{ do: 'mine', block: 'stone', count: 1 }] },
    });
  });

  it('sets the expiry a fixed number of ticks after the snapshot tick', () => {
    expect(plan().expires_tick).toBe(6200);
  });

  it('takes the block and count it is given', () => {
    expect(plan({ block: 'coal_ore', count: 16 }).thought.actions?.[0]).toEqual({
      do: 'mine',
      block: 'coal_ore',
      count: 16,
    });
  });

  it('refuses a block that is not an item name', () => {
    expect(() => plan({ block: 'Stone' })).toThrow(/refused by the contract/);
  });

  it('refuses a count below 1 or above 256', () => {
    expect(() => plan({ count: 0 })).toThrow(/refused by the contract/);
    expect(() => plan({ count: 257 })).toThrow(/refused by the contract/);
  });

  it('refuses a snapshot that belongs to another life', () => {
    expect(() => plan({ snap: snapshot({ agent_id: 'ag_otherlife_02' }) })).toThrow(/not ag_/);
  });

  it('refuses a snapshot with no body_generation', () => {
    const { body_generation: _omit, ...without } = snapshot();
    expect(() => plan({ snap: without })).toThrow(/body_generation/);
  });
});

describe('newMineOnceIds', () => {
  it('makes a thought id and an action id in the contract shapes', () => {
    const fresh = newMineOnceIds();
    expect(fresh.thoughtId).toMatch(/^th_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(fresh.actionId).toMatch(/^ac_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(fresh.thoughtId).not.toBe(fresh.actionId);
  });
});

describe('parseAck', () => {
  it('reads an accepted ack for the thought', () => {
    const text = JSON.stringify({ thought_id: THOUGHT, accepted: true, rejection: null });
    expect(parseAck(text, THOUGHT)).toEqual({ accepted: true, rejection: null });
  });

  it('reads a refused ack with its reason', () => {
    const text = JSON.stringify({
      thought_id: THOUGHT,
      accepted: false,
      rejection: { reason: 'stale_snapshot', detail: 'revision moved on' },
    });
    expect(parseAck(text, THOUGHT).rejection).toEqual({
      reason: 'stale_snapshot',
      detail: 'revision moved on',
    });
  });

  it('throws on an ack for another thought, and on text that is not JSON', () => {
    const otherThought = 'th_01ARZ3NDEKTSV4RRFFQ69G5FAX';
    const other = JSON.stringify({ thought_id: otherThought, accepted: true, rejection: null });
    expect(() => parseAck(other, THOUGHT)).toThrow(/another thought/);
    expect(() => parseAck('busy', THOUGHT)).toThrow(/not JSON/);
  });
});

describe('planResultFor', () => {
  const result = (thought: string) =>
    JSON.stringify({
      type: 'plan_result',
      agent_id: LIFE,
      payload: { thought_id: thought, intent: null, failed_at: null, actions: [], said: false },
    });

  it('returns the payload of the plan_result for this thought', () => {
    expect(planResultFor(result(THOUGHT), THOUGHT)).toMatchObject({ thought_id: THOUGHT });
  });

  it('gives null for another thought, another event type, or text that is not JSON', () => {
    expect(planResultFor(result(ACTION), THOUGHT)).toBeNull();
    const other = JSON.stringify({ type: 'action', payload: { thought_id: THOUGHT } });
    expect(planResultFor(other, THOUGHT)).toBeNull();
    expect(planResultFor('not json', THOUGHT)).toBeNull();
    expect(planResultFor('null', THOUGHT)).toBeNull();
  });
});
