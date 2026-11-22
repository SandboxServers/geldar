import {
  type Cell,
  expandPlan,
  type PlanSpec,
  tallyMaterials,
} from '@geldar/player-core/src/building/index.ts';
import { describe, expect, it } from 'vitest';
import type { ToolCall } from './look.ts';
import {
  PLAN_CHECK_TICKS_PER_CELL,
  type PlanCheckDeps,
  type PlanCheckView,
  planCheckTool,
} from './plan-check.ts';
import { hiddenToolsFor, refuseHiddenCall } from './unavailable.ts';

const LIFE = 'ag_ada_01';
const CALL = { playerId: 'pl_ada', lifeId: LIFE } as ToolCall;

const PLAN = {
  palette: {
    stone: { block: 'stone' },
    glass: { block: 'glass' },
  },
  steps: [
    { op: 'place', pal: 'stone', at: { x: 0, y: 64, z: 0 } },
    { op: 'box', pal: 'stone', from: { x: 1, y: 64, z: 0 }, to: { x: 3, y: 64, z: 2 } },
    { op: 'break', at: { x: 5, y: 64, z: 5 } },
    { op: 'line', pal: 'glass', from: { x: 0, y: 65, z: 0 }, to: { x: 2, y: 65, z: 0 } },
  ],
} as const;

interface Fakes {
  deps: PlanCheckDeps;
  reads: string[];
  seen: Cell[];
}

/** Fake deps: the pack, the feet cell and a seen map (cells at height 64 are seen by default). */
function fakes(overrides: Partial<PlanCheckView> & { readFails?: boolean; open?: boolean } = {}): Fakes {
  const reads: string[] = [];
  const seen: Cell[] = [];
  const view: PlanCheckView = {
    pack: overrides.pack ?? { 'stone': 4 },
    feet: overrides.feet ?? { x: 0, y: 64, z: 0 },
    seen:
      overrides.seen ??
      ((cell: Cell) => {
        seen.push(cell);
        return cell.y === 64;
      }),
  };
  return {
    reads,
    seen,
    deps: {
      isOpen: () => overrides.open ?? true,
      read: async (lifeId: string) => {
        reads.push(lifeId);
        if (overrides.readFails) throw new Error('body down');
        return view;
      },
    },
  };
}

describe('plan_check', () => {
  it('counts cells and material needs the way the lane expansion does', async () => {
    const f = fakes();
    const out = await planCheckTool(f.deps, CALL, { plan: PLAN });
    const lane = [...expandPlan(PLAN as unknown as PlanSpec)];
    const laneCounts = tallyMaterials(lane);
    expect(out).toEqual({
      check: {
        cells: lane.length,
        material_needs: {
          'stone': { need: laneCounts.stone, have: 4 },
          'glass': { need: laneCounts.glass, have: 0 },
        },
        unknown_cells: 3,
        estimated_ticks: lane.length * PLAN_CHECK_TICKS_PER_CELL,
        invalid_steps: [],
      },
    });
    expect(lane.length).toBe(14);
    expect(laneCounts).toEqual({ 'stone': 10, 'glass': 3 });
  });

  it('reports break cells as cells and unknown cells, and never as material', async () => {
    const f = fakes({ seen: () => false });
    const out = await planCheckTool(f.deps, CALL, {
      plan: { palette: PLAN.palette, steps: [{ op: 'break', at: { x: 5, y: 64, z: 5 } }] },
    });
    expect(out).toEqual({
      check: {
        cells: 1,
        material_needs: {},
        unknown_cells: 1,
        estimated_ticks: PLAN_CHECK_TICKS_PER_CELL,
        invalid_steps: [],
      },
    });
  });

  it('does not guess a cell it has not seen: the reply carries a count, never coordinates', async () => {
    const f = fakes({ seen: () => false });
    const out = (await planCheckTool(f.deps, CALL, { plan: PLAN })) as { check: unknown };
    expect(out.check).toMatchObject({ unknown_cells: 14 });
    expect(JSON.stringify(out)).not.toMatch(/"x"|"z"/);
  });

  it('marks a step that names an unknown palette key invalid and counts the rest', async () => {
    const f = fakes();
    const out = await planCheckTool(f.deps, CALL, {
      plan: {
        palette: { stone: { block: 'stone' } },
        steps: [
          { op: 'place', pal: 'nope', at: { x: 0, y: 64, z: 0 } },
          { op: 'place', pal: 'stone', at: { x: 9, y: 64, z: 9 } },
        ],
      },
    });
    expect(out).toEqual({
      check: {
        cells: 1,
        material_needs: { 'stone': { need: 1, have: 4 } },
        unknown_cells: 0,
        estimated_ticks: PLAN_CHECK_TICKS_PER_CELL,
        invalid_steps: [{ index: 0, reason: 'unknown_palette_key' }],
      },
    });
  });

  it('shifts relative cells by a coordinate origin on every axis before the seen check', async () => {
    const f = fakes();
    const seenCells: Cell[] = [];
    f.deps.read = async () => ({
      pack: {},
      feet: { x: 0, y: 0, z: 0 },
      seen: (cell: Cell) => {
        seenCells.push(cell);
        return true;
      },
    });
    await planCheckTool(f.deps, CALL, {
      plan: {
        palette: { stone: { block: 'stone' } },
        origin: { x: 10, y: 20, z: -30 },
        steps: [{ op: 'place', pal: 'stone', at: { x: 1, y: 2, z: 3 } }],
      },
    });
    expect(seenCells).toEqual([{ x: 11, y: 22, z: -27 }]);
  });

  it("resolves origin 'here' to the life's feet cell", async () => {
    const seenCells: Cell[] = [];
    const f = fakes();
    f.deps.read = async () => ({
      pack: {},
      feet: { x: 100, y: 70, z: -50 },
      seen: (cell: Cell) => {
        seenCells.push(cell);
        return true;
      },
    });
    await planCheckTool(f.deps, CALL, {
      plan: {
        palette: { stone: { block: 'stone' } },
        origin: 'here',
        steps: [{ op: 'place', pal: 'stone', at: { x: 1, y: -2, z: 3 } }],
      },
    });
    expect(seenCells).toEqual([{ x: 101, y: 68, z: -47 }]);
  });

  it('refuses a closed session without reading the Body', async () => {
    const f = fakes({ open: false });
    expect(await planCheckTool(f.deps, CALL, { plan: PLAN })).toEqual({ error: 'session_closed' });
    expect(f.reads).toEqual([]);
  });

  it('refuses a bad input without reading the Body', async () => {
    const f = fakes();
    expect(await planCheckTool(f.deps, CALL, {})).toEqual({ error: 'invalid_input' });
    expect(await planCheckTool(f.deps, CALL, { plan: { palette: {}, steps: [] } })).toEqual({
      error: 'invalid_input',
    });
    expect(f.reads).toEqual([]);
  });

  it('answers body_unavailable when the Body read fails', async () => {
    const f = fakes({ readFails: true });
    expect(await planCheckTool(f.deps, CALL, { plan: PLAN })).toEqual({
      error: 'body_unavailable',
    });
  });

  it('answers body_unavailable when the seen map throws', async () => {
    const f = fakes({
      seen: () => {
        throw new Error('seen map down');
      },
    });
    expect(await planCheckTool(f.deps, CALL, { plan: PLAN })).toEqual({
      error: 'body_unavailable',
    });
  });

  it('is hidden by name while the flag is off and callable when it is on', () => {
    const args = { plan: PLAN };
    expect(refuseHiddenCall('plan_check', args, hiddenToolsFor(false))).toMatchObject({
      isError: true,
    });
    expect(refuseHiddenCall('plan_check', args, hiddenToolsFor(true))).toBeUndefined();
  });
});
