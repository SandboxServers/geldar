import { describe, expect, it } from 'vitest';
import type { MoveResult } from '../../actions/pathing.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot } from '../body.fakes.ts';
import { allReflexesOn, MemorySink, ReflexRunner } from '../index.ts';
import {
  type BlockedReport,
  createBlockedPathReflex,
  detourWaypoint,
  isBlockedAbandoned,
  reportBlocked,
  type Walk,
} from './blocked-path.ts';
import { reflexContext, settableView } from './reflexes.fakes.ts';
import { shelterReflexes } from './shelter.ts';

const REPORT: BlockedReport = {
  goal: { x: 14, y: 64, z: 0 },
  range: 1,
  intentId: 'int_1',
  message: 'no movement for 600 world ticks',
};

/** A walk that returns the scripted results in order and logs each call. */
function scriptedWalk(results: MoveResult[]) {
  const calls: {
    target: { x: number; y: number; z: number };
    range: number;
    stall: number | undefined;
  }[] = [];
  const walk: Walk = async (_bot, target, range, opts) => {
    calls.push({ target, range, stall: opts.stallTicks });
    return results.shift() ?? { ok: false, reason: 'blocked', message: 'script ran out' };
  };
  return { walk, calls };
}

function setup(walk: Walk) {
  const reflex = createBlockedPathReflex(walk);
  const view = settableView();
  const sink = new MemorySink();
  const ctx = reflexContext(fakeBot(), view, new ActionRegistry(), sink);
  return { reflex, view, sink, ctx };
}

describe('blocked path: check', () => {
  it('fires only after a blocked walk is reported, and carries the goal', () => {
    const { reflex, view } = setup(scriptedWalk([]).walk);
    expect(reflex.check(view)).toBeNull();
    reportBlocked(view, REPORT);
    expect(reflex.check(view)).toEqual({ x: 14, y: 64, z: 0, range: 1, intent_id: 'int_1' });
  });
});

describe('blocked path: run', () => {
  it('detours once and reports handled when the alternate reaches the goal', async () => {
    const { walk, calls } = scriptedWalk([
      { ok: true, distance: 1 },
      { ok: true, distance: 0.5 },
    ]);
    const { reflex, view, sink, ctx } = setup(walk);
    reportBlocked(view, REPORT);
    const outcome = await reflex.run(reflex.check(view) ?? {}, ctx);

    expect(outcome.result).toBe('handled');
    expect(ctx.cancels).toBe(1);
    expect(calls).toHaveLength(2);
    // The waypoint lies off the straight line (z moved), the goal walk uses a wider radius.
    expect(calls[0]?.target.z).not.toBe(0);
    expect(calls[1]).toMatchObject({ target: REPORT.goal, range: 3, stall: 200 });
    expect(sink.wakes).toEqual([]);
    expect(reflex.check(view)).toBeNull();
  });

  it('abandons with a blocked wake when the detour is blocked, trying no more than once', async () => {
    const { walk, calls } = scriptedWalk([{ ok: false, reason: 'blocked', message: 'no path' }]);
    const { reflex, view, sink, ctx } = setup(walk);
    reportBlocked(view, REPORT);
    const outcome = await reflex.run(reflex.check(view) ?? {}, ctx);

    expect(outcome.result).toBe('abandoned');
    expect(outcome.detail).toContain('blocked');
    expect(calls).toHaveLength(1);
    expect(sink.wakes).toEqual([
      {
        reason: 'action_failed',
        tick: 100,
        intentId: 'int_1',
        detail: expect.stringContaining('blocked'),
      },
    ]);
  });

  it('abandons when the detour works but the goal is still blocked', async () => {
    const { walk, calls } = scriptedWalk([
      { ok: true, distance: 1 },
      { ok: false, reason: 'blocked', message: 'sealed' },
    ]);
    const { reflex, view, sink, ctx } = setup(walk);
    reportBlocked(view, REPORT);
    const outcome = await reflex.run(reflex.check(view) ?? {}, ctx);

    expect(outcome.result).toBe('abandoned');
    expect(calls).toHaveLength(2);
    expect(sink.wakes).toHaveLength(1);
  });

  it('raises no wake when the Body was cancelled meanwhile', async () => {
    const { walk } = scriptedWalk([{ ok: false, reason: 'cancelled', message: 'move cancelled' }]);
    const { reflex, view, sink, ctx } = setup(walk);
    reportBlocked(view, REPORT);
    const outcome = await reflex.run(reflex.check(view) ?? {}, ctx);

    expect(outcome).toEqual({ result: 'abandoned', detail: 'cancelled' });
    expect(sink.wakes).toEqual([]);
  });

  it('writes one reflex_fired record through the runner and honours its config flag', async () => {
    const { walk } = scriptedWalk([{ ok: false, reason: 'blocked', message: 'no path' }]);
    const reflex = createBlockedPathReflex(walk);
    const view = settableView();
    const sink = new MemorySink();
    const ctx = reflexContext(fakeBot(), view, new ActionRegistry(), sink);
    const config = allReflexesOn();
    config.flags.blocked_path = false;
    const make = (cfg: typeof config) =>
      new ReflexRunner({
        reflexes: [reflex],
        config: cfg,
        view,
        sink,
        lifeId: 'ag_test_01',
        bodyGeneration: 1,
        context: () => ctx,
      });

    reportBlocked(view, REPORT);
    await make(config).onTick(100);
    expect(sink.reflexes).toEqual([]);

    await make(allReflexesOn()).onTick(100);
    expect(sink.reflexes).toHaveLength(1);
    expect(sink.reflexes[0]).toMatchObject({
      name: 'blocked_path',
      outcome: { result: 'abandoned' },
    });
  });
});

describe('blocked path: geometry and registration', () => {
  it('moves the waypoint sideways from the midpoint', () => {
    const at = detourWaypoint({ x: 0, y: 64, z: 0 }, { x: 14, y: 64, z: 0 });
    expect(at).toEqual({ x: 7, y: 64, z: 8 });
  });

  it('shelterReflexes holds both reflexes under their shard names', () => {
    expect(shelterReflexes.map((r) => r.name)).toEqual(['panic_burrow', 'blocked_path']);
  });
});

describe('blocked path: abandoned intents', () => {
  it('marks the intent abandoned when the alternate route fails, not when it works', async () => {
    const failing = setup(
      scriptedWalk([{ ok: false, reason: 'blocked', message: 'no path' }]).walk,
    );
    reportBlocked(failing.view, REPORT);
    await failing.reflex.run(failing.reflex.check(failing.view) ?? {}, failing.ctx);
    expect(isBlockedAbandoned(failing.view, 'int_1')).toBe(true);
    expect(isBlockedAbandoned(failing.view, 'int_2')).toBe(false);

    const working = setup(
      scriptedWalk([
        { ok: true, distance: 1 },
        { ok: true, distance: 0.5 },
      ]).walk,
    );
    reportBlocked(working.view, REPORT);
    await working.reflex.run(working.reflex.check(working.view) ?? {}, working.ctx);
    expect(isBlockedAbandoned(working.view, 'int_1')).toBe(false);
  });

  it('marks nothing for a report that has no intent', async () => {
    const { reflex, view, ctx } = setup(
      scriptedWalk([{ ok: false, reason: 'blocked', message: 'no path' }]).walk,
    );
    reportBlocked(view, { ...REPORT, intentId: null });
    await reflex.run(reflex.check(view) ?? {}, ctx);
    expect(isBlockedAbandoned(view, 'int_1')).toBe(false);
  });
});
