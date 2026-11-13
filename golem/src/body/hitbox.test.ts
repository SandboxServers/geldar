import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { defaultBlock, registry } from '../actions/door-blocks.fakes.ts';
import { matchServerHitbox } from './hitbox.ts';

/** prismarine-physics as mineflayer runs it (golem does not declare it). */
const fromMineflayer = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const { Physics } = fromMineflayer('prismarine-physics') as {
  Physics: (mcData: unknown, world: unknown) => PhysicsLike;
};

interface PhysicsLike {
  playerHalfWidth: number;
  simulatePlayer(state: unknown, world: unknown): Record<string, unknown> & { pos: Vec3 };
}

/** A bot with an EventEmitter for its events and a physics slot filled later, as mineflayer does. */
function fakeBot(physics?: PhysicsLike): Bot {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { physics }) as unknown as Bot;
}

function fakePhysics(): PhysicsLike {
  return { playerHalfWidth: 0.3, simulatePlayer: () => ({ pos: new Vec3(0, 0, 0) }) };
}

describe('matchServerHitbox', () => {
  it('sets the server half-width on a bot whose physics already exists', () => {
    const physics = fakePhysics();
    matchServerHitbox(fakeBot(physics));
    expect(physics.playerHalfWidth).toBe(Math.fround(0.6) / 2);
    expect(physics.playerHalfWidth).toBe(0.30000001192092896);
  });

  it('sets it on a bot whose physics is assigned later, on inject_allowed', () => {
    const bot = fakeBot();
    matchServerHitbox(bot);
    const physics = fakePhysics();
    (bot as unknown as { physics: PhysicsLike }).physics = physics;
    expect(physics.playerHalfWidth).toBe(0.3);
    bot.emit('inject_allowed');
    expect(physics.playerHalfWidth).toBe(Math.fround(0.6) / 2);
  });

  it('is idempotent per bot: a second call adds no listener', () => {
    const bot = fakeBot();
    matchServerHitbox(bot);
    matchServerHitbox(bot);
    expect(bot.listenerCount('inject_allowed')).toBe(1);
  });
});

/** Dirt floor at y 59 under x 317..319, a dirt wall block at (318, 60, 319): its z=319 face is the wall. */
function world() {
  const dirt = (pos: Vec3) => {
    const block = defaultBlock('dirt') as unknown as { shapes: number[][]; position: Vec3 };
    block.position = pos;
    return block;
  };
  const air = (pos: Vec3) => {
    const block = defaultBlock('air') as unknown as { shapes: number[][]; position: Vec3 };
    block.position = pos;
    return block;
  };
  return {
    getBlock(pos: Vec3) {
      const solid =
        pos.y === 59
          ? pos.x >= 317 && pos.x <= 319
          : pos.x === 318 && pos.y === 60 && pos.z === 319;
      return solid ? dirt(pos.clone()) : air(pos.clone());
    },
  };
}

/** Walks a player forward (+z, yaw 0) from z 318.5 for `ticks` ticks on the real prismarine physics. */
function walkIntoFace(physics: PhysicsLike, ticks: number): Vec3 {
  const w = world();
  let state: Record<string, unknown> = {
    pos: new Vec3(318.5, 60, 318.5),
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
    yaw: Math.PI,
    pitch: 0,
    control: {
      forward: true,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false,
    },
  };
  for (let i = 0; i < ticks; i++) {
    const out = physics.simulatePlayer(state, w);
    state = { ...state, ...out };
  }
  return state.pos as Vec3;
}

describe('server hitbox against real prismarine physics', () => {
  // The server box is pos.z + half-width, and Paper rejects any overlap with the block at z 319.
  const FACE = 319;

  it('stops a walking player flush with the face once the server half-width is set', () => {
    const real = Physics(registry, world()) as unknown as PhysicsLike;
    matchServerHitbox(fakeBot(real));
    const pos = walkIntoFace(real, 80);
    // Reached the face (not walked off the other way), then held flush.
    expect(pos.z).toBeGreaterThan(318.6);
    expect(pos.z + Math.fround(0.3)).toBeLessThanOrEqual(FACE);
  });

  it('control: prismarine default 0.3 leaves the server box 1.19e-8 inside the face', () => {
    const real = Physics(registry, world()) as unknown as PhysicsLike;
    expect(real.playerHalfWidth).toBe(0.3);
    const pos = walkIntoFace(real, 80);
    expect(pos.z + Math.fround(0.3)).toBeGreaterThan(FACE);
  });
});
