import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { cancelled, completed } from '../actions/outcome.ts';
import type { ActionHandler } from '../actions/registry.ts';
import type { Reflex, Trigger } from './reflex.ts';
import type { ReflexName } from './reflex-config.ts';
import type { TickSource } from './runtime.ts';
import type { BodyView } from './view.ts';

/** A tick source the test drives by hand: `emit(age)` calls every subscribed listener. */
export interface ManualTicks {
  source: TickSource;
  emit(worldAge: number): void;
  listeners(): number;
}

export function manualTicks(): ManualTicks {
  const subscribed = new Set<(worldAge: number) => void>();
  return {
    source: (listener) => {
      subscribed.add(listener);
      return () => {
        subscribed.delete(listener);
      };
    },
    emit: (age) => {
      for (const listener of [...subscribed]) listener(age);
    },
    listeners: () => subscribed.size,
  };
}

/** A view with settable numbers and no bot. */
export function fakeView(overrides: Partial<Record<'health' | 'hunger', number>> = {}): BodyView & {
  health: number;
  hunger: number;
} {
  return {
    tick: 0,
    health: overrides.health ?? 20,
    hunger: overrides.hunger ?? 20,
    position: { x: 0, y: 64, z: 0 },
    nearbyHostiles: () => [],
    inventoryCount: () => 0,
    inFluid: null,
    onFire: false,
    fallingDistance: 0,
  };
}

/** The bot parts the runtime and the view touch; an event emitter so `physicsTick` listeners work. */
export function fakeBot(): Bot {
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot.entity = { position: new Vec3(0, 64, 0), onGround: true };
  bot.entities = {};
  bot.health = 20;
  bot.food = 20;
  bot.time = { age: 0 };
  bot.inventory = { items: () => [] };
  bot.blockAt = () => null;
  return bot as unknown as Bot;
}

/** A reflex whose `check` fires while `active()` is true, and whose runs are logged in `log`. */
export interface FakeReflex extends Reflex {
  log: string[];
  /** Resolve the pending `run`, when `hold` is set. */
  release(): void;
}

export function fakeReflex(
  name: ReflexName,
  opts: {
    priority: number;
    cooldownTicks?: number;
    active?: () => boolean;
    trigger?: Trigger;
    /** When true `run` waits for `release()`. */
    hold?: boolean;
    /** Called inside `run` with the context's `cancelAction`. */
    onRun?: (cancelAction: () => Promise<void>) => Promise<void>;
  },
): FakeReflex {
  const log: string[] = [];
  let releaseRun: () => void = () => undefined;
  return {
    name,
    priority: opts.priority,
    cooldownTicks: opts.cooldownTicks ?? 0,
    log,
    release: () => releaseRun(),
    check: () => ((opts.active?.() ?? true) ? (opts.trigger ?? { fake: true }) : null),
    run: async (_trigger, ctx) => {
      log.push(`run@${ctx.tick}`);
      const gate = new Promise<void>((resolve) => (releaseRun = resolve));
      await opts.onRun?.(ctx.cancelAction);
      if (opts.hold) await gate;
      return { result: 'handled' };
    },
  };
}

/** A `wait` handler that runs until its signal aborts, then reports `cancelled`. */
export function hangingWait(): ActionHandler<'wait'> & { started(): number } {
  let started = 0;
  return {
    kind: 'wait',
    timeoutMs: 60_000,
    started: () => started,
    run: async (ctx) => {
      started += 1;
      if (ctx.signal.aborted) return cancelled();
      await new Promise<void>((resolve) =>
        ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return cancelled();
    },
  };
}

/** A `wait` handler that completes at once. */
export function instantWait(): ActionHandler<'wait'> {
  return { kind: 'wait', timeoutMs: 1000, run: async () => completed() };
}
