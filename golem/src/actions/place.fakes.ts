import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import { placeAction } from './place.ts';
import { upperCell } from './place-footprint.ts';
import { clickedProperties } from './place-state.ts';

/** Bounding box of each block the fake knows: `empty` cells are passable, `block` cells are solid. */
export const BOXES: Record<string, 'block' | 'empty'> = {
  air: 'empty',
  cave_air: 'empty',
  water: 'empty',
  torch: 'empty',
  wall_torch: 'empty',
  stone: 'block',
  dirt: 'block',
  dirt_path: 'block',
  cobblestone: 'block',
  crafting_table: 'block',
  white_bed: 'block',
  oak_door: 'block',
  oak_log: 'block',
  oak_stairs: 'block',
  oak_slab: 'block',
  lava: 'empty',
  poppy: 'empty',
  sunflower: 'empty',
  snow: 'empty',
};

export const SHAPES: Record<string, number[][]> = { dirt_path: [[0, 0, 0, 1, 0.9375, 1]] };

export interface FakeOptions {
  /** Cells that hold something, by `x,y,z`; every other cell is air. */
  blocks?: Record<string, string>;
  /** Item names in the inventory. */
  items?: string[];
  /** Where the bot stands. */
  at?: Vec3;
  /** Where the bot faces, in radians (0 faces +z). */
  yaw?: number;
  /** Other entities, each standing at the position given. */
  entities?: Vec3[];
  /** The name written to the target on a placement; defaults to the held item. */
  placedAs?: string;
  /** Thrown by `placeBlock` instead of placing. */
  placeError?: string;
  /** The first N placements are refused by the server, the later ones work. */
  refuseFirst?: number;
}

export interface FakeBot {
  bot: Bot;
  placeBlock: ReturnType<typeof vi.fn>;
  look: ReturnType<typeof vi.fn>;
  setControlState: ReturnType<typeof vi.fn>;
}

export function key(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

/**
 * A fake bot with a world map, an inventory and the placement calls `place` makes. A placed block
 * takes the state its click gives (`clickedProperties`, the rule the planner models): the click
 * is at the centre of the face (cursor height 0.5), from the bot's yaw at the moment of the click.
 */
export function fakeBot(options: FakeOptions = {}): FakeBot {
  const world = new Map(Object.entries(options.blocks ?? {}));
  const states = new Map<string, Record<string, string>>();
  const entity = {
    position: options.at ?? new Vec3(0.5, 64, 0.5),
    yaw: options.yaw ?? 0,
    pitch: 0,
  };
  let held: { name: string; count: number } | null = null;
  let attempts = 0;
  const bot = {
    entity,
    entities: Object.fromEntries(
      (options.entities ?? []).map((position, i) => [String(i + 1), { position }]),
    ),
    get heldItem() {
      return held;
    },
    registry: {
      blocksByName: Object.fromEntries(
        Object.entries(BOXES).map(([name, boundingBox]) => [name, { boundingBox }]),
      ),
    },
    inventory: { items: () => (options.items ?? []).map((name) => ({ name, count: 1 })) },
    equip: vi.fn(async (stack: { name: string; count: number }) => {
      held = stack;
    }),
    look: vi.fn(async (yaw: number, pitch: number) => {
      entity.yaw = yaw;
      entity.pitch = pitch;
    }),
    setControlState: vi.fn(),
    blockAt: (p: Vec3) => {
      const name = world.get(key(p)) ?? 'air';
      return {
        name,
        position: p,
        boundingBox: BOXES[name],
        shapes: SHAPES[name] ?? [],
        getProperties: () => states.get(key(p)) ?? {},
      };
    },
    placeBlock: vi.fn(async (reference: { position: Vec3 }, face: Vec3) => {
      if (options.placeError) throw new Error(options.placeError);
      if (attempts++ < (options.refuseFirst ?? 0)) throw new Error('server refused to place');
      const cell = reference.position.plus(face);
      const name = options.placedAs ?? held?.name ?? 'air';
      world.set(key(cell), name);
      // The reference lies opposite the face clicked: the offset from the target is -face.
      const reference2 = new Vec3(-face.x, -face.y, -face.z);
      states.set(key(cell), clickedProperties(name, reference2, entity.yaw, 0.5));
      // A two-cell item (door, tall plant) fills the cell above too, as the server does.
      const upper = upperCell(name, cell);
      if (upper !== null) world.set(key(upper), name);
    }),
  };
  return {
    bot: bot as unknown as Bot,
    placeBlock: bot.placeBlock,
    look: bot.look,
    setControlState: bot.setControlState,
  };
}

/** Runs the `place` handler with a fresh abort signal. */
export function place(
  fake: FakeBot,
  block: string,
  at: { x: number; y: number; z: number } | 'feet',
) {
  return placeAction.run(
    { bot: fake.bot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block, at },
  );
}
