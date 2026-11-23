import { describe, expect, it } from 'vitest';
import type { ToolCall } from './look.ts';
import { type PlanCheckDeps, planCheckTool } from './plan-check.ts';

const LIFE = 'ag_ada_01';
const CALL = { playerId: 'pl_ada', lifeId: LIFE } as ToolCall;

const PLAN = {
  plan: {
    palette: { stone: { block: 'stone' } },
    steps: [{ op: 'box', pal: 'stone', from: { x: 1, y: 64, z: 0 }, to: { x: 3, y: 64, z: 2 } }],
  },
};

const CHECK = {
  cells: 9,
  material_needs: { stone: { need: 9, have: 4 } },
  unknown_cells: 9,
  estimated_ticks: 9,
  invalid_steps: [],
};

/** Fake deps: the Body's reply to the dry run, and a count of the requests it received. */
function deps(reply: () => Promise<unknown>, open = true) {
  const requests: { lifeId: string; request: { plan: unknown } }[] = [];
  const value: PlanCheckDeps = {
    isOpen: () => open,
    check: async (lifeId, request) => {
      requests.push({ lifeId, request });
      return reply();
    },
  };
  return { value, requests };
}

describe('planCheckTool (forwards the dry run to the Body)', () => {
  it('forwards the plan to the life Body and returns the Body check', async () => {
    const { value, requests } = deps(async () => CHECK);
    expect(await planCheckTool(value, CALL, PLAN)).toEqual({ check: CHECK });
    expect(requests).toEqual([{ lifeId: LIFE, request: PLAN }]);
  });

  it('refuses a closed session without asking the Body', async () => {
    const { value, requests } = deps(async () => CHECK, false);
    expect(await planCheckTool(value, CALL, PLAN)).toEqual({ error: 'session_closed' });
    expect(requests).toHaveLength(0);
  });

  it('refuses an input the contract does not accept without asking the Body', async () => {
    const { value, requests } = deps(async () => CHECK);
    expect(await planCheckTool(value, CALL, { plan: 'nope' })).toEqual({ error: 'invalid_input' });
    expect(requests).toHaveLength(0);
  });

  it('turns a Body that throws into body_unavailable', async () => {
    const { value } = deps(async () => {
      throw new Error('no answer');
    });
    expect(await planCheckTool(value, CALL, PLAN)).toEqual({ error: 'body_unavailable' });
  });

  it('turns a reply the contract does not accept into body_unavailable', async () => {
    const { value } = deps(async () => ({ cells: 'many' }));
    expect(await planCheckTool(value, CALL, PLAN)).toEqual({ error: 'body_unavailable' });
  });
});
