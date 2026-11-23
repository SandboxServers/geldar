import { describe, expect, it } from 'vitest';
import * as building from './index.ts';

describe('building scaffold (BLD-S3a)', () => {
  it('progressSentence is implemented and exported (BLD-16)', () => {
    expect(typeof building.progressSentence).toBe('function');
    expect(building.progressSentence.length).toBe(1);
  });

  it('doCell and countMaterials are implemented and exported (BLD-11)', () => {
    expect(typeof building.doCell).toBe('function');
    expect(typeof building.countMaterials).toBe('function');
  });

  it('the plan queue and the contention gate are implemented and exported (BLD-14)', () => {
    expect(typeof building.PlanQueue).toBe('function');
    expect(typeof building.contendFor).toBe('function');
  });

  it('the plan lane is absent with the flag off and with it on (stub)', () => {
    expect(building.createPlanLane(false)).toBeNull();
    expect(building.createPlanLane(true)).not.toBeNull();
  });

  it('the shared names keep their agreed values', () => {
    expect(building.BUILDING_REFUSAL).toBe('building is not available');
    expect(building.PLAN_BUCKET).toBe('geldar-plans');
    expect(building.SEEN_BUCKET).toBe('geldar-seen');
  });
});
