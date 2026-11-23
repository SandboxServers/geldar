import { expandPlan, tallyMaterials } from '@geldar/player-core/src/building/index.ts';
import { describe, expect, it, vi } from 'vitest';
import { answerPlanCheck, type PlanCheckBody, planCheckFrom } from './plan-check-reply.ts';
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

/** A sphere of radius 120 about (0, 64, 0): the large plan the walk must stream. */
const SPHERE_120 = {
  plan: {
    palette: { stone: { block: 'stone' } },
    origin: { x: 0, y: 64, z: 0 },
    steps: [{ op: 'sphere', pal: 'stone', center: { x: 0, y: 0, z: 0 }, radius: 120 }],
  },
};

/** A body whose map records the given cells as seen. */
function bodyWith(seenCells: [number, number, number][]): PlanCheckBody & { seen: SeenMap } {
  const seen = new SeenMap();
  for (const [x, y, z] of seenCells) seen.record(x, y, z, 'stone', 10);
  return { seen, pack: () => PACK, feet: () => FEET };
}

/** Lattice points of the solid disc at height dy of a sphere of radius r (x and z, counted per column). */
function solidSphereLayerCells(r: number, dy: number): number {
  let count = 0;
  for (let dx = -r; dx <= r; dx++) {
    const rest = r * r - dx * dx - dy * dy;
    if (rest >= 0) count += 2 * Math.floor(Math.sqrt(rest)) + 1;
  }
  return count;
}

/** Lattice points of a solid sphere of radius r: the closed-form sum of its layers. */
function solidSphereCells(r: number): number {
  let total = 0;
  for (let dy = -r; dy <= r; dy++) total += solidSphereLayerCells(r, dy);
  return total;
}

/** A map that answers "never seen" for every cell and counts its reads (no allocation per cell). */
function countingBody(extra: Partial<PlanCheckBody> = {}): {
  body: PlanCheckBody;
  reads: () => number;
} {
  let count = 0;
  const seen = {
    read: () => {
      count++;
      return undefined;
    },
  } as unknown as SeenMap;
  return {
    body: { seen, pack: () => PACK, feet: () => FEET, ...extra },
    reads: () => count,
  };
}

describe('answerPlanCheck (the Body dry run)', () => {
  it('counts the cells and the material needs from the seen map and the pack', async () => {
    const body = bodyWith([
      [0, 64, 0],
      [1, 64, 0],
      [0, 64, 1],
      [1, 64, 1],
    ]);
    expect(await answerPlanCheck(body, BOX_2X2, true)).toEqual({
      cells: 4,
      material_needs: { stone: { need: 4, have: 4 } },
      unknown_cells: 0,
      estimated_ticks: 4,
      invalid_steps: [],
    });
  });

  it('refuses with not_available when the building flag is off, and never reads the map', async () => {
    const { body, reads } = countingBody();
    expect(await answerPlanCheck(body, BOX_2X2, false)).toEqual({ error: 'not_available' });
    expect(reads()).toBe(0);
  });

  it('counts a cell never seen as unknown, and the reply carries no coordinates', async () => {
    const body = bodyWith([[0, 64, 0]]);
    const answer = await answerPlanCheck(body, BOX_2X2, true);
    expect(answer).toMatchObject({ cells: 4, unknown_cells: 3 });
    expect(JSON.stringify(answer)).not.toMatch(/"x"|"y"|"z"/);
  });

  it('lists a step that names a missing palette key as invalid, without counting it', async () => {
    const plan = {
      plan: {
        palette: { stone: { block: 'stone' } },
        steps: [{ op: 'place', pal: 'glass', at: { x: 0, y: 64, z: 0 } }],
      },
    };
    expect(await answerPlanCheck(bodyWith([]), plan, true)).toMatchObject({
      cells: 0,
      invalid_steps: [{ index: 0, reason: 'unknown_palette_key' }],
    });
  });

  it('resolves origin here from the feet cell by floor: x 10.7 and z -0.3 are cell (10, -1)', async () => {
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
    expect(await planCheckFrom(seen, bot)(plan)).toMatchObject({ cells: 1, unknown_cells: 0 });
    expect(await planCheckFrom(new SeenMap(), bot)(plan)).toMatchObject({ unknown_cells: 1 });
  });

  it('lists at most 256 invalid steps, the first by index, and still counts every cell', async () => {
    const steps = Array.from({ length: 300 }, () => ({
      op: 'place',
      pal: 'glass',
      at: { x: 0, y: 64, z: 0 },
    }));
    const answer = await answerPlanCheck(
      bodyWith([]),
      { plan: { palette: { stone: { block: 'stone' } }, steps } },
      true,
    );
    expect(answer).toMatchObject({ cells: 0 });
    expect((answer as { invalid_steps: { index: number }[] }).invalid_steps).toHaveLength(256);
    expect((answer as { invalid_steps: { index: number }[] }).invalid_steps[255]?.index).toBe(255);
  });

  it('refuses an input the contract does not accept as invalid_input', async () => {
    expect(await answerPlanCheck(bodyWith([]), { plan: 'nope' }, true)).toEqual({
      error: 'invalid_input',
    });
  });

  it('answers a radius-120 sphere, never holding more than one layer, and yields between slices', async () => {
    const layers: number[] = [];
    const sizes: number[] = [];
    const { body, reads } = countingBody({
      layers: {
        onLayer: (y, size) => {
          layers.push(y);
          sizes.push(size);
        },
      },
    });
    const yields = vi.spyOn(globalThis, 'setImmediate');
    try {
      const answer = await answerPlanCheck(body, SPHERE_120, true);
      expect(answer).toMatchObject({ cells: solidSphereCells(120), unknown_cells: reads() });
      expect(reads()).toBe(solidSphereCells(120));
      expect(layers).toHaveLength(241);
      expect(layers.every((y, i) => i === 0 || y === (layers[i - 1] ?? 0) + 1)).toBe(true);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(solidSphereCells(120));
      // The widest layer is the equator; the walk never holds more than that one layer at a time.
      expect(Math.max(...sizes)).toBe(solidSphereLayerCells(120, 0));
      expect(yields.mock.calls.length).toBeGreaterThan(0);
    } finally {
      yields.mockRestore();
    }
  }, 60_000);

  it('reports the exact counts of an eager expansion on a small plan', async () => {
    const plan = {
      palette: { stone: { block: 'stone' }, glass: { block: 'glass' } },
      steps: [
        { op: 'box', pal: 'stone', from: { x: -2, y: 64, z: -2 }, to: { x: 2, y: 66, z: 2 } },
        { op: 'sphere', pal: 'glass', center: { x: 0, y: 65, z: 0 }, radius: 3 },
        {
          op: 'wall',
          pal: 'stone',
          from: { x: -4, y: 64, z: 4 },
          to: { x: 4, y: 64, z: 4 },
          height: 2,
        },
      ],
    };
    const seen = bodyWith([
      [0, 64, 0],
      [1, 65, 1],
      [-4, 64, 4],
    ]);
    const eager = [...expandPlan(plan as unknown as Parameters<typeof expandPlan>[0])];
    const tally = tallyMaterials(eager);
    const expectedUnknown = eager.filter((c) => seen.seen.read(c.x, c.y, c.z) === undefined).length;
    const answer = await answerPlanCheck(seen, { plan }, true);
    expect(answer).toEqual({
      cells: eager.length,
      material_needs: {
        stone: { need: tally.stone ?? 0, have: 4 },
        glass: { need: tally.glass ?? 0, have: 0 },
      },
      unknown_cells: expectedUnknown,
      estimated_ticks: eager.length,
      invalid_steps: [],
    });
  }, 60_000);

  it('stops the walk when its signal aborts, and answers not_available', async () => {
    const controller = new AbortController();
    let slices = 0;
    const { body, reads } = countingBody({
      sliceFor: () => {
        slices++;
        if (slices === 3) controller.abort();
        return 100;
      },
    });
    expect(await answerPlanCheck(body, SPHERE_120, true, controller.signal)).toEqual({
      error: 'not_available',
    });
    expect(reads()).toBeLessThanOrEqual(300);
  });

  it('a newer plan_check supersedes the walk still running: the older one is not_available', async () => {
    const check = planCheckFrom(new SeenMap(), {
      inventory: { items: () => [] },
      entity: { position: FEET },
    });
    const first = check(SPHERE_120);
    const second = check(BOX_2X2);
    expect(await first).toEqual({ error: 'not_available' });
    expect(await second).toMatchObject({ cells: 4 });
  });

  it('the Body ending aborts its walk: not_available, and no later walk is started', async () => {
    const life = new AbortController();
    const check = planCheckFrom(
      new SeenMap(),
      { inventory: { items: () => [] }, entity: { position: FEET } },
      life.signal,
    );
    const pending = check(SPHERE_120);
    life.abort();
    expect(await pending).toEqual({ error: 'not_available' });
  });

  it('a bot with no position refuses as not_available, and the answer names no cell', async () => {
    const bot = { inventory: { items: () => [] } };
    const plan = {
      plan: {
        palette: { stone: { block: 'stone' } },
        origin: 'here',
        steps: [{ op: 'place', pal: 'stone', at: { x: 0, y: 0, z: 0 } }],
      },
    };
    expect(await planCheckFrom(new SeenMap(), bot)(plan)).toEqual({ error: 'not_available' });
  });
});
