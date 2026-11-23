import { describe, expect, it, vi } from 'vitest';
import { BUILDING_REFUSAL } from '../building/names.ts';
import { planHandler } from '../building/queue-action.ts';
import { breakHandler } from './break.ts';
import { allActions } from './index.ts';
import { ctxFor, fakeBot } from './mine.fakes.ts';
import { MINE_CELL_MESSAGE } from './mine-cell.ts';
import { failed } from './outcome.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

// The plan handler reads only the action; with no queue it throws, as before BLD-14 wired one.
const NO_CONTEXT = {} as never;
const BREAK = { do: 'break', at: { x: 0, y: 64, z: 0 } } as never;
const PLAN = { do: 'plan', op: 'cancel', plan_id: 'all' } as never;

describe('break and plan with body_actions.building (BLD-06 break, BLD-14 plan)', () => {
  it('the Body action list registers break and plan', () => {
    const kinds = allActions.map((handler) => handler.kind);
    expect(kinds).toContain('break');
    expect(kinds).toContain('plan');
  });

  it('break is refused with the neutral message while the flag is off, and digs nothing', async () => {
    const bot = fakeBot([]);
    await expect(breakHandler(false).run(ctxFor(bot), BREAK)).resolves.toEqual(
      failed('not_possible', BUILDING_REFUSAL),
    );
    expect(bot.blockAt).not.toHaveBeenCalled();
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('plan is refused with the same message while the flag is off', async () => {
    await expect(planHandler(false).run(NO_CONTEXT, PLAN)).resolves.toEqual(
      failed('not_possible', BUILDING_REFUSAL),
    );
  });

  it('with the flag on, break reaches the real handler: a cell with no loaded block is refused as not loaded', async () => {
    const bot = fakeBot([]);
    await expect(breakHandler(true).run(ctxFor(bot), BREAK)).resolves.toEqual(
      failed('not_possible', MINE_CELL_MESSAGE.notLoaded),
    );
    expect(bot.dig).not.toHaveBeenCalled();
  });

  it('with the flag on and no queue, plan still reaches its stub and throws not_implemented', async () => {
    await expect(planHandler(true).run(NO_CONTEXT, PLAN)).rejects.toThrow('not_implemented: plan');
  });
});
