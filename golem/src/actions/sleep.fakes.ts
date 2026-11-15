import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import { sleepAction } from './sleep.ts';

export interface FakeBlock {
  name: string;
  position: Vec3;
  /** The block light the world model reports; absent reads as unknown. */
  light?: number;
  /** The bed's `occupied` state; absent means that state cannot be read. */
  occupied?: boolean | undefined;
  /** The bed block's `part` state; absent means it cannot be read, so the block keys only itself. */
  part?: 'head' | 'foot';
  /** The bed block's `facing` state; absent means it cannot be read. */
  facing?: string;
  /** The block's bounding box as Mineflayer reports it: `block` is solid, `empty` is passable; absent reads as unknown. */
  boundingBox?: 'block' | 'empty';
  /** The block's collision shapes as Mineflayer reports them, each `[minX, minY, minZ, maxX, maxY, maxZ]`; absent reads as unknown. */
  shapes?: number[][];
  /** True when light passes the block; absent reads as unknown. */
  transparent?: boolean;
}

/** An entity in the fake world: its minecraft-data name and its feet position. */
export interface FakeEntity {
  name: string;
  position: Vec3;
  /** The entity id Mineflayer keys `bot.entities` by; absent takes the entity's index in the list. */
  id?: number;
}

/** The minecraft-data categories the fake registry knows: the hostile mobs and the passive ones the tests name. */
export const SCENE_REGISTRY = {
  entitiesByName: {
    zombie: { category: 'Hostile mobs' },
    creeper: { category: 'Hostile mobs' },
    enderman: { category: 'Hostile mobs' },
    zombified_piglin: { category: 'Hostile mobs' },
    iron_golem: { category: 'Passive mobs' },
    snow_golem: { category: 'Passive mobs' },
  },
};

export interface FakeOptions {
  timeOfDay?: number;
  /** The world age in ticks (`bot.time.age`); a test may set it again between two sleeps. */
  age?: number;
  thundering?: boolean;
  /** The blocks in the world; `findBlocks` searches them in order, within `maxDistance` of the bot. */
  blocks?: FakeBlock[];
  /** The entities in the world, as `bot.entities` lists them. */
  entities?: FakeEntity[];
  /** Messages `bot.sleep` rejects with, one per call, before it succeeds. */
  sleepErrors?: string[];
  /** True when the bot starts out in a bed. */
  asleep?: boolean;
  /** True when `bot.sleep` never settles, as when the server stays silent. */
  hangSleep?: boolean;
  /** Wall ms before `bot.sleep` settles, so a test can send messages while the Body is getting into the bed. */
  sleepDelayMs?: number;
}

/**
 * A fake bot with a clock, a set of blocks, and a `sleep` that can reject. It is also a message emitter:
 * `emit` and `listenerCount` are its `message` events, so a test can send sleep lines and count subscribers.
 */
export function fakeBot(options: FakeOptions = {}): Bot {
  const blocks = options.blocks ?? [];
  const errors = [...(options.sleepErrors ?? [])];
  let sleeping = options.asleep ?? false;
  const emitter = new EventEmitter();
  const bot = {
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
    listenerCount: emitter.listenerCount.bind(emitter),
    time: { timeOfDay: options.timeOfDay ?? 1_000, age: options.age ?? 0 },
    thunderState: options.thundering ? 1 : 0,
    entity: { position: new Vec3(0, 64, 0) },
    entities: Object.fromEntries(
      (options.entities ?? []).map((entity, index) => [
        String(index),
        { ...entity, id: entity.id ?? index },
      ]),
    ),
    registry: SCENE_REGISTRY,
    get isSleeping() {
      return sleeping;
    },
    findBlocks: ({
      matching,
      maxDistance,
      count,
    }: {
      matching: (block: FakeBlock) => boolean;
      maxDistance: number;
      count: number;
    }) =>
      blocks
        .filter(matching)
        .map((block) => block.position)
        .filter((position) => position.distanceTo(bot.entity.position) <= maxDistance)
        .slice(0, count),
    blockAt: (position: Vec3) => {
      const block = blocks.find((candidate) => candidate.position.equals(position));
      return block ? withState(block) : null;
    },
    sleep: vi.fn(async (_bed: FakeBlock) => {
      if (options.hangSleep) return new Promise<void>(() => undefined);
      if (options.sleepDelayMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, options.sleepDelayMs));
      }
      const error = errors.shift();
      // The server says "already sleeping" only when the bot is in a bed.
      if (error && /already sleeping/i.test(error)) sleeping = true;
      if (error) throw new Error(error);
      sleeping = true;
    }),
  };
  return bot as unknown as Bot;
}

/**
 * The block as `blockAt` returns it: its `getProperties` reports the bed states the fake holds (`part`, `facing`,
 * `occupied`), as Mineflayer's blocks do. A state the fake does not hold reads as undefined.
 */
function withState(block: FakeBlock): FakeBlock {
  const { occupied, part, facing } = block;
  return { ...block, getProperties: () => ({ part, facing, occupied }) } as FakeBlock;
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

/** A white bed's head at (5, 64, 0) facing west, so its foot is at (6, 64, 0). */
export const BED = {
  name: 'white_bed',
  position: new Vec3(5, 64, 0),
  part: 'head',
  facing: 'west',
} as const;
/** The foot of BED, at (6, 64, 0), facing west. */
export const OTHER_HALF = {
  name: 'white_bed',
  position: new Vec3(6, 64, 0),
  part: 'foot',
  facing: 'west',
} as const;

/** A whole bed as the world holds it: a head at (x, 64, 0) facing west, and its foot at x + 1. */
export function bed(name: string, x: number): FakeBlock[] {
  return [
    { name, position: new Vec3(x, 64, 0), part: 'head', facing: 'west' },
    { name, position: new Vec3(x + 1, 64, 0), part: 'foot', facing: 'west' },
  ];
}
