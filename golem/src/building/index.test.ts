import { describe, expect, it } from 'vitest';
import * as building from './index.ts';

const STUBS = [
  'putPlanChunk',
  'readPlanChunk',
  'deletePlan',
  'saveCheckpoint',
  'doCell',
  'countMaterials',
  'scaffoldFor',
  'hazardAt',
  'laneStateOf',
  'enqueuePlan',
  'contendFor',
  'throttleWait',
  'progressSentence',
  'recordSeen',
  'sectionOf',
  'loadSection',
  'surveyBox',
] as const;

describe('building scaffold (BLD-S3a)', () => {
  it.each(STUBS)('%s is exported and refuses with not_implemented', (name) => {
    const stub = building[name] as unknown as () => unknown;
    expect(() => stub()).toThrow(`not_implemented: ${name}`);
  });

  it('the plan lane is absent with the flag off and with it on (stub)', () => {
    expect(building.createPlanLane(false)).toBeNull();
    expect(building.createPlanLane(true)).toBeNull();
  });

  it('the shared names keep their agreed values', () => {
    expect(building.BUILDING_REFUSAL).toBe('building is not available');
    expect(building.PLAN_BUCKET).toBe('geldar-plans');
    expect(building.SEEN_BUCKET).toBe('geldar-seen');
  });
});
