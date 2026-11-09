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
});

describe('walkOutOfHazard', () => {
  it('walks with the pathfinder at the time scale, then steers with jump held until out', async () => {
    const { bot, controls, state } = controlBot();
    await walkOutOfHazard(walkFor(bot, () => state.ticks >= 2));
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0]?.[3]).toMatchObject({ timeScale: 2, stallTicks: 40 });
    expect(controls).toContain('forward:true');
    expect(controls).toContain('jump:true');
    expect(controls.slice(-2)).toEqual(['forward:false', 'jump:false']);
    expect(state.ticks).toBe(2);
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
