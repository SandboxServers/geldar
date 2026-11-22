import { describe, expect, it } from 'vitest';
import { BUILDING_REFUSAL } from '../building/names.ts';
import { planHandler } from '../building/queue-action.ts';
import { breakHandler } from './break.ts';
import { allActions } from './index.ts';
import { failed } from './outcome.ts';

// The stub handlers never read the context or the action; the flag decides the path.
const NO_CONTEXT = {} as never;
const BREAK = { do: 'break', at: { x: 0, y: 64, z: 0 } } as never;
const PLAN = { do: 'plan', op: 'cancel', plan_id: 'all' } as never;

describe('break and plan with body_actions.building off (BLD-S3a)', () => {
  it('the Body action list registers break and plan', () => {
    const kinds = allActions.map((handler) => handler.kind);
    expect(kinds).toContain('break');
    expect(kinds).toContain('plan');
  });

  it('break is refused with the neutral message while the flag is off', async () => {
    await expect(breakHandler(false).run(NO_CONTEXT, BREAK)).resolves.toEqual(
      failed('not_possible', BUILDING_REFUSAL),
    );
  });

  it('plan is refused with the same message while the flag is off', async () => {
    await expect(planHandler(false).run(NO_CONTEXT, PLAN)).resolves.toEqual(
      failed('not_possible', BUILDING_REFUSAL),
    );
  });

  it('with the flag on, break and plan reach their stubs and throw not_implemented', async () => {
    await expect(breakHandler(true).run(NO_CONTEXT, BREAK)).rejects.toThrow(
      'not_implemented: break',
    );
    await expect(planHandler(true).run(NO_CONTEXT, PLAN)).rejects.toThrow('not_implemented: plan');
  });
});
