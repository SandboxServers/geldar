import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from '../body.fakes.ts';
import { MemorySink } from '../records.ts';
import type { Reflex, ReflexContext, ReflexOutcome } from '../reflex.ts';
import { ActionBusyError, BodyRuntime } from '../runtime.ts';
import type { BodyView } from '../view.ts';
import {
  IDLE_STUCK_DAMAGE_BACKOFF_TICKS,
  IDLE_TICKS,
  idleStuckReflex,
  runUnstick,
} from './idle-stuck.ts';

/** Zack's cell (decision 0196): a still Body on a ledge it cannot step off. */
const ZACK = { x: -265.5, y: 35, z: 196.5 };

/** A view that reads as a still, stuck Body. The test sets `tick` as the world moves on. */
function stuckView(tick: number): BodyView {
  return {
    tick,
    position: { ...ZACK },
    canStepOff: false,
    actionRunning: false,
    asleep: false,
    riding: false,
    onOwnPlacement: false,
  } as unknown as BodyView;
}

/** Moves the view's world tick on (the view reads it; the runtime is not involved here). */
function setTick(view: BodyView, tick: number): void {
  (view as unknown as { tick: number }).tick = tick;
}

/** A context whose slot counts holds and records `probe()` at each release. */
function runCtx(
  view: BodyView,
  registry: ActionRegistry,
  bot: Bot,
  tick: number,
  probe: () => unknown = () => undefined,
) {
  const slot = { holds: 0, releases: 0, held: false, probed: [] as unknown[] };
  const ctx = {
    bot,
    view,
    registry,
    tick,
    timeScale: 1,
    signal: new AbortController().signal,
    cancelAction: async () => {},
    holdSlot: () => {
      slot.holds++;
      slot.held = true;
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        slot.releases++;
        slot.held = false;
        slot.probed.push(probe());
      };
    },
  } as unknown as ReflexContext;
  return { ctx, slot };
}

/**
 * Resolves true when the abort arrives, false after 500 ms, so a handler that is never aborted cannot
 * hang a test.
 */
function untilAbortOr500(signal: AbortSignal): Promise<boolean> {
  // A handler that emits the hit before it waits finds the abort already fired.
  if (signal.aborted) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 500);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('idle_stuck aborts when the Body takes damage (decision 0196, 2026-11-14)', () => {
  it('a hit during the run aborts it, frees the slot, and a Mind action then runs', async () => {
    const bot = fakeBot();
    const ticks = manualTicks();
    let calls = 0;
    let cutShort = false;
    let outcome: ReflexOutcome | null = null;
    let registered = false;
    const reflex: Reflex = {
      name: 'idle_stuck',
      priority: 1,
      cooldownTicks: 0,
      check: () => ({}),
      run: async (_trigger, ctx) => {
        if (!registered) {
          registered = true;
          ctx.registry.register({
            kind: 'unstick',
            timeoutMs: 1000,
            run: async (actx) => {
              calls++;
              if (calls > 1) return completed({ method: 'step' });
              bot.health = 14;
              bot.emit('health');
              cutShort = await untilAbortOr500(actx.signal);
              return failed('blocked', 'trapped');
            },
          });
        }
        outcome = await runUnstick(ctx, 'idle_stuck (ledge)');
        return outcome;
      },
    };
    const runtime = new BodyRuntime({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot,
      ticks: ticks.source,
      sink: new MemorySink(),
      reflexes: [reflex],
      view: fakeView(),
    });
    runtime.start();
    ticks.emit(100);
    await runtime.reflexRunner.idle();
    expect(outcome).toMatchObject({ result: 'abandoned' });
    expect(String((outcome as { detail?: string } | null)?.detail)).toContain('the Body was hurt');
    expect(cutShort).toBe(true);
    expect(bot.listenerCount('health')).toBe(0);
    // Admitted: runAction did not throw ActionBusyError and the handler ran. (The stub moves nothing,
    // so the runtime's receipt check fails the run; that is not what this test is about.)
    await runtime.runAction({ do: 'unstick' });
    expect(calls).toBe(2);
    await runtime.stop();
  });

  it('the reflex re-arms after the damage backoff if the Body is still stuck', async () => {
    const bot = fakeBot();
    const registry = new ActionRegistry();
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async (actx) => {
        bot.health = 14;
        bot.emit('health');
        await untilAbortOr500(actx.signal);
        return failed('blocked', 'trapped');
      },
    });
    const view = stuckView(0);
    expect(idleStuckReflex.check(view)).toBeNull();
    setTick(view, IDLE_TICKS);
    expect(idleStuckReflex.check(view)).not.toBeNull();
    const { ctx } = runCtx(view, registry, bot, IDLE_TICKS);
    const outcome = await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(outcome.detail).toContain('the Body was hurt');
    setTick(view, IDLE_TICKS + IDLE_STUCK_DAMAGE_BACKOFF_TICKS - 1);
    expect(idleStuckReflex.check(view)).toBeNull();
    setTick(view, IDLE_TICKS + IDLE_STUCK_DAMAGE_BACKOFF_TICKS);
    expect(idleStuckReflex.check(view)).not.toBeNull();
  });

  it('no abort without damage: a health rise is not a hit and the run ends on its own', async () => {
    const bot = fakeBot();
    bot.health = 14;
    const registry = new ActionRegistry();
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => {
        bot.health = 16;
        bot.emit('health');
        await delay(10);
        return completed({ method: 'step' });
      },
    });
    const { ctx } = runCtx(stuckView(100), registry, bot, 100);
    const outcome = await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(outcome.result).toBe('failed');
    expect(outcome.detail).toContain('left the body on a ledge');
    expect(outcome.detail).not.toContain('hurt');
    expect(bot.listenerCount('health')).toBe(0);
  });

  it('the damage backoff is IDLE_STUCK_DAMAGE_BACKOFF_TICKS: refused just before, run at the boundary', async () => {
    const bot = fakeBot();
    const registry = new ActionRegistry();
    let calls = 0;
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async (actx) => {
        calls++;
        if (calls > 1) return completed({ method: 'step' });
        bot.health = 14;
        bot.emit('health');
        await untilAbortOr500(actx.signal);
        return failed('blocked', 'trapped');
      },
    });
    const view = stuckView(1200);
    const first = await runUnstick(runCtx(view, registry, bot, 1200).ctx, 'idle_stuck (ledge)');
    expect(first.detail).toContain('backoff 15s');
    const just = 1200 + IDLE_STUCK_DAMAGE_BACKOFF_TICKS - 1;
    const refused = await runUnstick(runCtx(view, registry, bot, just).ctx, 'idle_stuck (ledge)');
    expect(refused.detail).toContain('backing off');
    expect(calls).toBe(1);
    const boundary = 1200 + IDLE_STUCK_DAMAGE_BACKOFF_TICKS;
    await runUnstick(runCtx(view, registry, bot, boundary).ctx, 'idle_stuck (ledge)');
    expect(calls).toBe(2);
  });

  it('releases the slot only after the unstick handler has settled', async () => {
    const bot = fakeBot();
    const registry = new ActionRegistry();
    let handlerDone = false;
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => {
        bot.health = 14;
        bot.emit('health');
        // Ignores the abort: the run resolves at once, the handler winds down for 100 ms.
        await delay(100);
        handlerDone = true;
        return completed({ method: 'step' });
      },
    });
    const { ctx, slot } = runCtx(stuckView(0), registry, bot, 0, () => handlerDone);
    const outcome = await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(outcome.detail).toContain('the Body was hurt');
    expect(slot.probed).toEqual([true]);
    expect(bot.listenerCount('health')).toBe(0);
  });

  it('a runtime stop (the parent signal) cuts the run: the handler sees the abort', async () => {
    const bot = fakeBot();
    bot.health = 14;
    const registry = new ActionRegistry();
    let cut = false;
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async (actx) => {
        cut = await untilAbortOr500(actx.signal);
        return failed('blocked', 'trapped');
      },
    });
    const parent = new AbortController();
    const { ctx } = runCtx(stuckView(100), registry, bot, 100);
    (ctx as { signal: AbortSignal }).signal = parent.signal;
    setTimeout(() => parent.abort(), 20);
    await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(cut).toBe(true);
    expect(bot.listenerCount('health')).toBe(0);
  });

  it('the parent abort listener is removed when the run ends', async () => {
    const bot = fakeBot();
    const registry = new ActionRegistry();
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => completed({ method: 'step' }),
    });
    const parent = new AbortController();
    const removed = vi.spyOn(parent.signal, 'removeEventListener');
    const { ctx } = runCtx(stuckView(100), registry, bot, 100);
    (ctx as { signal: AbortSignal }).signal = parent.signal;
    await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('a health rise and then a drop is a hit: 10, 12, 11 aborts the run', async () => {
    const bot = fakeBot();
    bot.health = 10;
    const registry = new ActionRegistry();
    let cutShort = false;
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async (actx) => {
        bot.health = 12;
        bot.emit('health');
        bot.health = 11;
        bot.emit('health');
        cutShort = await untilAbortOr500(actx.signal);
        return failed('blocked', 'trapped');
      },
    });
    const { ctx } = runCtx(stuckView(100), registry, bot, 100);
    const outcome = await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(cutShort).toBe(true);
    expect(outcome.detail).toContain('the Body was hurt');
  });

  it('a hurt run is not a failed run: the next plain failure backs off 60 s, not 120 s', async () => {
    const bot = fakeBot();
    bot.health = 14;
    const registry = new ActionRegistry();
    let calls = 0;
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async (actx) => {
        calls++;
        if (calls > 1) return failed('blocked', 'trapped');
        bot.health = 10;
        bot.emit('health');
        await untilAbortOr500(actx.signal);
        return failed('blocked', 'trapped');
      },
    });
    const view = stuckView(1200);
    const hurt = await runUnstick(runCtx(view, registry, bot, 1200).ctx, 'idle_stuck (ledge)');
    expect(hurt.detail).toContain('the Body was hurt');
    const later = 1200 + IDLE_STUCK_DAMAGE_BACKOFF_TICKS;
    const plain = await runUnstick(runCtx(view, registry, bot, later).ctx, 'idle_stuck (ledge)');
    expect(calls).toBe(2);
    expect(plain.detail).toContain('found no way out; backoff 60s');
  });

  it('a second release of one hold does not free the slot while another hold stands', async () => {
    const bot = fakeBot();
    const ticks = manualTicks();
    let busy: string | null = null;
    let runtime!: BodyRuntime;
    const reflex: Reflex = {
      name: 'idle_stuck',
      priority: 1,
      cooldownTicks: 0,
      check: () => ({}),
      run: async (_trigger, ctx) => {
        const first = ctx.holdSlot?.() ?? (() => {});
        const second = ctx.holdSlot?.() ?? (() => {});
        first();
        first();
        busy = await runtime.runAction({ do: 'unstick' }).then(
          () => 'admitted',
          (error: unknown) => (error instanceof ActionBusyError ? 'busy' : 'other'),
        );
        second();
        return { result: 'handled', detail: 'slot test' };
      },
    };
    runtime = new BodyRuntime({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot,
      ticks: ticks.source,
      sink: new MemorySink(),
      reflexes: [reflex],
      view: fakeView(),
    });
    runtime.start();
    ticks.emit(100);
    await runtime.reflexRunner.idle();
    expect(busy).toBe('busy');
    await runtime.stop();
  });
});
