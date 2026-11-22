import { describe, expect, it } from 'vitest';
import { MIND_HANDLERS } from '../events/handlers/index.ts';
import { activePlanView } from '../play-view/active-plan.ts';
import { planCheckTool } from './plan-check.ts';
import {
  hiddenToolsFor,
  NOT_AVAILABLE_MESSAGE,
  NOT_YET_EXPOSED_TOOLS,
  refuseHiddenCall,
} from './unavailable.ts';

describe('BLD-S3b survey and plan_check stubs', () => {
  it('hides survey and plan_check while the flag is off', () => {
    const hidden = hiddenToolsFor(false);
    expect(hidden).toContain('survey');
    expect(hidden).toContain('plan_check');
    for (const tool of NOT_YET_EXPOSED_TOOLS) expect(hidden).toContain(tool);
  });

  it('refuses a call to survey or plan_check by name, as not_available, with the fixed message', () => {
    const hidden = hiddenToolsFor(false);
    for (const name of ['survey', 'plan_check']) {
      expect(refuseHiddenCall(name, {}, hidden)).toEqual({
        isError: true,
        content: [{ type: 'text', text: `not_available: ${NOT_AVAILABLE_MESSAGE}` }],
      });
    }
  });

  it('leaves survey and plan_check out of the hidden list when the flag is on', () => {
    expect(hiddenToolsFor(true)).toEqual([]);
  });

  it('the plan_check body refuses with not_available (the survey body is BLD-21, see survey.test.ts)', async () => {
    await expect(planCheckTool()).rejects.toThrow(NOT_AVAILABLE_MESSAGE);
  });

  it('maps plan_progress through a registered stub handler that emits no player event', () => {
    const handler = MIND_HANDLERS.find((h) => (h.type as string) === 'plan_progress');
    expect(handler).toBeDefined();
    expect(handler?.map({} as never, {} as never, {} as never)).toEqual([]);
  });

  it('the active_plan projection is null until BLD-S4 fills it', () => {
    expect(activePlanView()).toBeNull();
  });
});
