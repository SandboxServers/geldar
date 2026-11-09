import { type Intent, validateToolInput, validateToolResult } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../registry.ts';
import { FakeClock } from './clock.ts';
import { SimHub } from './hub.ts';
import { parseScenario } from './scenario.ts';
import { waitTool } from './wait.ts';

const PLAYER = 'p1';

// Day length 24 s gives 1000 ticks a second unless a case says otherwise.
function setup(over: Record<string, unknown> = {}, dayLength = 24) {
  const scenario = parseScenario(
    JSON.stringify({
      name: 'test',
      day_length_seconds: dayLength,
      character: { name: 'Kestrel', life_id: 'ag_kestrel_01', position: { x: 0, y: 64, z: 0 } },
      reflex: { hunger_interval_ticks: 10000000, eat_below: 14 },
      wake: { min_spacing_seconds: 0 },
      ...over,
    }),
  );
  const clock = new FakeClock();
  const hub = new SimHub({ scenario, clock });
  return { clock, hub };
}

function ctx(controller = new AbortController()): ToolContext {
  return { playerId: PLAYER, signal: controller.signal };
}

function longIntent(wakeOn: string[], mockTicks = 100000): Intent {
  return {
    goal: 'walk',
    program: 'travel',
    arguments: { mock_ticks: mockTicks },
    wake_on: wakeOn,
    limits: { max_world_ticks: 240000, max_block_operations: 10 },
  } as unknown as Intent;
}

function say(at_tick: number, to: string | null, text = 'a line') {
  return { type: 'speech', at_tick, from: 'Bram', to, text };
}

function track<T>(p: Promise<T>): { done: () => boolean } {
  let done = false;
  p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return { done: () => done };
}

describe('waitTool', () => {
  it('wakes on addressed speech, not on chatter, for an intent runner', async () => {
    const { clock, hub } = setup({
      events: [say(300, null, 'chatter'), say(900, 'Kestrel', 'hi')],
    });
    hub
      .player(PLAYER)
      .startIntent(longIntent(['directly_addressed', 'goal_completed']), clock.nowMs());
    const p = waitTool(hub, ctx(), { max_seconds: 60 });
    const t = track(p);
    await clock.advance(500);
    expect(t.done()).toBe(false);
    await clock.advance(500);
    const r = await p;
    expect(r.wake_reason).toBe('directly_addressed');
    expect(r.events.map((e) => e.type)).toEqual(['conversation_digest', 'speech_to_me']);
    expect(r.untrusted_world_text.speech?.map((s) => s.text)).toEqual(['chatter', 'hi']);
    expect(validateToolResult('wait', r).ok).toBe(true);
    const sup = hub.suppressed(PLAYER);
    expect(sup).toHaveLength(1);
    expect(sup[0]).toMatchObject({ kind: 'speech', reason: 'overheard_chatter' });
  }, 30_000);

  it('does not wake on an addressed line the intent did not ask for', async () => {
    const { clock, hub } = setup({ events: [say(300, null), say(900, 'Kestrel')] });
    hub.player(PLAYER).startIntent(longIntent(['goal_completed']), clock.nowMs());
    const p = waitTool(hub, ctx(), { max_seconds: 60 });
    await clock.advance(60000);
    const r = await p;
    expect(r.wake_reason).toBe('timeout');
    expect(hub.suppressed(PLAYER).map((s) => s.reason)).toContain('not_in_wake_on');
  }, 30_000);

  it('an idle agent ignores chatter and wakes for addressed speech', async () => {
    const quiet = setup({ events: [say(3000, null)] });
    const p1 = waitTool(quiet.hub, ctx(), { max_seconds: 10 });
    await quiet.clock.advance(10000);
    expect((await p1).wake_reason).toBe('timeout');

    const loud = setup({ events: [say(3000, null), say(4000, 'Kestrel')] });
    const p2 = waitTool(loud.hub, ctx(), { max_seconds: 10 });
    await loud.clock.advance(4000);
    expect((await p2).wake_reason).toBe('directly_addressed');
  }, 30_000);

  it('holds a wake inside the minimum spacing and delivers the held events later', async () => {
    const { clock, hub } = setup({
      wake: { min_spacing_seconds: 20 },
      events: [say(1000, 'Kestrel', 'first'), say(3000, 'Kestrel', 'second')],
    });
    const first = waitTool(hub, ctx(), { max_seconds: 60 });
    await clock.advance(1000);
    expect((await first).wake_reason).toBe('directly_addressed');
    await clock.advance(500);
    const second = waitTool(hub, ctx(), { max_seconds: 60 });
    const t = track(second);
    await clock.advance(19000);
    expect(t.done()).toBe(false);
    await clock.advance(500);
    const r = await second;
    expect(r.wake_reason).toBe('directly_addressed');
    expect(r.untrusted_world_text.speech?.map((s) => s.text)).toEqual(['second']);
    expect(r.events.some((e) => e.type === 'speech_to_me')).toBe(true);
    expect(hub.suppressed(PLAYER).map((s) => s.reason)).toContain('min_spacing');
  }, 30_000);

  it('falls back to intent_run_too_long and does not repeat it inside the next window', async () => {
    const { clock, hub } = setup({
      wake: { min_spacing_seconds: 0, intent_run_too_long_seconds: 5 },
    });
    hub.player(PLAYER).startIntent(longIntent(['goal_completed']), clock.nowMs());
    const a = waitTool(hub, ctx(), { max_seconds: 60 });
    const ta = track(a);
    await clock.advance(4999);
    expect(ta.done()).toBe(false);
    await clock.advance(1);
    expect((await a).wake_reason).toBe('intent_run_too_long');
    const b = waitTool(hub, ctx(), { max_seconds: 60 });
    const tb = track(b);
    await clock.advance(4999);
    expect(tb.done()).toBe(false);
    await clock.advance(1);
    expect((await b).wake_reason).toBe('intent_run_too_long');
  }, 30_000);

  it('a retry with the same cursor returns the same events and speech', async () => {
    const { clock, hub } = setup(
      { events: [say(10, null, 'chatter'), say(30, 'Kestrel', 'hello')] },
      2400,
    );
    const woke = waitTool(hub, ctx(), { max_seconds: 60 });
    await clock.advance(3000);
    const first = await woke;
    expect(first.wake_reason).toBe('directly_addressed');

    const a = waitTool(hub, ctx(), { cursor: 'c_0', max_seconds: 5 });
    await clock.advance(5000);
    const ra = await a;
    const b = waitTool(hub, ctx(), { cursor: 'c_0', max_seconds: 5 });
    await clock.advance(5000);
    const rb = await b;
    expect(ra.wake_reason).toBe('timeout');
    expect(ra.events).toHaveLength(2);
    expect(rb.events).toEqual(ra.events);
    expect(rb.untrusted_world_text.speech).toEqual(ra.untrusted_world_text.speech);
    expect(ra.untrusted_world_text.speech).toHaveLength(2);

    await expect(waitTool(hub, ctx(), { cursor: 'c_99', max_seconds: 5 })).rejects.toMatchObject({
      code: 'bad_cursor',
    });
    expect(validateToolInput('wait', { cursor: `c_${'1'.repeat(13)}`, max_seconds: 5 }).ok).toBe(
      false,
    );
  }, 30_000);

  it('reports dropped events for a cursor older than the log', async () => {
    const { clock, hub } = setup();
    const log = hub.player(PLAYER).log;
    for (let i = 0; i < 1100; i++) {
      log.append({ kind: 'damage', amount: 1, tick: i, atMs: 0, wakeOn: null });
    }
    const r = await waitTool(hub, ctx(), { cursor: 'c_0', max_seconds: 5 });
    // The log kept 1000 of 1100 (100 dropped there); the 200 cap drops the rest of the kept ones.
    expect(r.events).toHaveLength(200);
    expect(r.dropped_events).toBe(100 + (1000 - r.events.length));
  }, 30_000);

  it('wakes at dusk to the millisecond even between polls', async () => {
    // 25 s days: dusk is at 12.5 s, between the 1 s polls.
    const { clock, hub } = setup({}, 25);
    const p = waitTool(hub, ctx(), { max_seconds: 20 });
    const t = track(p);
    await clock.advance(12499);
    expect(t.done()).toBe(false);
    await clock.advance(1);
    const r = await p;
    expect(r.wake_reason).toBe('day_night');
    expect(r.events.some((e) => e.type === 'day_night')).toBe(true);
  }, 30_000);

  it('does not skip hunger steps that fall between polls in one wait', async () => {
    const { clock, hub } = setup({
      character: {
        name: 'Kestrel',
        life_id: 'ag_kestrel_01',
        position: { x: 0, y: 64, z: 0 },
        food: 20,
        inventory: [{ item: 'bread', count: 5 }],
      },
      reflex: { hunger_interval_ticks: 2500, eat_below: 20 },
    });
    const p = waitTool(hub, ctx(), { max_seconds: 9 });
    await clock.advance(9000);
    const r = await p;
    expect(r.wake_reason).toBe('timeout');
    // Steps at 2.5 s, 5 s and 7.5 s each eat once.
    expect(r.events.filter((e) => e.type === 'reflex')).toHaveLength(3);
  }, 30_000);

  it('applies the interests argument to the wake policy', async () => {
    const { clock, hub } = setup({ events: [say(3000, 'Kestrel')] });
    const p = waitTool(hub, ctx(), { max_seconds: 10, interests: ['damage'] });
    await clock.advance(10000);
    expect((await p).wake_reason).toBe('timeout');
    expect(hub.suppressed(PLAYER).map((s) => s.reason)).toContain('not_in_interests');
  }, 30_000);

  it('leaves no pending sleep after a return, a timeout, an abort or a pre-aborted signal', async () => {
    const { clock, hub } = setup({ events: [say(2000, 'Kestrel')] });
    const woke = waitTool(hub, ctx(), { max_seconds: 60 });
    await clock.advance(2000);
    expect((await woke).wake_reason).toBe('directly_addressed');
    expect(clock.pendingCount).toBe(0);

    const timed = waitTool(hub, ctx(), { max_seconds: 3 });
    await clock.advance(3000);
    expect((await timed).wake_reason).toBe('timeout');
    expect(clock.pendingCount).toBe(0);

    const controller = new AbortController();
    const aborted = waitTool(hub, ctx(controller), { max_seconds: 60 });
    const check = expect(aborted).rejects.toMatchObject({ code: 'session_superseded' });
    await clock.advance(500);
    expect(clock.pendingCount).toBe(1);
    controller.abort();
    await check;
    expect(clock.pendingCount).toBe(0);

    const pre = new AbortController();
    pre.abort();
    await expect(waitTool(hub, ctx(pre), { max_seconds: 60 })).rejects.toMatchObject({
      code: 'session_superseded',
    });
    expect(clock.pendingCount).toBe(0);
  }, 30_000);

  it('the eat reflex is reported but does not wake', async () => {
    const { clock, hub } = setup({
      character: {
        name: 'Kestrel',
        life_id: 'ag_kestrel_01',
        position: { x: 0, y: 64, z: 0 },
        food: 14,
        inventory: [{ item: 'bread', count: 1 }],
      },
      reflex: { hunger_interval_ticks: 1000, eat_below: 14 },
    });
    const p = waitTool(hub, ctx(), { max_seconds: 3 });
    await clock.advance(3000);
    const r = await p;
    expect(r.wake_reason).toBe('timeout');
    expect(r.events.filter((e) => e.type === 'reflex')).toHaveLength(1);
  }, 30_000);

  it('an aborted signal ends a pending wait with session_superseded', async () => {
    const { clock, hub } = setup();
    const controller = new AbortController();
    const p = waitTool(hub, ctx(controller), { max_seconds: 60 });
    const check = expect(p).rejects.toMatchObject({ code: 'session_superseded' });
    await clock.advance(500);
    controller.abort();
    await check;
  }, 30_000);

  it('an intent end wakes even when wake_on and interests omit it', async () => {
    const a = setup();
    a.hub.player(PLAYER).startIntent(longIntent(['directly_addressed'], 2000), 0);
    const pa = waitTool(a.hub, ctx(), { max_seconds: 60 });
    await a.clock.advance(2000);
    expect((await pa).wake_reason).toBe('goal_completed');

    const b = setup();
    b.hub.player(PLAYER).startIntent(longIntent(['directly_addressed'], 2000), 0);
    const pb = waitTool(b.hub, ctx(), { max_seconds: 60, interests: ['damage'] });
    await b.clock.advance(2000);
    expect((await pb).wake_reason).toBe('goal_completed');
  }, 30_000);

  it('a timeout return starts the spacing window', async () => {
    const { clock, hub } = setup({
      wake: { min_spacing_seconds: 20 },
      events: [say(6000, 'Kestrel')],
    });
    const a = waitTool(hub, ctx(), { max_seconds: 5 });
    await clock.advance(5000);
    expect((await a).wake_reason).toBe('timeout');
    const b = waitTool(hub, ctx(), { max_seconds: 60 });
    const tb = track(b);
    await clock.advance(19999);
    expect(tb.done()).toBe(false);
    await clock.advance(1);
    expect((await b).wake_reason).toBe('directly_addressed');
  }, 30_000);

  it('returns the newest 200 events and counts the rest as dropped', async () => {
    const events = Array.from({ length: 250 }, (_, i) => ({
      type: 'damage',
      at_tick: i + 1,
      amount: 1,
    }));
    const { clock, hub } = setup({ events });
    hub.player(PLAYER);
    await clock.advance(1000);
    const r = await waitTool(hub, ctx(), { cursor: 'c_0', max_seconds: 5 });
    expect(r.events).toHaveLength(200);
    expect(r.events[0]?.seq).toBe(51);
    expect(r.dropped_events).toBeGreaterThanOrEqual(50);
    const checked = validateToolResult('wait', r);
    expect(checked.ok).toBe(true);
  }, 30_000);
});
