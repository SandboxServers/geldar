import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import { sleepAction } from './sleep.ts';

export interface FakeBlock {
  name: string;
  position: Vec3;
}

export interface FakeOptions {
  timeOfDay?: number;
  thundering?: boolean;
  /** The blocks in the world; `findBlocks` searches them in order. */
  blocks?: FakeBlock[];
  /** Messages `bot.sleep` rejects with, one per call, before it succeeds. */
  sleepErrors?: string[];
  /** True when the bot starts out in a bed. */
  asleep?: boolean;
  /** True when `bot.sleep` never settles, as when the server stays silent. */
  hangSleep?: boolean;
}

/** A fake bot with a clock, a set of blocks, and a `sleep` that can reject. */
export function fakeBot(options: FakeOptions = {}): Bot {
  const blocks = options.blocks ?? [];
  const errors = [...(options.sleepErrors ?? [])];
  let sleeping = options.asleep ?? false;
  const bot = {
    time: { timeOfDay: options.timeOfDay ?? 1_000 },
    thunderState: options.thundering ? 1 : 0,
    entity: { position: new Vec3(0, 64, 0) },
    get isSleeping() {
      return sleeping;
    },
    findBlocks: ({
      matching,
      count,
    }: {
      matching: (block: FakeBlock) => boolean;
      maxDistance: number;
      count: number;
    }) =>
      blocks
        .filter(matching)
        .slice(0, count)
        .map((block) => block.position),
    blockAt: (position: Vec3) => blocks.find((block) => block.position.equals(position)) ?? null,
    sleep: vi.fn(async (_bed: FakeBlock) => {
      if (options.hangSleep) return new Promise<void>(() => undefined);
      const error = errors.shift();
      // The server says "already sleeping" only when the bot is in a bed.
      if (error && /already sleeping/i.test(error)) sleeping = true;
      if (error) throw new Error(error);
      sleeping = true;
    }),
  };
  return bot as unknown as Bot;
}

/** Runs the `sleep` handler with a fresh abort signal, unless the test passes its own. */
export function sleep(bot: Bot, timeScale = 1, signal = new AbortController().signal) {
  return sleepAction.run({ bot, signal, timeScale }, { do: 'sleep' });
}

/** The options the handler passed to `moveNear`. */
export interface MoveOpts {
  signal: AbortSignal;
}

/** A walk that never arrives: it resolves only when the signal it was given aborts. */
export const walkUntilAborted = (
  _bot: unknown,
  _target: unknown,
  _range: unknown,
  opts: MoveOpts,
) =>
  new Promise((resolve) => {
    opts.signal.addEventListener(
      'abort',
      () => resolve({ ok: false, reason: 'cancelled', message: 'move cancelled' }),
      { once: true },
    );
  });

export const BED = { name: 'white_bed', position: new Vec3(5, 64, 0) };
export const OTHER_HALF = { name: 'white_bed', position: new Vec3(6, 64, 0) };

/** A whole bed as the world holds it: two adjacent blocks along x, both named `name`. */
export function bed(name: string, x: number): FakeBlock[] {
  return [
    { name, position: new Vec3(x, 64, 0) },
    { name, position: new Vec3(x + 1, 64, 0) },
  ];
}
