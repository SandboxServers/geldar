import { describe, expect, it } from 'vitest';
import { completed, failed } from '../../actions/outcome.ts';
import { ActionRegistry } from '../../actions/registry.ts';
import { fakeBot, fakeView, manualTicks } from '../body.fakes.ts';
import { MemorySink } from '../records.ts';
import type { Reflex, ReflexContext } from '../reflex.ts';
import { ActionBusyError, BodyRuntime } from '../runtime.ts';
import type { BodyView } from '../view.ts';
import { runUnstick } from './idle-stuck.ts';

/** A slot that counts its holds and releases; `held` is true while a hold is open. */
function slotCtx(view: BodyView, registry: ActionRegistry, signal: AbortSignal) {
  const slot = { holds: 0, releases: 0, held: false };
  const ctx = {
    bot: fakeBot(),
    view,
    registry,
    tick: 0,
    timeScale: 1,
    signal,
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
      };
    },
  } as unknown as ReflexContext;
  return { ctx, slot };
}

/** A view that reads as a still, stuck Body; `runUnstick` reads only the position and the tick. */
function stuckView(): BodyView {
  return {
    tick: 0,
    position: { x: -265.5, y: 35, z: 196.5 },
    canStepOff: false,
  } as unknown as BodyView;
}

describe('idle_stuck holds the action slot for its whole run (decision 0196, item 3)', () => {
  it('holds the slot while unstick runs, and releases it when the run completes', async () => {
    const registry = new ActionRegistry();
    let heldWhileRunning: boolean | null = null;
    const { ctx, slot } = slotCtx(stuckView(), registry, new AbortController().signal);
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => {
        heldWhileRunning = slot.held;
        return completed({ method: 'step' });
      },
    });
    await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(heldWhileRunning).toBe(true);
    expect(slot).toMatchObject({ holds: 1, releases: 1, held: false });
  });

  it('releases the slot when the run is cut short by an abort', async () => {
    const registry = new ActionRegistry();
    registry.register({
      kind: 'unstick',
      timeoutMs: 1000,
      run: async () => failed('blocked', 'trapped'),
    });
    const aborted = new AbortController();
    aborted.abort();
    const { ctx, slot } = slotCtx(stuckView(), registry, aborted.signal);
    const outcome = await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(outcome.result).not.toBe('handled');
    expect(slot).toMatchObject({ holds: 1, releases: 1, held: false });
  });

  it('releases the slot when the run throws, and the throw still reaches the caller', async () => {
    const { ctx, slot } = slotCtx(
      stuckView(),
      undefined as unknown as ActionRegistry,
      new AbortController().signal,
    );
    await expect(runUnstick(ctx, 'idle_stuck (ledge)')).rejects.toThrow();
    expect(slot).toMatchObject({ holds: 1, releases: 1, held: false });
  });

  it('does not take the slot for a backed-off refusal, which runs nothing', async () => {
    const registry = new ActionRegistry();
    const { ctx, slot } = slotCtx(stuckView(), registry, new AbortController().signal);
    const first = await runUnstick(ctx, 'idle_stuck (ledge)');
    expect(first.result).toBe('failed');
    const holdsAfterFirst = slot.holds;
    // The failed run backs off 60 s from its end (tick 0): a run 100 ticks later is refused.
    const refused = await runUnstick({ ...ctx, tick: 100 } as ReflexContext, 'idle_stuck (ledge)');
    expect(refused.result).toBe('abandoned');
    expect(slot.holds).toBe(holdsAfterFirst);
  });
});

describe('the runtime refuses a Mind action while a reflex holds the slot', () => {
  it('throws ActionBusyError mid-run and admits an action after the release', async () => {
    const bot = fakeBot();
    const ticks = manualTicks();
    let finish: () => void = () => {};
    const hold: Reflex = {
      name: 'idle_stuck',
      priority: 1,
      cooldownTicks: 0,
      check: () => ({}),
      run: async (_trigger, ctx) => {
        const free = ctx.holdSlot?.() ?? (() => {});
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        free();
        return { result: 'handled' };
      },
    };
    const runtime = new BodyRuntime({
      lifeId: 'ag_test_01',
      bodyGeneration: 1,
      bot,
      ticks: ticks.source,
      sink: new MemorySink(),
      reflexes: [hold],
      view: fakeView(),
    });
    runtime.start();
    ticks.emit(100);
    await Promise.resolve();
    await expect(runtime.runAction({ do: 'unstick' })).rejects.toBeInstanceOf(ActionBusyError);
    finish();
    await runtime.reflexRunner.idle();
    const after = await runtime.runAction({ do: 'unstick' }).catch((error: unknown) => error);
    expect(after).not.toBeInstanceOf(ActionBusyError);
    await runtime.stop();
  });
});
