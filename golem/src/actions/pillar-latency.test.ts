import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBlock, realBlock, registry } from './door-blocks.fakes.ts';
import {
  AIR,
  block,
  type FakeBlock,
  type Scene,
  type State,
  scriptedBot,
} from './escape-ladder.fakes.ts';
import { moveNear } from './pathing.ts';
import { placeAction } from './place.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** prismarine-physics as mineflayer runs it (golem does not declare it). */
const fromMineflayer = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const { Physics } = fromMineflayer('prismarine-physics') as {
  Physics: (
    mcData: unknown,
    world: unknown,
  ) => {
    simulatePlayer(
      state: unknown,
      world: unknown,
    ): Record<string, unknown> & { pos: Vec3; onGround: boolean };
  };
};

/** The cell the bot's feet are in: the dirt goes here, on the stone at (0,63,0). */
const PLACED_AT = '0,64,0';
const UNCONFIRMED = 'the block did not appear at the target';
const NO_CONTROLS = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false,
};

const keyOf = (v: Vec3) => `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;

/** The scene's blocks as the real block states prismarine-physics reads. */
function physicsWorld(scene: Scene) {
  return {
    getBlock(pos: Vec3) {
      const fake: FakeBlock = scene.blocks?.[keyOf(pos)] ?? AIR;
      const real = defaultBlock(fake.name) as unknown as { position: Vec3 };
      real.position = pos.clone();
      return real;
    },
  };
}

/** Steps the bot on real prismarine physics each tick the scene ticks, reading its jump control. */
function realPhysics(scene: Scene): (s: State) => void {
  const world = physicsWorld(scene);
  const physics = Physics(registry, world);
  let state: Record<string, unknown> | undefined;
  return (s) => {
    state ??= {
      pos: s.position.clone(),
      vel: new Vec3(0, 0, 0),
      onGround: true,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      elytraFlying: false,
      jumpTicks: 0,
      jumpQueued: false,
      fireworkRocketDuration: 0,
      jumpBoost: 0,
      speed: 0,
      attributes: {},
      yaw: 0,
      pitch: 0,
      control: NO_CONTROLS,
    };
    state.control = { ...NO_CONTROLS, jump: s.controls.jump === true };
    const out = physics.simulatePlayer(state, world);
    state = { ...state, ...out };
    s.position.set(out.pos.x, out.pos.y, out.pos.z);
    (s.entity as { onGround?: boolean }).onGround = out.onGround;
  };
}

/**
 * A bot on real physics whose server answers a placement after `ticks` ticks, as mineflayer's
 * `placeBlock` resolves on the block update: `answer` writes that update into the scene.
 */
function serverFake(ticks: number, answer: (scene: Scene) => void, placeError?: Error) {
  const scene: Scene = { items: ['dirt'], blocks: { '0,63,0': block('stone') } };
  scene.physics = realPhysics(scene);
  const fake = scriptedBot(scene);
  // The real registry gives the dirt's default state; the world takes state ids as mineflayer's does.
  Object.assign(fake.bot, {
    registry,
    world: {
      setBlockStateId(pos: Vec3, stateId: number) {
        scene.blocks = {
          ...scene.blocks,
          [keyOf(pos)]: realBlock(stateId) as unknown as FakeBlock,
        };
      },
    },
  });
  Object.assign(fake.bot.entity, { onGround: true });
  fake.bot.placeBlock.mockImplementation(async () => {
    // Each call of the scripted wait is one tick of the scene's physics.
    for (let i = 0; i < ticks; i++) await fake.bot.waitForTicks();
    if (placeError) throw placeError;
    answer(scene);
  });
  return fake;
}

const pillar = (fake: ReturnType<typeof serverFake>) =>
  placeAction.run(
    { bot: fake.asBot, signal: new AbortController().signal, timeScale: 1 },
    { do: 'place', block: 'dirt', at: 'feet' },
  );

const dirtUpdate = (scene: Scene) => {
  scene.blocks = { ...scene.blocks, [PLACED_AT]: block('dirt') };
};

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
});

describe('pillar against a late block update (real prismarine physics)', () => {
  it.each([0, 4, 6, 8, 10])(
    'lands on the dirt when the server answers after %i ticks',
    async (ticks) => {
      const fake = serverFake(ticks, dirtUpdate);
      const outcome = await pillar(fake);
      expect(outcome).toMatchObject({ status: 'completed' });
      expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
    },
  );

  it('refuses with the unconfirmed message when the placement resolves but the cell is air', async () => {
    const fake = serverFake(3, (scene) => {
      scene.blocks = { ...scene.blocks, [PLACED_AT]: AIR };
    });
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked', message: UNCONFIRMED });
  });

  // Mineflayer's own texts, as the placement throws them: they carry coordinates, ms and event names.
  it.each([
    [
      'a refusal that names the block still there',
      'Server refused to place dirt at (0, 64, 0): the block is still stone',
      'the server did not place the block: it is still stone',
    ],
    [
      'a refusal whose block name has underscores',
      'Server refused to place dirt at (0, 64, 0): the block is still oak_planks',
      'the server did not place the block: it is still oak planks',
    ],
    [
      'a placement the server never answered',
      'Server did not answer the placement at (0, 64, 0): Event blockUpdate:(0,64,0) did not fire within timeout of 5000ms',
      'the server did not answer the placement',
    ],
    [
      'an error that is neither a refusal nor a timeout',
      'Connection reset at (0, 64, 0) after 3 tries',
      'the server did not place the block',
    ],
  ])('says %s in plain words, with no coordinates or library text', async (_, raw, message) => {
    const fake = serverFake(3, () => undefined, new Error(raw));
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked', message });
    const text = (outcome as { message: string }).message;
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain('(');
    expect(text.length).toBeLessThan(160);
  });
});

/** Mineflayer's unforced look turns at most this far a tick, and finishes when it arrives. */
const TURN_PER_TICK = 0.15;
/** Where placeBlock aims for the block under the cell (0, 63, 0): the top face's centre. */
const FACE_OF_STONE = new Vec3(0.5, 64, 0.5);

/** The yaw mineflayer's lookAt sets for a point: atan2(-dx, -dz). */
const yawTo = (from: Vec3, to: Vec3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
/** The turn between two yaws, the short way round. */
const turnBetween = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

/**
 * A bot with mineflayer's turning: a forced look sets the yaw at once, an unforced one turns
 * `TURN_PER_TICK` a tick. The fake placeBlock first turns unforced to the face centre, as mineflayer
 * does, and then sends: the server refuses while the feet are under a block up, because the bot's own
 * box still fills the cell.
 */
function turningBot(start: Vec3) {
  const fake = serverFake(0, dirtUpdate);
  fake.state.position.set(start.x, start.y, start.z);
  let yaw = 0;
  const turnTo = async (point: Vec3, force: boolean | undefined) => {
    const target = yawTo(fake.state.position, point);
    if (force) {
      yaw = target;
      return;
    }
    const ticks = Math.ceil(turnBetween(yaw, target) / TURN_PER_TICK);
    for (let i = 0; i < ticks; i++) await fake.bot.waitForTicks();
    yaw = target;
  };
  fake.bot.lookAt.mockImplementation(async (...args: unknown[]) => {
    await turnTo(args[0] as Vec3, args[1] === true);
    return undefined;
  });
  fake.bot.placeBlock.mockImplementation(async () => {
    await turnTo(FACE_OF_STONE, false);
    if (fake.state.position.y - 64 < 1) {
      throw new Error('Server refused to place dirt at (0, 64, 0): the block is still air');
    }
    dirtUpdate(fake.state.scene);
  });
  return fake;
}

describe('pillar aims before it jumps (mineflayer turns at 0.15 rad a tick)', () => {
  // Tommy: 0.2 east and 0.2 north of the cell centre, a 0.785 rad turn to the face.
  it('places from a diagonal start, before the bot is a block up', async () => {
    const fake = turningBot(new Vec3(0.7, 64, 0.3));
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
  });

  // Trini: 0.2 west of the cell centre, a quarter turn to the face.
  it('places from a quarter-turn start, before the bot is a block up', async () => {
    const fake = turningBot(new Vec3(0.3, 64, 0.5));
    const outcome = await pillar(fake);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(fake.state.position.y - 64).toBeGreaterThanOrEqual(0.9);
  });
});
