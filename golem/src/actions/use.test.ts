import type { Action } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allActions } from './index.ts';
import { cancelled, completed, failed } from './outcome.ts';
import { recordOwnPlacement } from './own-placements.ts';
import { setOwnerLookup, setOwnerPrefetch } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import { USE_MESSAGE, useHandler } from './use.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** The bot stands two blocks from every target below, so the walk is not needed. */
const BOT = new Vec3(0, 64, 0);
const TARGET = { x: 2, y: 64, z: 0 };
const ABOVE = { x: 2, y: 65, z: 0 };

interface Stored {
  name: string;
  stateId: number;
  props: Record<string, unknown>;
}

interface Setup {
  /** The block at the target (default a closed oak door). */
  block?: string;
  /** Its properties, such as `open` for a door. */
  props?: Record<string, unknown>;
  /** The item in the hand at the start. */
  held?: string;
  /** Item names in the inventory. */
  items?: string[];
  /** Runs when the bot clicks a block; it may change the world. */
  onClick?: (pos: Vec3, world: Map<string, Stored>) => void;
  /** Runs inside the look, before the click (an abort here stops the use). */
  onLook?: () => void;
}

const key = (p: { x: number; y: number; z: number }): string => `${p.x},${p.y},${p.z}`;

/** A fake bot with a small world, a hand, an inventory and the calls a `use` makes. */
function fakeBot(setup: Setup = {}) {
  const world = new Map<string, Stored>([
    [
      key(TARGET),
      { name: setup.block ?? 'oak_door', stateId: 1, props: setup.props ?? { open: false } },
    ],
  ]);
  const clicks: string[] = [];
  let held: string | null = setup.held ?? null;
  const items = (setup.items ?? []).map((name) => ({ name }));
  const snapshot = (p: Vec3) => {
    const stored = world.get(key(p));
    const name = stored?.name ?? 'air';
    return {
      name,
      stateId: stored?.stateId ?? 0,
      position: p,
      getProperties: () => stored?.props ?? {},
    };
  };
  const bot = {
    username: 'Pike',
    entity: { position: BOT },
    get heldItem() {
      return held === null ? null : { name: held };
    },
    inventory: { items: () => items.filter((item) => item.name !== held) },
    equip: vi.fn(async (stack: { name: string }) => {
      held = stack.name;
    }),
    lookAt: vi.fn(async () => setup.onLook?.()),
    waitForTicks: vi.fn(async () => undefined),
    blockAt: (p: Vec3) => snapshot(p),
    activateBlock: vi.fn(async (cell: { name: string; position: Vec3 }) => {
      clicks.push(cell.name);
      setup.onClick?.(cell.position, world);
    }),
  };
  return { bot: bot as unknown as Bot, world, clicks };
}

/** Runs the `use` at the default target. The shard flag is on unless `enabled` is false. */
function use(
  bot: Bot,
  action: Partial<Extract<Action, { do: 'use' }>> = { at: TARGET },
  options: { enabled?: boolean; signal?: AbortSignal } = {},
) {
  const ctx = {
    bot,
    signal: options.signal ?? new AbortController().signal,
    timeScale: 0.001,
  } as ActionContext;
  return useHandler(options.enabled ?? true).run(ctx, { do: 'use', ...action } as never);
}

/** Opens or closes the door at the position the click lands on. */
function toggleDoor(pos: Vec3, world: Map<string, Stored>): void {
  const stored = world.get(key(pos));
  if (!stored) return;
  stored.props = { ...stored.props, open: !stored.props.open };
  stored.stateId += 1;
}

const owners = new Map<string, string | null>();

afterEach(() => {
  setOwnerLookup(null);
  setOwnerPrefetch(null);
  owners.clear();
});

/** Records who owns a block in the fake owner lookup. */
function ownedBy(pos: { x: number; y: number; z: number }, owner: string): void {
  owners.set(key(pos), owner);
  setOwnerLookup((p) => ({ known: true, owner: owners.get(key(p)) ?? null }));
  setOwnerPrefetch(async () => undefined);
}

describe('use: the handler is registered, and off by default', () => {
  it('is in the Body action list under its verb', () => {
    expect(allActions.map((handler) => handler.kind)).toContain('use');
  });

  it('is refused while the shard flag is off, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot();
    const outcome = await use(bot, { at: TARGET }, { enabled: false });
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.notYet));
    expect(clicks).toEqual([]);
  });
});

describe('use: the shape of the action', () => {
  it('refuses an entity together with a block position, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot({ held: 'wheat' });
    const outcome = await use(bot, { at: TARGET, entity: 'cow:123' });
    expect(outcome).toEqual(failed('invalid_args', USE_MESSAGE.both));
    expect(clicks).toEqual([]);
  });

  it('refuses a use of an entity alone, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot({ held: 'wheat' });
    const outcome = await use(bot, { entity: 'cow:123' });
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.entityNotYet));
    expect(clicks).toEqual([]);
  });

  it('refuses a use with neither a block position nor an entity', async () => {
    const { bot, clicks } = fakeBot();
    const outcome = await use(bot, {});
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.noTarget));
    expect(clicks).toEqual([]);
  });
});

describe('use: activating doors, gates, trapdoors, buttons and levers', () => {
  it('opens a closed door and reports the state read back', async () => {
    const { bot, world, clicks } = fakeBot({ onClick: toggleDoor });
    const outcome = await use(bot);
    expect(clicks).toEqual(['oak_door']);
    expect(world.get(key(TARGET))?.props.open).toBe(true);
    expect(outcome).toEqual(
      completed({ block: 'oak_door', at: { x: 2, y: 64, z: 0 }, state: 'open' }),
    );
  });

  it('fails with not_possible when the click changes nothing', async () => {
    const { bot } = fakeBot();
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.unchanged));
  });

  it('uses a door on another player’s build, since anyone may use a door', async () => {
    ownedBy(TARGET, 'Ada');
    const { bot, world } = fakeBot({ onClick: toggleDoor });
    const outcome = await use(bot);
    expect(world.get(key(TARGET))?.props.open).toBe(true);
    expect(outcome).toEqual(
      completed({ block: 'oak_door', at: { x: 2, y: 64, z: 0 }, state: 'open' }),
    );
  });

  it('refuses a lever on another player’s build, and clicks nothing', async () => {
    ownedBy(TARGET, 'Ada');
    const { bot, clicks } = fakeBot({ block: 'lever', props: { powered: false } });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.someoneElses));
    expect(clicks).toEqual([]);
  });

  it('uses a lever the bot placed itself', async () => {
    const { bot } = fakeBot({
      block: 'lever',
      props: { powered: false },
      onClick: (pos, world) => {
        const stored = world.get(key(pos));
        if (stored) stored.stateId += 1;
      },
    });
    recordOwnPlacement(bot, TARGET, 'lever');
    const outcome = await use(bot);
    expect(outcome).toEqual(completed({ block: 'lever', at: { x: 2, y: 64, z: 0 } }));
  });

  it('refuses an iron door, which needs redstone, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot({ block: 'iron_door' });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.notUsable));
    expect(clicks).toEqual([]);
  });

  it('refuses an item the inventory does not carry, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot();
    const outcome = await use(bot, { at: TARGET, item: 'oak_boat' });
    expect(outcome).toEqual(failed('missing_materials', USE_MESSAGE.noItem));
    expect(clicks).toEqual([]);
  });

  it('stops without a click when the signal aborts during the look', async () => {
    const controller = new AbortController();
    const { bot, clicks } = fakeBot({ onClick: toggleDoor, onLook: () => controller.abort() });
    const outcome = await use(bot, { at: TARGET }, { signal: controller.signal });
    expect(outcome).toEqual(cancelled());
    expect(clicks).toEqual([]);
  });
});

describe('use: sowing seeds and bone meal', () => {
  it('sows wheat seeds on farmland, and reports the crop above it', async () => {
    const { bot, world } = fakeBot({
      block: 'farmland',
      props: {},
      held: 'wheat_seeds',
      onClick: (pos, w) =>
        w.set(key({ x: pos.x, y: pos.y + 1, z: pos.z }), { name: 'wheat', stateId: 1, props: {} }),
    });
    const outcome = await use(bot);
    expect(world.get(key(ABOVE))?.name).toBe('wheat');
    expect(outcome).toEqual(completed({ block: 'wheat', at: { x: 2, y: 65, z: 0 } }));
  });

  it('refuses to sow when the block above is not clear, and clicks nothing', async () => {
    const { bot, world, clicks } = fakeBot({ block: 'farmland', props: {}, held: 'wheat_seeds' });
    world.set(key(ABOVE), { name: 'stone', stateId: 1, props: {} });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.notClear));
    expect(clicks).toEqual([]);
  });

  it('refuses to sow on farmland of another player, and clicks nothing', async () => {
    ownedBy(TARGET, 'Ada');
    const { bot, clicks } = fakeBot({ block: 'farmland', props: {}, held: 'wheat_seeds' });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.someoneElses));
    expect(clicks).toEqual([]);
  });

  it('refuses to sow a seed on a block that is not farmland', async () => {
    const { bot, clicks } = fakeBot({ block: 'grass_block', props: {}, held: 'wheat_seeds' });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.notUsable));
    expect(clicks).toEqual([]);
  });

  it('grows a wheat crop with bone meal, and reads the change in its state', async () => {
    const { bot, world } = fakeBot({
      block: 'wheat',
      props: { age: 2 },
      held: 'bone_meal',
      onClick: (pos, w) => {
        const stored = w.get(key(pos));
        if (stored) stored.stateId += 1;
      },
    });
    const outcome = await use(bot);
    expect(world.get(key(TARGET))?.stateId).toBe(2);
    expect(outcome).toEqual(completed({ block: 'wheat', at: { x: 2, y: 64, z: 0 } }));
  });

  it('refuses bone meal on a block that is not a crop, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot({ block: 'stone', held: 'bone_meal' });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', USE_MESSAGE.notUsable));
    expect(clicks).toEqual([]);
  });
});

describe('use: refusal texts state the block, and point at no verb', () => {
  it('refuses a bed with exactly the block fact, and clicks nothing', async () => {
    const { bot, clicks } = fakeBot({ block: 'white_bed', held: 'wheat_seeds' });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', 'that block is a bed'));
    expect(clicks).toEqual([]);
  });

  it('names the block class for a sign, a container and a redstone device', () => {
    expect(USE_MESSAGE.sign).toBe('that block is a sign');
    expect(USE_MESSAGE.container).toBe('that block is a container');
    expect(USE_MESSAGE.redstone).toBe('that block is a redstone device');
  });

  it('no USE_MESSAGE value names another verb, a harness word or the body', () => {
    for (const text of Object.values(USE_MESSAGE)) {
      expect(text).not.toMatch(/verb|edit_sign|sleep verb|body|not ready/);
    }
  });
});

describe('use: the refused block classes', () => {
  it.each([
    ['chest', USE_MESSAGE.container],
    ['trapped_chest', USE_MESSAGE.container],
    ['barrel', USE_MESSAGE.container],
    ['furnace', USE_MESSAGE.container],
    ['hopper', USE_MESSAGE.container],
    ['brewing_stand', USE_MESSAGE.container],
    ['red_shulker_box', USE_MESSAGE.container],
    ['anvil', USE_MESSAGE.container],
    ['enchanting_table', USE_MESSAGE.container],
    ['lectern', USE_MESSAGE.container],
    ['white_bed', USE_MESSAGE.bed],
    ['oak_sign', USE_MESSAGE.sign],
    ['oak_wall_sign', USE_MESSAGE.sign],
    ['repeater', USE_MESSAGE.redstone],
    ['comparator', USE_MESSAGE.redstone],
    ['note_block', USE_MESSAGE.redstone],
    ['daylight_detector', USE_MESSAGE.redstone],
    ['target', USE_MESSAGE.redstone],
  ])('refuses a use of %s, and clicks nothing', async (block, message) => {
    const { bot, clicks } = fakeBot({ block, held: 'wheat_seeds' });
    const outcome = await use(bot);
    expect(outcome).toEqual(failed('not_possible', message));
    expect(clicks).toEqual([]);
  });

  it('keeps an iron trapdoor and a stone button usable, and a fence gate too', async () => {
    for (const block of ['oak_trapdoor', 'stone_button', 'oak_fence_gate']) {
      const { bot, clicks } = fakeBot({ block, props: { open: false }, onClick: toggleDoor });
      await use(bot);
      expect(clicks, block).toEqual([block]);
    }
  });
});
