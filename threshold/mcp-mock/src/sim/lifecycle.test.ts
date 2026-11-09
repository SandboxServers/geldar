import { type Intent, validateToolResult } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../registry.ts';
import { FakeClock } from './clock.ts';
import { SimHub } from './hub.ts';
import { journalTool, lookTool, sleepTool, statusTool } from './lifecycle.ts';
import { parseScenario } from './scenario.ts';
import { waitTool } from './wait.ts';

const ctx: ToolContext = { playerId: 'p1', signal: new AbortController().signal };

// Day length 24 s gives 1000 ticks a second.
function setup(over: Record<string, unknown> = {}) {
  const scenario = parseScenario(
    JSON.stringify({
      name: 'test',
      day_length_seconds: 24,
      character: { name: 'Kestrel', life_id: 'ag_kestrel_01', position: { x: 0, y: 64, z: 0 } },
      reflex: { hunger_interval_ticks: 10000000, eat_below: 14 },
      wake: { min_spacing_seconds: 0 },
      ...over,
    }),
  );
  const clock = new FakeClock();
  const hub = new SimHub({ scenario, clock });
  hub.player(ctx.playerId);
  return { clock, hub };
}

function say(at_tick: number, text = 'a line') {
  return { type: 'speech', at_tick, from: 'Bram', to: null, text };
}

const intent = {
  goal: 'walk',
  program: 'travel',
  arguments: { mock_ticks: 100000 },
  wake_on: ['goal_completed'],
  limits: { max_world_ticks: 240000, max_block_operations: 10 },
} as unknown as Intent;

describe('lookTool', () => {
  it('syncs the sim to the clock without a wait and consumes nothing', async () => {
    const { clock, hub } = setup({ events: [{ ...say(900, 'seen'), to: 'Kestrel' }] });
    await clock.advance(1000);
    const a = lookTool(hub, ctx);
    const b = lookTool(hub, ctx);
    expect(a.untrusted_world_text.speech?.map((s) => s.text)).toEqual(['seen']);
    expect(b.untrusted_world_text).toEqual(a.untrusted_world_text);
    expect((a.snapshot.world_time as { ticks: number }).ticks).toBe(1000);
    expect(validateToolResult('look', a).ok).toBe(true);
    // A look before a wait leaves that wait's speech intact.
    const r = await waitTool(hub, ctx, { cursor: 'c_0', max_seconds: 5 });
    expect(r.untrusted_world_text.speech?.map((s) => s.text)).toEqual(['seen']);
  });
});

describe('statusTool and sleepTool', () => {
  it('shows days since sleep, laws only as signs, and resets on sleep', async () => {
    const { clock, hub } = setup({ laws: [{ rule: 'no_theft', value: true }] });
    await clock.advance(30000);
    const before = statusTool(hub, ctx);
    expect(before.days_since_sleep).toBe(1);
    expect(before.untrusted_world_text.signs).toEqual(['no_theft: true']);
    expect(JSON.stringify(before).split('no_theft').length - 1).toBe(1);
    sleepTool(hub, ctx);
    const after = statusTool(hub, ctx);
    expect(after.days_since_sleep).toBe(0);
    expect(validateToolResult('status', after).ok).toBe(true);
  });

  it('keeps the last 8192 journal characters and returns them on sleep', () => {
    const { hub } = setup();
    const parts = ['a'.repeat(3000), 'b'.repeat(3000), 'c'.repeat(3000)];
    for (const text of parts) expect(journalTool(hub, ctx, { text }).ok).toBe(true);
    const expected = parts.join('\n').slice(-8192);
    const r = sleepTool(hub, ctx);
    expect(r.untrusted_world_text.book).toEqual({ title: 'journal', text: expected });
    expect(expected).toHaveLength(8192);
  });

  it('cancels the running intent', () => {
    const { clock, hub } = setup();
    hub.player(ctx.playerId).startIntent(intent, clock.nowMs());
    expect(hub.player(ctx.playerId).intent()).not.toBeNull();
    sleepTool(hub, ctx);
    expect(hub.player(ctx.playerId).intent()).toBeNull();
  });

  it('reports only the events since the previous sleep', async () => {
    const damage = (at_tick: number) => ({ type: 'damage', at_tick, amount: 2 });
    const { clock, hub } = setup({ events: [damage(500), damage(2500)] });
    await clock.advance(1000);
    const first = sleepTool(hub, ctx);
    expect(first.event_counts).toEqual({ damage: 1 });
    await clock.advance(2000);
    const second = sleepTool(hub, ctx);
    expect(second.events.map((e) => e.tick)).toEqual([2500]);
    expect(second.event_counts).toEqual({ damage: 1 });
  });

  it('fits a full day under 16 384 bytes and still validates', async () => {
    const events = [
      ...Array.from({ length: 100 }, (_, i) => ({ type: 'damage', at_tick: i + 1, amount: 1 })),
      ...Array.from({ length: 40 }, (_, i) => say(101 + i, 'y'.repeat(512))),
    ];
    const { clock, hub } = setup({ events });
    journalTool(hub, ctx, { text: 'j'.repeat(4096) });
    journalTool(hub, ctx, { text: 'k'.repeat(4096) });
    await clock.advance(5000);
    const r = sleepTool(hub, ctx);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(16384);
    expect(validateToolResult('sleep', r).ok).toBe(true);
  });
});
