import { describe, expect, it, vi } from 'vitest';
import { answerPlanCheck, PLAN_CHECK_CELL_CAP, type PlanCheckBody } from './plan-check-reply.ts';
import { SeenMap } from './seen/section.ts';

const PACK = { stone: 4 };
const FEET = { x: 0, y: 64, z: 0 };

/** A 2 by 2 stone box at the origin: four cells, inclusive. */
const BOX_2X2 = {
  plan: {
    palette: { stone: { block: 'stone' } },
    steps: [{ op: 'box', pal: 'stone', from: { x: 0, y: 64, z: 0 }, to: { x: 1, y: 64, z: 1 } }],
  },
};

/** A body whose map records the given cells as seen; the map's reads are spied on. */
function bodyWith(seenCells: [number, number, number][]): PlanCheckBody & { seen: SeenMap } {
  const seen = new SeenMap();
  for (const [x, y, z] of seenCells) seen.record(x, y, z, 'stone', 10);
  return { seen, pack: () => PACK, feet: () => FEET };
}

describe('answerPlanCheck (the Body dry run)', () => {
  it('counts the cells and the material needs from the seen map and the pack', () => {
    const body = bodyWith([
      [0, 64, 0],
      [1, 64, 0],
      [0, 64, 1],
      [1, 64, 1],
    ]);
    expect(answerPlanCheck(body, BOX_2X2, true)).toEqual({
      cells: 4,
      material_needs: { stone: { need: 4, have: 4 } },
      unknown_cells: 0,
      estimated_ticks: 4,
      invalid_steps: [],
    });
  });

  it('refuses with not_available when the building flag is off, and never reads the map', () => {
    const body = bodyWith([[0, 64, 0]]);
    const read = vi.spyOn(body.seen, 'read');
    expect(answerPlanCheck(body, BOX_2X2, false)).toEqual({ error: 'not_available' });
    expect(read).not.toHaveBeenCalled();
  });

  it('counts a cell never seen as unknown, and the reply carries no coordinates', () => {
    const body = bodyWith([[0, 64, 0]]);
    const answer = answerPlanCheck(body, BOX_2X2, true);
    expect(answer).toMatchObject({ cells: 4, unknown_cells: 3 });
    expect(JSON.stringify(answer)).not.toMatch(/"x"|"y"|"z"/);
  });

  it('refuses a plan over the cell cap as plan_too_large, and stops expanding at the cap', () => {
    const body = bodyWith([]);
    const read = vi.spyOn(body.seen, 'read');
    const huge = {
      plan: {
        palette: { stone: { block: 'stone' } },
        steps: [
          { op: 'box', pal: 'stone', from: { x: 0, y: 64, z: 0 }, to: { x: 999, y: 64, z: 999 } },
        ],
      },
    };
    expect(answerPlanCheck(body, huge, true)).toEqual({ error: 'plan_too_large' });
    expect(read.mock.calls.length).toBeLessThanOrEqual(PLAN_CHECK_CELL_CAP + 1);
  });

  it('lists a step that names a missing palette key as invalid, without counting it', () => {
    const body = bodyWith([]);
    const plan = {
      plan: {
        palette: { stone: { block: 'stone' } },
        steps: [{ op: 'place', pal: 'glass', at: { x: 0, y: 64, z: 0 } }],
      },
    };
    expect(answerPlanCheck(body, plan, true)).toMatchObject({
      cells: 0,
      invalid_steps: [{ index: 0, reason: 'unknown_palette_key' }],
    });
  });

  it('refuses an input the contract does not accept as invalid_input', () => {
    expect(answerPlanCheck(bodyWith([]), { plan: 'nope' }, true)).toEqual({
      error: 'invalid_input',
    });
  });
});
