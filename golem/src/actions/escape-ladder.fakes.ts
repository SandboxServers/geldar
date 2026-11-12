import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';

export interface FakeBlock {
  name: string;
  boundingBox: 'block' | 'empty';
  harvestTools?: Record<number, boolean>;
}

export const AIR: FakeBlock = { name: 'air', boundingBox: 'empty' };
export const block = (name: string, extra: Partial<FakeBlock> = {}): FakeBlock => ({
  name,
  boundingBox: 'block',
  ...extra,
});

export interface Scene {
  blocks?: Record<string, FakeBlock>;
  water?: boolean;
  items?: string[];
  /** The best tool `bestHarvestTool` finds, if any. */
  tool?: object | null;
  /** Called every tick after the controls are read: moves the bot like the game would. */
  physics?: (s: State) => void;
}

export interface State {
  position: Vec3;
  controls: Record<string, boolean>;
  entity: { position: Vec3; isInWater: boolean; height: number };
  scene: Scene;
  held: unknown;
  ticks: number;
  blockAt: (v: Vec3) => FakeBlock;
}

/** A scripted bot at (0.5, 64, 0.5): a block map, controls, a tick hook, and call mocks. */
export function scriptedBot(scene: Scene) {
  const position = new Vec3(0.5, 64, 0.5);
  const state: State = {
    position,
    controls: {},
    entity: { position, isInWater: scene.water === true, height: 1.8 },
    scene,
    held: null,
    ticks: 0,
    blockAt: (v) =>
      scene.blocks?.[`${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`] ?? AIR,
  };
  const keyOf = (v: Vec3) => `${v.x},${v.y},${v.z}`;
  const bot = {
    entity: state.entity,
    time: { age: 0 },
    health: 20,
    registry: {
      items: { 270: { name: 'wooden_pickaxe' } },
      blocksByName: { dirt: { boundingBox: 'block', diggable: true } },
    },
    inventory: { items: () => (scene.items ?? []).map((name) => ({ name, count: 1 })) },
    blockAt: vi.fn((v: Vec3) => state.blockAt(v)),
    setControlState: vi.fn((control: string, on: boolean) => {
      state.controls[control] = on;
    }),
    lookAt: vi.fn(async () => undefined),
    equip: vi.fn(async (item: unknown) => {
      state.held = item;
    }),
    dig: vi.fn(async (target: FakeBlock) => {
      for (const [key, value] of Object.entries(scene.blocks ?? {})) {
        if (value === target) delete scene.blocks?.[key];
      }
    }),
    placeBlock: vi.fn(async () => undefined),
    waitForTicks: vi.fn(async () => {
      await Promise.resolve();
      state.ticks++;
      bot.time.age++;
      scene.physics?.(state);
    }),
    pathfinder: {
      stop: vi.fn(),
      setGoal: vi.fn(),
      goto: vi.fn(),
      bestHarvestTool: vi.fn(() => scene.tool ?? null),
    },
  };
  return { bot, state, asBot: bot as unknown as Bot, keyOf };
}
