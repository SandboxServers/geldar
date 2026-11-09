import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gotoAction, targetOf } from './goto.ts';
import type { ActionOutcome } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext } from './registry.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

/** A fake bot with the parts `goto` reads: its position and the player list. */
function fakeBot(players: Record<string, { entity: { position: Vec3 } }> = {}): Bot {
  return {
    entity: { position: new Vec3(10, 64, 10) },
    players,
  } as unknown as Bot;
}

function ctxFor(bot: Bot, signal = new AbortController().signal): ActionContext {
  return { bot, signal, timeScale: 1 };
}

async function runGoto(
  bot: Bot,
  target: { x: number; y: number; z: number } | string,
): Promise<ActionOutcome> {
  return gotoAction.run(ctxFor(bot), { do: 'goto', target });
}

describe('targetOf', () => {
  it('reads a position as a plain position', () => {
    expect(targetOf({ target: { x: 3, y: 64, z: -7 } })).toEqual({
      kind: 'position',
      x: 3,
      y: 64,
      z: -7,
    });
  });

  it('reads a string as a player name', () => {
    expect(targetOf({ target: 'Alex' })).toEqual({ kind: 'player', name: 'Alex' });
  });
});

describe('gotoAction', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0.4 });
  });

  it('walks to the block center with range 1', async () => {
    const bot = fakeBot();
    await runGoto(bot, { x: 20, y: 64, z: 30 });
    expect(moveNear).toHaveBeenCalledWith(
      bot,
      { x: 20.5, y: 64, z: 30.5 },
      1,
      expect.objectContaining({ timeScale: 1 }),
    );
  });

  it('walks up to a player at range 2 and does not follow', async () => {
    const bot = fakeBot({ Alex: { entity: { position: new Vec3(5, 64, 6) } } });
    await runGoto(bot, 'Alex');
    expect(moveNear).toHaveBeenCalledTimes(1);
    expect(moveNear).toHaveBeenCalledWith(
      bot,
      { x: 5, y: 64, z: 6 },
      2,
      expect.objectContaining({ timeScale: 1 }),
    );
  });

  it('returns not_found for a player with no entity, without walking', async () => {
    const outcome = await runGoto(fakeBot(), 'NoSuchPlayer');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found' });
    expect(moveNear).not.toHaveBeenCalled();
  });

  it('completes with the final position and the distance from the move', async () => {
    const outcome = await runGoto(fakeBot(), { x: 20, y: 64, z: 30 });
    expect(outcome).toEqual({
      status: 'completed',
      detail: { position: { x: 10, y: 64, z: 10 }, distance: 0.4 },
    });
  });

  it.each([
    ['blocked', 'blocked'],
    ['timeout', 'timeout'],
    ['interrupted', 'interrupted'],
  ] as const)('maps a %s move to a failed %s', async (reason, expected) => {
    vi.mocked(moveNear).mockResolvedValue({ ok: false, reason, message: 'move ended' });
    expect(await runGoto(fakeBot(), { x: 20, y: 64, z: 30 })).toMatchObject({
      status: 'failed',
      reason: expected,
    });
  });

  it('maps a cancelled move to a cancelled outcome', async () => {
    vi.mocked(moveNear).mockResolvedValue({ ok: false, reason: 'cancelled', message: 'stopped' });
    expect(await runGoto(fakeBot(), { x: 20, y: 64, z: 30 })).toEqual({
      status: 'cancelled',
      detail: {},
    });
  });
});
