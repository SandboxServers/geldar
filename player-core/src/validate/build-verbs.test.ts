import { describe, expect, it } from 'vitest';
import { ACTION_FIELDS, ACTION_OPTIONAL } from './action-shapes.ts';
import { BORDER_MARGIN, DEFAULT_BOUNDS, PHASE0_VERBS } from './bounds.ts';
import { createOutputValidator } from './index.ts';

// The building verbs are on in this file: the flag-off refusals are in their own block at the end.
const validator = createOutputValidator({ buildingOn: true });
const parse = (actions: unknown[]) =>
  validator.parseThought(JSON.stringify({ reasoning: 'test', say: '', actions }));
const parseWithFlag = (buildingOn: boolean, actions: unknown[]) =>
  createOutputValidator({ buildingOn }).parseThought(
    JSON.stringify({ reasoning: 'test', say: '', actions }),
  );
const pos = (x: number, y: number, z: number) => ({ x, y, z });
const reach = DEFAULT_BOUNDS.worldBorderRadius + BORDER_MARGIN;
const plan = (extra: Record<string, unknown> = {}) => ({
  do: 'plan',
  op: 'add',
  plan_id: 'shelter_1',
  palette: { wall: { block: 'stone' } },
  steps: [{ op: 'box', pal: 'wall', from: pos(0, 64, 0), to: pos(4, 68, 4) }],
  ...extra,
});

describe('break and plan are Phase 0 verbs with a field table', () => {
  it('names both verbs and gives the table the same keys as the allow-list', () => {
    expect(PHASE0_VERBS).toContain('break');
    expect(PHASE0_VERBS).toContain('plan');
    expect(Object.keys(ACTION_FIELDS).sort()).toEqual([...PHASE0_VERBS].sort());
  });

  it('lists the fields of break and plan, with plan options optional', () => {
    expect(ACTION_FIELDS.break).toEqual(['do', 'at']);
    expect(ACTION_OPTIONAL.plan).toEqual(['origin', 'order', 'final', 'seq']);
  });
});

describe('break position is checked against the border like place', () => {
  it('accepts a cell at the border plus the margin, on both edges', () => {
    expect(parse([{ do: 'break', at: pos(reach, 64, -reach) }]).ok).toBe(true);
  });

  it('refuses a cell one block past the margin, on x and on z', () => {
    for (const at of [pos(reach + 1, 64, 0), pos(0, 64, -reach - 1)]) {
      const result = parse([{ do: 'break', at }]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('out_of_bounds');
    }
  });

  it('refuses a break with an unknown field', () => {
    expect(parse([{ do: 'break', at: pos(0, 64, 0), block: 'stone' }]).ok).toBe(false);
  });
});

describe('plan coordinates are checked against the border', () => {
  it('accepts a plan inside the border', () => {
    expect(parse([plan()]).ok).toBe(true);
  });

  it('refuses an origin one block past the margin', () => {
    const result = parse([plan({ origin: pos(reach + 1, 64, 0) })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('out_of_bounds');
  });

  it('refuses a step coordinate past the margin, on the far side', () => {
    const far = plan({
      steps: [{ op: 'box', pal: 'wall', from: pos(0, 64, 0), to: pos(0, 64, -reach - 1) }],
    });
    const result = parse([far]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('out_of_bounds');
  });

  it('accepts a step at the margin exactly', () => {
    const edge = plan({
      steps: [{ op: 'box', pal: 'wall', from: pos(0, 64, 0), to: pos(-reach, 64, reach) }],
    });
    expect(parse([edge]).ok).toBe(true);
  });
});

describe('break and plan are refused while body_actions.building is off', () => {
  it('refuses break with not_allowed on its verb, as for any unavailable verb', () => {
    const result = parseWithFlag(false, [{ do: 'break', at: pos(0, 64, 0) }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('not_allowed');
      expect(result.errors[0]?.path).toBe('/actions/0/do');
      expect(result.errors[0]?.detail).toBe('the action break is not available');
    }
  });

  it('refuses plan with not_allowed on its verb', () => {
    const result = parseWithFlag(false, [plan()]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('not_allowed');
      expect(result.errors[0]?.path).toBe('/actions/0/do');
    }
  });

  it('still accepts the other Phase 0 verbs', () => {
    expect(parseWithFlag(false, [{ do: 'wait', seconds: 1 }]).ok).toBe(true);
  });

  it('accepts break and plan once the flag is on', () => {
    expect(parseWithFlag(true, [{ do: 'break', at: pos(0, 64, 0) }]).ok).toBe(true);
    expect(parseWithFlag(true, [plan()]).ok).toBe(true);
  });
});
