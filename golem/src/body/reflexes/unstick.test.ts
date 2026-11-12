import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from '../body.fakes.ts';
import { createBody } from '../create-body.ts';
import { FIRST_PAUSE_TICKS, MAX_PAUSE_TICKS, panicBurrowReflex } from './panic-burrow.ts';
import { reflexContext, settableView } from './reflexes.fakes.ts';
import { MAX_ATTEMPTS, noteGoto, STUCK_GOTOS, stallCount, unstickReflex } from './unstick.ts';

const STALL = 'no movement for 600 world ticks';

function stall(view: Parameters<typeof noteGoto>[0]): void {
  noteGoto(view, 'failed', 'blocked', STALL);
}

function registryWith(outcome: 'free' | 'trapped') {
  const registry = new ActionRegistry();
  let calls = 0;
  registry.register({
    kind: 'unstick',
    timeoutMs: 1000,
    run: async () => {
      calls++;
      return outcome === 'free' ? completed({ method: 'step' }) : failed('blocked', 'trapped');
    },
  });
  return { registry, calls: () => calls };
}

describe('unstick reflex trigger', () => {
  it('fires on the second no-movement goto in a row, not the first', () => {
    const view = settableView();
    expect(unstickReflex.check(view)).toBeNull();
    stall(view);
    expect(STUCK_GOTOS).toBe(2);
    expect(unstickReflex.check(view)).toBeNull();
    stall(view);
    expect(unstickReflex.check(view)).toEqual({ stalls: 2, attempt: 1 });
  });

  it('counts a goto that finished without moving (stalled) and clears on a real arrival', () => {
    const view = settableView();
    noteGoto(view, 'completed', undefined, undefined, true);
    expect(stallCount(view)).toBe(1);
    noteGoto(view, 'completed', undefined, undefined, true);
    expect(unstickReflex.check(view)).toEqual({ stalls: 2, attempt: 1 });
    noteGoto(view, 'completed', undefined, undefined, false);
    expect(stallCount(view)).toBe(0);
  });

  it.each(['way was blocked', 'no path', 'no path to the goal'])(
    'counts a blocked failure ("%s") at the same spot as a stall',
    (text) => {
      const view = settableView();
      const here = { x: 18.5, y: 68, z: 81.5 };
      noteGoto(view, 'failed', 'blocked', text, false, here);
      noteGoto(view, 'failed', 'blocked', text, false, { ...here, x: here.x + 0.8 });
      expect(unstickReflex.check(view)).toEqual({ stalls: 2, attempt: 1 });
    },
  );

  it('restarts the count when the stalls are more than a block apart, and clears attempts past 3 blocks', () => {
    const view = settableView();
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, { x: 0, y: 64, z: 0 });
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, { x: 2, y: 64, z: 0 });
    expect(stallCount(view)).toBe(1);
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, { x: 2, y: 64, z: 0.5 });
    expect(unstickReflex.check(view)).toEqual({ stalls: 2, attempt: 1 });
  });

  it('gives attempts back only when the stall is more than 3 blocks from the streak start', async () => {
    const view = settableView();
    const at = { x: 0, y: 64, z: 0 };
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, at);
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, at);
    const { registry } = registryWith('trapped');
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await unstickReflex.run({}, reflexContext(fakeBot(), view, registry));
    }
    expect(unstickReflex.check(view)).toBeNull();
    // Two blocks away: a new count, but the attempts stay used up.
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, { x: 2, y: 64, z: 0 });
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, { x: 2, y: 64, z: 0 });
    expect(unstickReflex.check(view)).toBeNull();
    // More than 3 blocks from where that streak began: attempts are back.
    const far = { x: 9, y: 64, z: 0 };
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, far);
    noteGoto(view, 'failed', 'blocked', 'way was blocked', false, far);
    expect(unstickReflex.check(view)).toEqual({ stalls: 2, attempt: 1 });
  });

  it('ignores other failures and clears on an arrival', () => {
    const view = settableView();
    // Failures about the goal, not the bot's own cell, are never stalls (documented on noteGoto).
    noteGoto(view, 'failed', 'timeout', 'timed out');
    noteGoto(view, 'failed', 'interrupted', 'interrupted');
    noteGoto(view, 'failed', 'not_found', STALL);
    noteGoto(view, 'cancelled', undefined, undefined);
    expect(stallCount(view)).toBe(0);
    stall(view);
    noteGoto(view, 'completed', undefined, undefined);
    stall(view);
    expect(unstickReflex.check(view)).toBeNull();
  });

  it('runs the verb, clears the streak when it frees the body, and reports handled', async () => {
    const view = settableView();
    stall(view);
    stall(view);
    const { registry, calls } = registryWith('free');
    const ctx = reflexContext(fakeBot(), view, registry);
    const outcome = await unstickReflex.run({}, ctx);
    expect(outcome).toEqual({ result: 'handled', detail: 'unstick freed the body' });
    expect(calls()).toBe(1);
    expect(ctx.cancels).toBe(1);
    expect(unstickReflex.check(view)).toBeNull();
  });

  it('stops after the last allowed attempt and fails with a clear message', async () => {
    const view = settableView();
    stall(view);
    stall(view);
    const { registry, calls } = registryWith('trapped');
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      expect(unstickReflex.check(view)).toEqual({ stalls: 2, attempt: i });
      const outcome = await unstickReflex.run({}, reflexContext(fakeBot(), view, registry));
      expect(outcome).toEqual({ result: 'failed', detail: 'unstick found no way out' });
    }
    expect(calls()).toBe(MAX_ATTEMPTS);
    expect(unstickReflex.check(view)).toBeNull();
    noteGoto(view, 'completed', undefined, undefined);
    stall(view);
    stall(view);
    expect(unstickReflex.check(view)).not.toBeNull();
  });
});

describe('panic burrow backoff', () => {
  function blind() {
    const view = settableView();
    view.isNight = true;
    const bot = { entity: { position: new Vec3(0, 64, 0) }, blockAt: () => null } as unknown as Bot;
    return {
      view,
      ctx: (tick: number) => ({ ...reflexContext(bot, view, new ActionRegistry()), tick }),
    };
  }

  it('doubles its pause after each refusal, up to five minutes, and then fires again', async () => {
    const { view, ctx } = blind();
    const clock = view as { tick: number };
    let tick = 100;
    let pause = FIRST_PAUSE_TICKS;
    for (let i = 0; i < 8; i++) {
      clock.tick = tick;
      const trigger = panicBurrowReflex.check(view);
      expect(trigger).not.toBeNull();
      const outcome = await panicBurrowReflex.run(trigger ?? {}, ctx(tick));
      expect(outcome).toEqual({ result: 'abandoned', detail: 'no suitable block' });
      clock.tick = tick + pause - 1;
      expect(panicBurrowReflex.check(view)).toBeNull();
      clock.tick = tick + pause;
      expect(panicBurrowReflex.check(view)).not.toBeNull();
      tick += pause;
      pause = Math.min(pause * 2, MAX_PAUSE_TICKS);
    }
    expect(pause).toBe(MAX_PAUSE_TICKS);
  });
});

describe('respawn', () => {
  it('forgets the stuck streak and the burrow pause when the bot respawns', async () => {
    const emitter = new EventEmitter();
    const bot = Object.assign(emitter, fakeBot(), {
      on: emitter.on.bind(emitter),
    }) as unknown as Bot;
    const view = fakeView();
    createBody({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot,
      ticks: manualTicks().source,
      currentRevision: () => 1,
      view,
    });
    stall(view as never);
    stall(view as never);
    expect(unstickReflex.check(view)).not.toBeNull();
    emitter.emit('respawn');
    expect(unstickReflex.check(view)).toBeNull();
    expect(stallCount(view)).toBe(0);
  });
});
