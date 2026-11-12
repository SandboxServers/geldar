import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { completed, failed } from '../../actions/outcome.ts';
import { type ActionHandler, ActionRegistry } from '../../actions/registry.ts';
import { fakeBot, fakeView } from '../body.fakes.ts';
import { MemorySink } from '../records.ts';
import type { ReflexContext } from '../reflex.ts';
import type { BodyView } from '../view.ts';
import type { BlockReader } from './hazard-escape.ts';

/** The view fields the basic reflexes read, settable. */
export interface BasicViewState {
  hunger: number;
  health: number;
  foods: string[];
  inFluid: 'water' | 'lava' | null;
  onFire: boolean;
  air: number;
  fallingDistance: number;
  drop: number;
  tick: number;
  position: { x: number; y: number; z: number };
}

/** A view over a mutable state object: the test changes the state, the reflex reads the view. */
export function basicView(init: Partial<BasicViewState> = {}): {
  view: BodyView;
  state: BasicViewState;
} {
  const state: BasicViewState = {
    hunger: 20,
    health: 20,
    foods: [],
    inFluid: null,
    onFire: false,
    air: 20,
    fallingDistance: 0,
    drop: 0,
    tick: 0,
    position: { x: 0, y: 64, z: 0 },
    ...init,
  };
  const view: BodyView = {
    ...fakeView(),
    get tick() {
      return state.tick;
    },
    get hunger() {
      return state.hunger;
    },
    get health() {
      return state.health;
    },
    get inFluid() {
      return state.inFluid;
    },
    get onFire() {
      return state.onFire;
    },
    get air() {
      return state.air;
    },
    get fallingDistance() {
      return state.fallingDistance;
    },
    get position() {
      return state.position;
    },
    edibleFoods: () => state.foods,
    dropAhead: () => state.drop,
  };
  return { view, state };
}

/** Block names by `x,y,z`; every other cell is air. */
export type Grid = Record<string, string>;

/** Block names that count as solid in a grid. */
const SOLID = new Set(['stone', 'dirt', 'magma_block']);

/** Reads a grid like a world: air is empty, stone and dirt are solid, fluids are `empty` boxes. */
export function gridReader(grid: Grid): BlockReader {
  return (x, y, z) => {
    const name = grid[`${x},${y},${z}`] ?? 'air';
    return { name, boundingBox: SOLID.has(name) ? 'block' : 'empty' };
  };
}

/** A grid with a stone floor at `floorY` over `from..to` on both axes. */
export function floor(grid: Grid, floorY: number, from: number, to: number): Grid {
  for (let x = from; x <= to; x++) {
    for (let z = from; z <= to; z++) grid[`${x},${floorY},${z}`] = 'stone';
  }
  return grid;
}

/** A bot over a grid, with the control and tick calls the reflexes make, logged. */
export interface GridBot {
  bot: Bot;
  /** `setControlState` calls as `control=value`. */
  controls: string[];
  /** Calls to the pathfinder, by name. */
  pathCalls: string[];
  /** Set to give the Body a horizontal velocity. */
  velocity: Vec3;
}

export function gridBot(grid: Grid): GridBot {
  const bot = fakeBot() as unknown as Record<string, unknown>;
  const read = gridReader(grid);
  const controls: string[] = [];
  const pathCalls: string[] = [];
  const velocity = new Vec3(0, 0, 0);
  (bot.entity as Record<string, unknown>).velocity = velocity;
  bot.blockAt = (at: Vec3) => {
    const block = read(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z));
    return block;
  };
  bot.setControlState = (control: string, value: boolean) => {
    controls.push(`${control}=${value}`);
  };
  bot.waitForTicks = async () => undefined;
  bot.usingHeldItem = false;
  bot.pathfinder = {
    stop: () => pathCalls.push('stop'),
    setGoal: () => pathCalls.push('setGoal'),
  };
  return { bot: bot as unknown as Bot, controls, pathCalls, velocity };
}

/** A reflex context with a memory sink and a counted `cancelAction`. */
export function basicContext(
  view: BodyView,
  bot: Bot,
  registry: ActionRegistry = new ActionRegistry(),
): { ctx: ReflexContext; sink: MemorySink; cancels: () => number } {
  const sink = new MemorySink();
  let cancels = 0;
  const ctx: ReflexContext = {
    bot,
    view,
    registry,
    sink,
    lifeId: 'life',
    bodyGeneration: 1,
    tick: 100,
    timeScale: 1,
    signal: new AbortController().signal,
    cancelAction: async () => {
      cancels += 1;
    },
  };
  return { ctx, sink, cancels: () => cancels };
}

/** A registry whose `eat` handler returns the given outcome and counts its runs. */
export function eatRegistry(outcome: 'completed' | 'failed'): {
  registry: ActionRegistry;
  runs: () => number;
} {
  let runs = 0;
  const handler: ActionHandler<'eat'> = {
    kind: 'eat',
    timeoutMs: 1000,
    run: async () => {
      runs += 1;
      return outcome === 'completed'
        ? completed({ item: 'bread' })
        : failed('not_possible', 'full');
    },
  };
  const registry = new ActionRegistry();
  registry.register(handler);
  return { registry, runs: () => runs };
}
