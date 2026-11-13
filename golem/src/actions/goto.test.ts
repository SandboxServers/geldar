import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWorld } from '../perception/perception.fakes.ts';
import { NOT_IN_SIGHT } from './give.ts';
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

  it('reports the dig and place summary as the result note', async () => {
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: true,
      distance: 0.4,
      message: 'dug through one block',
    });
    const outcome = await runGoto(fakeBot(), { x: 20, y: 64, z: 30 });
    expect(outcome.status).toBe('completed');
    expect(outcome.detail).toMatchObject({ note: 'dug through one block' });
  });

  it('walks up to a visible player at range 2 and does not follow', async () => {
    const world = new FakeWorld();
    world.entities[2] = { type: 'player', username: 'Alex', position: new Vec3(0.5, 64, 6.5) };
    await runGoto(world.bot, 'Alex');
    expect(moveNear).toHaveBeenCalledTimes(1);
    const [, aim, range, options] = vi.mocked(moveNear).mock.calls[0] ?? [];
    expect(aim).toMatchObject({ x: 0.5, y: 64, z: 6.5 });
    expect(range).toBe(2);
    expect(options).toMatchObject({ timeScale: 1 });
  });

  it('returns not_found for a player with no entity, without walking', async () => {
    const outcome = await runGoto(new FakeWorld().bot, 'NoSuchPlayer');
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found' });
    expect(moveNear).not.toHaveBeenCalled();
  });

  it('refuses a loaded player behind a wall with the same outcome as an unknown name', async () => {
    const world = new FakeWorld();
    world.entities[2] = { type: 'player', username: 'Alex', position: new Vec3(0.5, 64, 2.5) };
    for (const [x, y] of [
      [0, 64],
      [0, 65],
      [1, 64],
      [1, 65],
    ] as const)
      world.set('stone', x, y, 1);
    // The server's player list knows Alex and carries a loaded entity: goto must not read it.
    (world.bot as unknown as { players: unknown }).players = {
      Alex: { entity: world.entities[2] },
    };
    const walled = await runGoto(world.bot, 'Alex');
    const absent = await runGoto(world.bot, 'Nobody');
    expect(walled).toEqual(absent);
    expect(walled).toMatchObject({ status: 'failed', reason: 'not_found', message: NOT_IN_SIGHT });
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
