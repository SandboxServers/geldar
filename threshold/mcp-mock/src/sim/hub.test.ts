import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../registry.ts';
import { FakeClock } from './clock.ts';
import { SimHub, type SuppressedRecord } from './hub.ts';
import { journalTool, sleepTool } from './lifecycle.ts';
import { parseScenario } from './scenario.ts';
import { waitTool } from './wait.ts';

function ctxFor(playerId: string): ToolContext {
  return { playerId, signal: new AbortController().signal };
}

function setup(onSuppressed?: (r: SuppressedRecord) => void) {
  const scenario = parseScenario(
    JSON.stringify({
      name: 'test',
      day_length_seconds: 24,
      character: { name: 'Kestrel', life_id: 'ag_kestrel_01', position: { x: 0, y: 64, z: 0 } },
      reflex: { hunger_interval_ticks: 10000000, eat_below: 14 },
      wake: { min_spacing_seconds: 0 },
      events: [{ type: 'speech', at_tick: 1000, from: 'Bram', to: null, text: 'chatter' }],
    }),
  );
  const clock = new FakeClock();
  const hub = new SimHub({ scenario, clock, ...(onSuppressed ? { onSuppressed } : {}) });
  return { clock, hub };
}

function record(playerId: string, seq: number): SuppressedRecord {
  return {
    player_id: playerId,
    seq,
    kind: 'speech',
    reason: 'overheard_chatter',
    at_ms: 1,
    tick: 2,
  };
}

describe('SimHub players', () => {
  it('keeps logs, journals, sleep marks and wake times apart per player', async () => {
    const { clock, hub } = setup();
    const a = ctxFor('pa');
    hub.player('pa');
    hub.player('pb');
    await clock.advance(2000);

    journalTool(hub, a, { text: 'only a' });
    expect(hub.life('pa').journal).toBe('only a');
    expect(hub.life('pb').journal).toBe('');

    sleepTool(hub, a);
    expect(hub.life('pa').sleepMark).toBeGreaterThan(0);
    expect(hub.life('pb').sleepMark).toBe(0);

    const w = waitTool(hub, a, { max_seconds: 2 });
    await clock.advance(2000);
    await w;
    expect(hub.player('pa').lastWakeMs).not.toBeNull();
    expect(hub.player('pb').lastWakeMs).toBeNull();

    expect(hub.player('pa').log).not.toBe(hub.player('pb').log);
    hub.recordSuppressed(record('pa', 1));
    expect(hub.suppressed('pa')).toEqual([record('pa', 1)]);
    expect(hub.suppressed('pb')).toEqual([]);
  });

  it('hands the observer exactly the stored record shape', async () => {
    const seen: SuppressedRecord[] = [];
    const { clock, hub } = setup((r) => seen.push(r));
    await clock.advance(2000);
    const w = waitTool(hub, ctxFor('pa'), { max_seconds: 1 });
    await clock.advance(1000);
    await w;
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(Object.keys(r).sort()).toEqual(
        ['at_ms', 'kind', 'player_id', 'reason', 'seq', 'tick'].sort(),
      );
    }
    expect(seen).toEqual(hub.suppressed('pa'));
  });

  it('keeps the last 1000 suppressed records per player', () => {
    const { hub } = setup();
    for (let i = 1; i <= 1005; i++) hub.recordSuppressed(record('pa', i));
    hub.recordSuppressed(record('pb', 1));
    const list = hub.suppressed('pa');
    expect(list).toHaveLength(1000);
    expect(list[0]?.seq).toBe(6);
    expect(list[999]?.seq).toBe(1005);
    expect(hub.suppressed('pb')).toHaveLength(1);
  });
});
