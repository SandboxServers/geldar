import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveNear } from '../../actions/pathing.ts';
import { fakeBot } from '../body.fakes.ts';
import { type EscapeWalk, swimUp, walkOutOfHazard } from './hazard-escape.ts';

vi.mock('../../actions/pathing.ts', () => ({ moveNear: vi.fn() }));

const move = vi.mocked(moveNear);

beforeEach(() => {
  move.mockReset();
  move.mockResolvedValue({ ok: true, distance: 1 });
});

/** A bot that logs its control states and counts the ticks it waited. */
function controlBot(at = new Vec3(0.5, 64, 0.5)) {
  const bot = fakeBot() as unknown as Record<string, unknown>;
  const controls: string[] = [];
  const state = { ticks: 0 };
  (bot.entity as { position: Vec3 }).position = at;
  bot.setControlState = (name: string, on: boolean) => controls.push(`${name}:${on}`);
  bot.lookAt = async () => undefined;
  bot.waitForTicks = async () => {
    state.ticks += 1;
  };
  return { bot: bot as never, controls, state };
}

function walkFor(bot: never, reachedAfter: () => boolean, extra: Partial<EscapeWalk> = {}) {
  return {
    bot,
    target: { x: 3, y: 64, z: 0 },
    signal: new AbortController().signal,
    timeScale: 2,
    expired: () => false,
    reached: reachedAfter,
    ...extra,
  } as EscapeWalk;
}

describe('swimUp', () => {
  it('holds jump until the Body is out of the water, then lets go', async () => {
    const { bot, controls, state } = controlBot();
    await swimUp(walkFor(bot, () => state.ticks >= 3));
    expect(controls).toEqual(['jump:true', 'jump:false']);
    expect(state.ticks).toBe(3);
  });

  it('stops on abort and on expiry, and releases jump', async () => {
    const aborted = controlBot();
    const controller = new AbortController();
    controller.abort();
    await swimUp(walkFor(aborted.bot, () => false, { signal: controller.signal }));
    expect(aborted.controls).toEqual(['jump:true', 'jump:false']);
    expect(aborted.state.ticks).toBe(0);

    const expired = controlBot();
    await swimUp(walkFor(expired.bot, () => false, { expired: () => true }));
    expect(expired.controls.at(-1)).toBe('jump:false');
    expect(expired.state.ticks).toBe(0);
  });

  it('steers west out from under a ceiling to the open column, then rises', async () => {
    // Water at y 58..59 under a stone ceiling at y 60 over x 0; x -1 is open water up to y 60.
    const { bot, controls, state } = controlBot(new Vec3(0.5, 58.2, 0.5));
    (bot as unknown as { blockAt: (v: Vec3) => unknown }).blockAt = (v: Vec3) =>
      v.x === 0 && v.y === 60 && v.z === 0
        ? { name: 'stone', boundingBox: 'block' }
        : { name: 'water', boundingBox: 'empty' };
    const entity = bot as unknown as { entity: { position: Vec3 } };
    (bot as unknown as { waitForTicks: () => Promise<void> }).waitForTicks = async () => {
      state.ticks += 1;
      if (controls.includes('forward:true')) {
        entity.entity.position = entity.entity.position.offset(-0.5, 0, 0);
      }
    };
    await swimUp(walkFor(bot, () => state.ticks >= 6));
    expect(controls[0]).toBe('jump:true');
    expect(controls).toContain('forward:true');
    expect(controls.at(-2)).toBe('forward:false');
    expect(controls.at(-1)).toBe('jump:false');
    expect(entity.entity.position.x).toBeLessThan(0);
  });

  it('steers north (-z) to the open column under a ceiling, aiming at its centre', async () => {
    // Stone ceiling at y 60 over x -1..1, z -1..1, except the open column at (0, -1): north is the only way out.
    const { bot, controls, state } = controlBot(new Vec3(0.5, 58.2, 0.5));
    const aims: Vec3[] = [];
    const ceiling = (v: Vec3) =>
      v.y === 60 && Math.abs(v.x) <= 1 && Math.abs(v.z) <= 1 && !(v.x === 0 && v.z === -1);
    (bot as unknown as { blockAt: (v: Vec3) => unknown }).blockAt = (v: Vec3) =>
      ceiling(v)
        ? { name: 'stone', boundingBox: 'block' }
        : { name: 'water', boundingBox: 'empty' };
    const entity = bot as unknown as { entity: { position: Vec3 } };
    (bot as unknown as { lookAt: (v: Vec3) => Promise<void> }).lookAt = async (v: Vec3) => {
      aims.push(v);
    };
    (bot as unknown as { waitForTicks: () => Promise<void> }).waitForTicks = async () => {
      state.ticks += 1;
      if (controls.includes('forward:true')) {
        entity.entity.position = entity.entity.position.offset(0, 0, -0.5);
      }
    };
    await swimUp(walkFor(bot, () => state.ticks >= 2));
    expect(controls).toContain('forward:true');
    expect(aims.length).toBeGreaterThan(0);
    expect(aims.every((aim) => aim.x === 0.5 && aim.z === -0.5)).toBe(true);
    expect(entity.entity.position.z).toBeLessThan(0.5);
  });

  it('keeps jump held on a physics tick that follows a control reset', async () => {
    const { bot, controls, state } = controlBot();
    (bot as unknown as { waitForTicks: () => Promise<void> }).waitForTicks = async () => {
      state.ticks += 1;
      (bot as unknown as { emit(name: string): boolean }).emit('physicsTick');
    };
    await swimUp(walkFor(bot, () => state.ticks >= 3));
    expect(controls.filter((c) => c === 'jump:true').length).toBeGreaterThanOrEqual(3);
    expect(controls.at(-1)).toBe('jump:false');
  });
});

describe('walkOutOfHazard', () => {
  it('walks with the pathfinder at the time scale, then steers with jump held until out', async () => {
    const { bot, controls, state } = controlBot();
    await walkOutOfHazard(walkFor(bot, () => state.ticks >= 2));
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0]?.[3]).toMatchObject({ digTier: false, timeScale: 2, stallTicks: 40 });
    expect(controls).toContain('forward:true');
    expect(controls).toContain('jump:true');
    expect(controls.slice(-2)).toEqual(['forward:false', 'jump:false']);
    expect(state.ticks).toBe(2);
  });

  it('holds jump on each physics tick while the Body is in water, during the pathfinder walk', async () => {
    const { bot, controls } = controlBot();
    (bot as unknown as { entity: { isInWater: boolean } }).entity.isInWater = true;
    move.mockImplementationOnce(async () => {
      (bot as unknown as { emit(name: string): boolean }).emit('physicsTick');
      return { ok: true, distance: 1 };
    });
    await walkOutOfHazard(walkFor(bot, () => true));
    expect(controls).toEqual(['jump:true', 'forward:false', 'jump:false']);
  });

  it('does not hold jump on physics ticks when the Body is out of the water', async () => {
    const { bot, controls } = controlBot();
    move.mockImplementationOnce(async () => {
      (bot as unknown as { emit(name: string): boolean }).emit('physicsTick');
      return { ok: true, distance: 1 };
    });
    await walkOutOfHazard(walkFor(bot, () => true));
    expect(controls).toEqual(['forward:false', 'jump:false']);
  });

  it('does not steer into lava the Body is not already in', async () => {
    const { bot, controls, state } = controlBot();
    (bot as unknown as { blockAt: () => unknown }).blockAt = () => ({
      name: 'lava',
      boundingBox: 'empty',
    });
    await walkOutOfHazard(walkFor(bot, () => false));
    expect(controls).not.toContain('forward:true');
    expect(state.ticks).toBe(0);
    expect(controls.slice(-2)).toEqual(['forward:false', 'jump:false']);
  });
});
