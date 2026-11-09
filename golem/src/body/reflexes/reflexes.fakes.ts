import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { completed, failed } from '../../actions/outcome.ts';
import type { ActionHandler } from '../../actions/registry.ts';
import { MemorySink } from '../records.ts';
import type { ReflexContext } from '../reflex.ts';
import type { BodyView } from '../view.ts';

/** A world of named blocks by position; a cell with no entry is air. */
export class GridWorld {
  readonly cells = new Map<string, string>();

  private key(cell: Vec3): string {
    return `${Math.floor(cell.x)},${Math.floor(cell.y)},${Math.floor(cell.z)}`;
  }

  set(cell: Vec3, name: string | null): void {
    if (name === null) this.cells.delete(this.key(cell));
    else this.cells.set(this.key(cell), name);
  }

  /** Fills the box between two corners (inclusive). */
  fill(from: Vec3, to: Vec3, name: string | null): void {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) {
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) {
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
          this.set(new Vec3(x, y, z), name);
        }
      }
    }
  }

  name(cell: Vec3): string {
    return this.cells.get(this.key(cell)) ?? 'air';
  }

  /** The block as the bot's `blockAt` returns it, or the air block. */
  blockAt(cell: Vec3): { name: string; boundingBox: string; diggable: boolean; position: Vec3 } {
    const name = this.name(cell);
    return {
      name,
      boundingBox: name === 'air' ? 'empty' : 'block',
      diggable: name !== 'bedrock',
      position: new Vec3(Math.floor(cell.x), Math.floor(cell.y), Math.floor(cell.z)),
    };
  }

  /** The cells holding `name`, nearest to `from` first. */
  nearest(name: string, from: Vec3): Vec3[] {
    const found: Vec3[] = [];
    for (const [key, value] of this.cells) {
      if (value !== name) continue;
      const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
      found.push(new Vec3(x, y, z));
    }
    return found.sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
  }
}

/** A bot over a grid: it walks straight at the look target while `forward` is held. */
export interface GridBot {
  bot: Bot;
  inventory: Map<string, number>;
}

/** `drops` maps a dug block to the item it leaves (default: its own name). */
export function gridBot(
  world: GridWorld,
  start: Vec3,
  drops: Record<string, string> = { stone: 'cobblestone' },
): GridBot {
  const inventory = new Map<string, number>();
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  const entity = { position: new Vec3(start.x + 0.5, start.y, start.z + 0.5), height: 1.8 };
  let look = entity.position.clone();
  let forward = false;
  bot.entity = entity;
  bot.time = { age: 0 };
  bot.blockAt = (cell: Vec3) => world.blockAt(cell);
  // `bot.dig` removes exactly the block it is given, as the real one does.
  bot.canDigBlock = () => true;
  bot.stopDigging = () => undefined;
  bot.dig = async (block: { name: string; position: Vec3 }) => {
    world.set(block.position, null);
    const drop = drops[block.name] ?? block.name;
    inventory.set(drop, (inventory.get(drop) ?? 0) + 1);
  };
  bot.lookAt = async (target: Vec3) => {
    look = target.clone();
  };
  bot.setControlState = (_control: string, state: boolean) => {
    forward = state;
  };
  bot.waitForTicks = async (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      (bot.time as { age: number }).age += 1;
      if (!forward) continue;
      const dx = look.x - entity.position.x;
      const dz = look.z - entity.position.z;
      const length = Math.hypot(dx, dz);
      const step = Math.min(0.5, length);
      if (length > 0) entity.position.add(new Vec3((dx / length) * step, 0, (dz / length) * step));
    }
  };
  return { bot: bot as unknown as Bot, inventory };
}

/** A `mine` handler that digs the nearest block of the named kind and keeps its drop. */
export function gridMine(
  world: GridWorld,
  grid: GridBot,
  drops: Record<string, string> = { stone: 'cobblestone' },
): ActionHandler<'mine'> {
  return {
    kind: 'mine',
    timeoutMs: 1000,
    run: async (ctx, action) => {
      const feet = ctx.bot.entity.position.floored();
      const under = feet.offset(0, -1, 0);
      const at = world.nearest(action.block, ctx.bot.entity.position).find((c) => !c.equals(under));
      if (!at) return failed('not_found', `no ${action.block}`);
      world.set(at, null);
      const drop = drops[action.block] ?? action.block;
      grid.inventory.set(drop, (grid.inventory.get(drop) ?? 0) + 1);
      return completed();
    },
  };
}

/** A `place` handler that fills an empty cell and spends one block of the inventory. */
export function gridPlace(world: GridWorld, grid: GridBot): ActionHandler<'place'> {
  return {
    kind: 'place',
    timeoutMs: 1000,
    run: async (_ctx, action) => {
      const left = grid.inventory.get(action.block) ?? 0;
      if (left < 1) return failed('missing_materials', `no ${action.block}`);
      if (action.at === 'feet') return failed('blocked', 'feet is not used here');
      const cell = new Vec3(action.at.x, action.at.y, action.at.z);
      if (world.name(cell) !== 'air') return failed('blocked', 'target occupied');
      world.set(cell, action.block);
      grid.inventory.set(action.block, left - 1);
      return completed();
    },
  };
}

/** A view whose night, bed and enclosure reads are plain fields the test sets. */
export interface SettableView extends BodyView {
  isNight: boolean;
  bedNearby: boolean;
  enclosed: boolean;
}

export function settableView(grid?: GridBot): SettableView {
  return {
    tick: 0,
    health: 20,
    hunger: 20,
    position: { x: 0, y: 64, z: 0 },
    nearbyHostiles: () => [],
    inventoryCount: (item) => grid?.inventory.get(item) ?? 0,
    inFluid: null,
    onFire: false,
    fallingDistance: 0,
    air: 20,
    edibleFoods: () => [],
    dropAhead: () => 0,
    isNight: false,
    bedNearby: false,
    enclosed: false,
  };
}

/** A reflex context over a bot and a view, with a sink to read back and a cancel counter. */
export function reflexContext(
  bot: Bot,
  view: BodyView,
  registry: ReflexContext['registry'],
  sink = new MemorySink(),
): ReflexContext & { cancels: number } {
  const ctx = {
    bot,
    view,
    registry,
    sink,
    lifeId: 'ag_test_01',
    bodyGeneration: 1,
    tick: 100,
    timeScale: 1,
    signal: new AbortController().signal,
    cancels: 0,
    cancelAction: async () => {
      ctx.cancels += 1;
    },
  };
  return ctx;
}
