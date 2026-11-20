import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { awardsFor } from './awards.ts';
import { ExchangeTracker } from './exchange.ts';
import { XP_FIXTURES } from './fixtures.ts';

// The evidence table of AN-50b, as far as AN-50a registers it: the active XP rows give exactly one key
// each, and the inactive kinds (no causal signal, AN-48 deferred) give nothing from either path.

function fixture(name: string): WorldEvent {
  const event = XP_FIXTURES[name];
  if (!event) throw new Error(`no fixture ${name}`);
  return event;
}

/** A copy of a fixture with its payload fields replaced. */
function withPayload(name: string, change: Record<string, unknown>): WorldEvent {
  const event = fixture(name);
  return {
    ...event,
    payload: { ...(event.payload as object), ...change } as WorldEvent['payload'],
  };
}

/** Both paths: the stateless awards and the exchange tracker, fed the same event. */
function bothPaths(event: WorldEvent) {
  return { stateless: awardsFor(event), tracked: new ExchangeTracker().awardsFor(event) };
}

// The building row pays only a completed build intent that carries its program.
const ACTIVE_ROWS: Readonly<Record<string, WorldEvent>> = {
  combat: fixture('kill_uuid_completed'),
  combat_plugin: fixture('combat_fact_kill'),
  mining: fixture('mine_completed'),
  farming: fixture('sow_completed'),
  crafting: fixture('craft_completed'),
  building: withPayload('build_completed', { program: 'build' }),
  social_give: fixture('give_completed'),
  exploring: fixture('chunk_overworld_origin'),
};

describe('active XP rows give exactly one key', () => {
  for (const [row, event] of Object.entries(ACTIVE_ROWS)) {
    it(row, () => {
      const { stateless, tracked } = bothPaths(event);
      expect(stateless).toHaveLength(1);
      expect(tracked).toEqual(stateless);
    });
  }
});

describe('inactive rows give nothing', () => {
  it('a flee is not a combat fact: a combat_fact of a non-combat kind gives []', () => {
    const flee = withPayload('combat_fact_kill', { kind: 'fled' });
    const { stateless, tracked } = bothPaths(flee);
    expect(stateless).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('a flee action gives []', () => {
    const flee = withPayload('give_completed', { kind: 'flee' });
    const { stateless, tracked } = bothPaths(flee);
    expect(stateless).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('an overheard line that is not a reply (one-way, third party) gives no social key', () => {
    const tracker = new ExchangeTracker();
    const line = (agent: string, from: string, own: boolean, tick: number, id: string) =>
      ({
        ...fixture('chunk_overworld_origin'),
        source_event_id: id,
        world_tick: tick,
        agent_id: agent,
        type: 'speech',
        payload: { from, text: 'hello there', distance: own ? null : 2, own },
      }) as WorldEvent;
    // Both in-game names are bound first, by each life's own line, far apart so each opens its own window.
    tracker.awardsFor(line('ag_ben', 'Ben', true, 0, 'ev_own_ben'));
    tracker.awardsFor(line('ag_ann', 'Ann', true, 100_000, 'ev_own_ann'));
    // Ann speaks and Ben overhears, three times: one speaker and no reply is never a social key.
    for (const [tick, id] of [
      [100_001, 'ev_heard_1'],
      [100_002, 'ev_heard_2'],
      [100_003, 'ev_heard_3'],
    ] as const) {
      expect(tracker.awardsFor(line('ag_ben', 'Ann', false, tick, id))).toEqual([]);
    }
  });
});
