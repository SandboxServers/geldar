import { describe, expect, it, vi } from 'vitest';
import {
  answerPlanCheck,
  PLAN_CHECK_CELL_CAP,
  type PlanCheckBody,
  planCheckFrom,
} from './plan-check-reply.ts';
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

/** A single-row stone box along x at y 64, `count` cells long. */
function lineBox(count: number) {
  return {
    plan: {
      palette: { stone: { block: 'stone' } },
      steps: [
        { op: 'box', pal: 'stone', from: { x: 0, y: 64, z: 0 }, to: { x: count - 1, y: 64, z: 0 } },
      ],
    },
  };
}

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

  it('answers a plan of exactly the cell cap, and refuses one cell more as plan_too_large', () => {
    expect(answerPlanCheck(bodyWith([]), lineBox(PLAN_CHECK_CELL_CAP), true)).toMatchObject({
      cells: PLAN_CHECK_CELL_CAP,
    });
    expect(answerPlanCheck(bodyWith([]), lineBox(PLAN_CHECK_CELL_CAP + 1), true)).toEqual({
      error: 'plan_too_large',
    });
  });

  it('resolves origin here from the feet cell by floor: x 10.7 and z -0.3 are cell (10, -1)', () => {
    const seen = new SeenMap();
    seen.record(10, 64, -1, 'stone', 10);
    const bot = {
      inventory: { items: () => [] },
      entity: { position: { x: 10.7, y: 64.2, z: -0.3 } },
    };
    const plan = {
      plan: {
        palette: { stone: { block: 'stone' } },
        origin: 'here',
        steps: [{ op: 'place', pal: 'stone', at: { x: 0, y: 0, z: 0 } }],
      },
    };
    expect(planCheckFrom(seen, bot)(plan)).toMatchObject({ cells: 1, unknown_cells: 0 });
    expect(planCheckFrom(new SeenMap(), bot)(plan)).toMatchObject({
      unknown_cells: 1,
    });
  });

  it('lists at most 256 invalid steps, the first by index, and still counts every cell', () => {
    const steps = Array.from({ length: 300 }, () => ({
      op: 'place',
      pal: 'glass',
      at: { x: 0, y: 64, z: 0 },
    }));
    const answer = answerPlanCheck(
      bodyWith([]),
      { plan: { palette: { stone: { block: 'stone' } }, steps } },
      true,
    );
    expect(answer).toMatchObject({ cells: 0 });
    expect((answer as { invalid_steps: { index: number }[] }).invalid_steps).toHaveLength(256);
    expect((answer as { invalid_steps: { index: number }[] }).invalid_steps[255]?.index).toBe(255);
  });

  it('refuses a sphere of radius 1,000,000 and a wall of length 60,000,000 at once, as plan_too_large', () => {
    // Relative steps (an origin is given), so the validator's absolute height and border limits do not apply.
    const sphere = {
      plan: {
        palette: { stone: { block: 'stone' } },
        origin: { x: 0, y: 64, z: 0 },
        steps: [{ op: 'sphere', pal: 'stone', center: { x: 0, y: 0, z: 0 }, radius: 1_000_000 }],
      },
    };
    const wall = {
      plan: {
        palette: { stone: { block: 'stone' } },
        origin: { x: 0, y: 64, z: 0 },
        steps: [
          {
            op: 'wall',
            pal: 'stone',
            from: { x: -30_000_000, y: 0, z: 0 },
            to: { x: 30_000_000, y: 0, z: 0 },
            height: 1,
          },
        ],
      },
    };
    for (const request of [sphere, wall]) {
      const started = performance.now();
      expect(answerPlanCheck(bodyWith([]), request, true)).toEqual({ error: 'plan_too_large' });
      expect(performance.now() - started).toBeLessThan(200);
    }
  });

  it('refuses an input the contract does not accept as invalid_input', () => {
    expect(answerPlanCheck(bodyWith([]), { plan: 'nope' }, true)).toEqual({
      error: 'invalid_input',
    });
  });
});
