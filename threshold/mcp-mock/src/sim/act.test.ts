import type { Intent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../registry.ts';
import { actTool, sayTool } from './act.ts';
import { defineSkillTool, readBookTool, writeBookTool } from './books.ts';
import { FakeClock } from './clock.ts';
import { SimHub } from './hub.ts';
import { parseScenario } from './scenario.ts';

const ctx: ToolContext = { playerId: 'p1', signal: new AbortController().signal };

// Day length 24 s gives 1000 ticks a second.
function setup(character: Record<string, unknown> = {}) {
  const scenario = parseScenario(
    JSON.stringify({
      name: 'test',
      day_length_seconds: 24,
      character: {
        name: 'Kestrel',
        life_id: 'ag_kestrel_01',
        position: { x: 0, y: 64, z: 0 },
        ...character,
      },
      neighbours: [{ name: 'Pike', position: { x: 3, y: 64, z: 0 } }],
      reflex: { hunger_interval_ticks: 10000000, eat_below: 14 },
      wake: { min_spacing_seconds: 0 },
    }),
  );
  const clock = new FakeClock();
  const hub = new SimHub({ scenario, clock });
  return { clock, hub, sim: hub.player(ctx.playerId) };
}

function intentOf(over: Record<string, unknown> = {}): Intent {
  return {
    goal: 'walk',
    program: 'travel',
    arguments: { mock_ticks: 100000 },
    wake_on: ['goal_completed'],
    limits: { max_world_ticks: 240000, max_block_operations: 10 },
    ...over,
  } as unknown as Intent;
}

type Args = Parameters<typeof actTool>[2];
const mine = { do: 'mine', block: 'stone', count: 1 };
function act(hub: SimHub, input: object) {
  return actTool(hub, ctx, input as Args);
}

describe('actTool', () => {
  it('indexes say, then each action, then the intent, and returns only Appendix K keys', () => {
    const { hub, sim } = setup();
    const r = act(hub, { say: 'hi', actions: [mine, mine], intent: intentOf() });
    expect(r.accepted).toEqual([0, 1, 2, 3]);
    expect(Object.keys(r).sort()).toEqual(['accepted', 'budget_remaining_thoughts', 'rejected']);
    expect(sim.receipts.map((id) => id.slice(0, 3))).toEqual(['ac_', 'ac_', 'ac_', 'in_']);
    expect(r.budget_remaining_thoughts).toBe(96);
  }, 30_000);

  it('rejects items past the budget with budget_exhausted', () => {
    const { hub } = setup({ budget: 2 });
    const r = act(hub, { actions: [mine, mine, mine] });
    expect(r.accepted).toEqual([0, 1]);
    expect(r.rejected).toEqual([{ index: 2, reason: 'budget_exhausted' }]);
    expect(r.budget_remaining_thoughts).toBe(0);
  }, 30_000);

  it('refuses unknown targets, missing food, unknown skills and false preconditions free', () => {
    const { hub, sim } = setup();
    const r = act(hub, {
      actions: [
        { do: 'give', to: 'Nobody', item: 'bread', count: 1 },
        { do: 'eat' },
        { do: 'use_skill', name: 'ghost', args: {} },
        { do: 'goto', target: 'Nobody' },
      ],
      intent: intentOf({ preconditions: ['no_such_fact'] }),
    });
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'unknown_target',
      'nothing_to_eat',
      'unknown_skill',
      'unknown_target',
      'precondition_false',
    ]);
    expect(sim.budget).toBe(100);
    const m = act(hub, { actions: [mine, { do: 'goto', target: 'Pike' }] });
    expect(m.accepted).toEqual([0, 1]);
    expect(m.budget_remaining_thoughts).toBe(98);
  }, 30_000);

  it('eats an edible item and adds food', () => {
    const { hub, sim } = setup({ food: 10, inventory: [{ item: 'bread', count: 1 }] });
    const r = act(hub, { actions: [{ do: 'eat' }] });
    expect(r.accepted).toEqual([0]);
    expect(sim.food).toBe(16);
    expect(sim.inventory).toEqual([]);
  }, 30_000);

  it('replaces the running intent, and applies actions before the intent', () => {
    const { hub, sim } = setup();
    act(hub, { intent: intentOf({ goal: 'first' }) });
    const first = sim.intent()?.id;
    act(hub, { actions: [mine], intent: intentOf({ goal: 'second' }) });
    expect(sim.intent()?.spec.goal).toBe('second');
    expect(sim.intent()?.id).not.toBe(first);
    expect(sim.receipts.map((id) => id.slice(0, 3))).toEqual(['in_', 'ac_', 'in_']);
  }, 30_000);

  it('limits top-level say to one per 2 seconds and charges nothing for the refusal', async () => {
    const { clock, hub, sim } = setup();
    expect(act(hub, { say: 'one' }).accepted).toEqual([0]);
    const again = act(hub, { say: 'two' });
    expect(again.rejected).toEqual([{ index: 0, reason: 'rate_limited' }]);
    expect(sim.budget).toBe(99);
    expect(sayTool(hub, ctx, { text: 'three' })).toEqual({
      spoken: false,
      reason: 'rate_limited',
      budget_remaining_thoughts: 99,
    });
    await clock.advance(2000);
    expect(act(hub, { say: 'four' }).accepted).toEqual([0]);
    expect(sim.budget).toBe(98);
  }, 30_000);

  it('refuses delegated book and vote failures with their codes and charges nothing for them', () => {
    const { hub, sim } = setup();
    const r = act(hub, {
      actions: [
        { do: 'write_book', title: 'T', skill_id: 'nope' },
        { do: 'offer', item: 'diamond', count: 1 },
        { do: 'vote', proposal_id: 'pr_zzz' },
        mine,
      ],
    });
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'unknown_skill',
      'not_held',
      'unknown_proposal',
    ]);
    expect(r.accepted).toEqual([3]);
    expect(r.budget_remaining_thoughts).toBe(99);
    expect(sim.budget).toBe(99);
  }, 30_000);

  it('keeps the say spacing, books and skills of two players apart', () => {
    const { hub, sim: one } = setup();
    const ctx2: ToolContext = { playerId: 'p2', signal: ctx.signal };
    const two = hub.player('p2');
    expect(act(hub, { say: 'one' }).accepted).toEqual([0]);
    expect(actTool(hub, ctx2, { say: 'two' }).accepted).toEqual([0]);
    defineSkillTool(hub, ctx, { name: 'dig', code: 'noop', tests: [] } as never);
    const { book_id } = writeBookTool(hub, ctx, { title: 'T', text: 'mine' } as never);
    expect(readBookTool(hub, ctx).book_id).toBe(book_id);
    // p2 holds the same book id, but it is not on p2's shelf.
    two.inventory = [{ item: 'written_book', count: 1, book_id }];
    expect(() => readBookTool(hub, ctx2)).toThrow(expect.objectContaining({ code: 'no_book' }));
    const r = actTool(hub, ctx2, { actions: [{ do: 'write_book', title: 'S', skill_id: 'dig' }] });
    expect(r.rejected).toEqual([{ index: 0, reason: 'unknown_skill' }]);
    expect(two.budget).toBe(99);
    expect(one.budget).toBe(97);
  }, 30_000);

  it('rejects a say with no budget left and does not start the spacing clock', () => {
    const { hub, sim } = setup({ budget: 0 });
    expect(act(hub, { say: 'hi' }).rejected).toEqual([{ index: 0, reason: 'budget_exhausted' }]);
    expect(sayTool(hub, ctx, { text: 'hi' })).toEqual({
      spoken: false,
      reason: 'budget_exhausted',
      budget_remaining_thoughts: 0,
    });
    expect(sim.receipts).toEqual([]);
    // Same instant, so a spacing clock started by a refused say would now rate-limit this one.
    sim.budget = 5;
    expect(sayTool(hub, ctx, { text: 'hi' })).toEqual({ spoken: true, budget_remaining_thoughts: 4 });
  }, 30_000);

  it('keeps only the newest 1000 receipt ids', () => {
    const { hub, sim } = setup({ budget: 2000 });
    act(hub, { actions: Array.from({ length: 1100 }, () => mine) });
    expect(sim.receipts).toHaveLength(1000);
    expect(new Set(sim.receipts).size).toBe(1000);
  }, 30_000);

  it('accepts an intent-only call and the sim then runs it', async () => {
    const { clock, hub, sim } = setup();
    expect(act(hub, { intent: intentOf() }).accepted).toEqual([0]);
    await clock.advance(1000);
    sim.syncTo(clock.nowMs());
    expect(sim.intent()?.status).toBe('running');
  }, 30_000);

  it('syncs first: an intent issued after 5 s starts at progress 0 and still runs a second later', async () => {
    const { clock, hub, sim } = setup();
    await clock.advance(5000);
    act(hub, { intent: intentOf({ arguments: { mock_ticks: 1500 } }) });
    expect(sim.intent()?.progressTicks).toBe(0);
    await clock.advance(1000);
    sim.syncTo(clock.nowMs());
    expect(sim.intent()?.status).toBe('running');
  }, 30_000);
});
