import type { Bot } from 'mineflayer';
import { expect } from 'vitest';
import { completed, type FailReason, failed } from '../../actions/outcome.ts';
import { type ActionHandler, ActionRegistry, runAction } from '../../actions/registry.ts';
import { fakeBot } from '../body.fakes.ts';
import type { IntentProgram, ProgramContext, StepResult } from '../program.ts';
import { MemorySink } from '../records.ts';
import type { BodyView, HostileView } from '../view.ts';

/** The state the fake handlers change and the fake view reads. */
export interface FakeWorld {
  position: { x: number; y: number; z: number };
  health: number;
  night: boolean;
  inventory: Record<string, number>;
  hostiles: HostileView[];
  /** Every action the programs ran, in order, as `kind:detail` text. */
  log: string[];
  /** Makes the next run of this kind fail with the reason (kept until cleared). */
  failing: Partial<Record<string, FailReason>>;
  /** What a block drops when it is not the block's own name. */
  drops: Record<string, string>;
  /** How far the nearest block of a kind is, by block name (see withBlockRegistry). */
  nearest: Record<string, number>;
  /** When true, goto completes without moving the Body. */
  pinned: boolean;
  /** The hostiles lose the Body once it has made this many gotos; null keeps them near. */
  escapeAfterGotos: number | null;
}

export function newWorld(overrides: Partial<FakeWorld> = {}): FakeWorld {
  return {
    position: { x: 0, y: 64, z: 0 },
    health: 10,
    night: false,
    inventory: {},
    hostiles: [],
    log: [],
    failing: {},
    drops: { stone: 'cobblestone' },
    nearest: {},
    pinned: false,
    escapeAfterGotos: null,
    ...overrides,
  };
}

function view(world: FakeWorld): BodyView {
  return {
    tick: 0,
    get health() {
      return world.health;
    },
    hunger: 20,
    get position() {
      return { ...world.position };
    },
    nearbyHostiles: (radius = 16) => {
      const gotos = world.log.filter((line) => line.startsWith('goto:')).length;
      if (world.escapeAfterGotos !== null && gotos >= world.escapeAfterGotos) return [];
      return world.hostiles.filter((mob) => mob.distance <= radius);
    },
    inventoryCount: (item) => world.inventory[item] ?? 0,
    inFluid: null,
    onFire: false,
    fallingDistance: 0,
    air: 20,
    edibleFoods: () => [],
    dropAhead: () => 0,
  };
}

function add(world: FakeWorld, item: string, count: number): void {
  world.inventory[item] = (world.inventory[item] ?? 0) + count;
}

/** Handlers for the verbs the programs use; each one logs and changes the world. */
export function fakeRegistry(world: FakeWorld): ActionRegistry {
  const registry = new ActionRegistry();
  const handler = <K extends 'goto' | 'mine' | 'craft' | 'sleep' | 'wait'>(
    kind: K,
    run: ActionHandler<K>['run'],
  ): void => {
    registry.register({
      kind,
      timeoutMs: 1000,
      run: async (ctx, action) => {
        const fail = world.failing[kind];
        if (fail) return failed(fail, `fake ${kind} failure`);
        return run(ctx, action);
      },
    } as ActionHandler<K> as never);
  };
  handler('goto', async (_ctx, action) => {
    world.log.push(`goto:${JSON.stringify(action.target)}`);
    if (!world.pinned && typeof action.target !== 'string') world.position = { ...action.target };
    return completed();
  });
  handler('mine', async (_ctx, action) => {
    world.log.push(`mine:${action.block}x${action.count}`);
    add(world, world.drops[action.block] ?? action.block, action.count);
    return completed({ mined: action.count });
  });
  handler('craft', async (_ctx, action) => {
    world.log.push(`craft:${action.item}x${action.count}`);
    // A recipe makes 4 per craft, so a request is rounded up to a multiple of 4.
    add(world, action.item, Math.ceil(action.count / 4) * 4);
    return completed();
  });
  handler('sleep', async () => {
    world.log.push('sleep');
    if (!world.night) return failed('not_possible', 'not night');
    world.health = 20;
    return completed();
  });
  handler('wait', async (_ctx, action) => {
    world.log.push(`wait:${action.seconds}`);
    world.health = Math.min(20, world.health + 3);
    return completed();
  });
  return registry;
}

/**
 * Gives the bot the registry parts `gather` reads: a block entry (with its `drops`) for every
 * block in `world.drops` and `world.nearest`, and a `findBlock` that finds a block within its
 * distance in `world.nearest` (a block not listed there is found at any range).
 */
function withBlockRegistry(bot: Bot, world: FakeWorld): void {
  const blocksByName: Record<string, { id: number; drops: number[] }> = {};
  const items: Record<number, { name: string }> = {};
  let next = 1;
  const itemId = (name: string): number => {
    const known = Object.entries(items).find(([, item]) => item.name === name);
    if (known) return Number(known[0]);
    items[next] = { name };
    return next++;
  };
  for (const block of new Set([...Object.keys(world.drops), ...Object.keys(world.nearest)])) {
    const drop = world.drops[block];
    blocksByName[block] = { id: 1000 + next, drops: drop === undefined ? [] : [itemId(drop)] };
    next += 1;
  }
  Object.assign(bot, {
    registry: { blocksByName, items },
    findBlock: (options: { matching: number; maxDistance: number }) => {
      const name = Object.keys(blocksByName).find(
        (key) => blocksByName[key]?.id === options.matching,
      );
      const distance = name === undefined ? undefined : world.nearest[name];
      return distance === undefined || distance <= options.maxDistance ? {} : null;
    },
  });
}

/** A program context over the fake world. */
export function contextFor(
  world: FakeWorld,
  signal = new AbortController().signal,
): ProgramContext {
  const bot = fakeBot();
  withBlockRegistry(bot, world);
  const registry = fakeRegistry(world);
  return {
    bot,
    view: view(world),
    registry,
    sink: new MemorySink(),
    lifeId: 'life-1',
    bodyGeneration: 1,
    timeScale: 1,
    runAction: (action, stepSignal) => runAction(registry, bot, action, { signal: stepSignal }),
    signal,
  };
}

/** What a driven run leaves behind. */
export interface Driven {
  last: StepResult;
  steps: number;
  world: FakeWorld;
}

const STEP_LIMIT = 100;

/**
 * Runs a program from `start`. When `interruptAfter` is set, the run is cut at that step boundary
 * (0 is right after `start`): the checkpoint goes through a JSON round trip, a fresh instance
 * `resume`s from it, and the run goes on.
 */
export async function drive(
  factory: () => IntentProgram,
  args: Record<string, unknown>,
  world: FakeWorld,
  interruptAfter: number | null = null,
): Promise<Driven> {
  const ctx = contextFor(world);
  let program = factory();
  await program.start(args, ctx);
  const interrupt = async (): Promise<void> => {
    const saved = JSON.parse(JSON.stringify(program.checkpoint()));
    program = factory();
    await program.resume(saved, ctx);
  };
  if (interruptAfter === 0) await interrupt();
  let steps = 0;
  let last: StepResult = { status: 'running' };
  while (last.status === 'running' && steps < STEP_LIMIT) {
    last = await program.step(ctx);
    steps += 1;
    if (last.status === 'running' && steps === interruptAfter) await interrupt();
  }
  return { last, steps, world };
}

/**
 * Proves resume at every boundary: runs once uninterrupted, then once per boundary with a restart
 * there, and expects the same final result and the same world (inventory, position, health and the
 * full action log, so no work is repeated).
 */
export async function expectResumeEverywhere(
  factory: () => IntentProgram,
  args: Record<string, unknown>,
  makeWorld: () => FakeWorld,
): Promise<number> {
  const straight = await drive(factory, args, makeWorld());
  expect(straight.last.status).toBe('completed');
  expect(straight.steps).toBeGreaterThan(1);
  for (let boundary = 0; boundary < straight.steps; boundary += 1) {
    const cut = await drive(factory, args, makeWorld(), boundary);
    expect(cut.last, `interrupted after ${boundary}`).toEqual(straight.last);
    expect(cut.steps, `interrupted after ${boundary}`).toBe(straight.steps);
    expect(cut.world, `interrupted after ${boundary}`).toEqual(straight.world);
  }
  return straight.steps;
}
