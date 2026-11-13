import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { STEP_BACK_TO, stepBackPoint } from './give-spot.ts';

const RECIPIENT = new Vec3(10, 64, 10);

describe('stepBackPoint', () => {
  it('steps away along the negative x axis when the body is on the west side', () => {
    const spot = stepBackPoint(new Vec3(9.9, 64, 10), RECIPIENT);
    expect(spot?.x).toBeCloseTo(8, 6);
    expect(spot?.z).toBeCloseTo(10, 6);
  });

  it('steps away along the positive x axis when the body is on the east side', () => {
    const spot = stepBackPoint(new Vec3(10.1, 64, 10), RECIPIENT);
    expect(spot?.x).toBeCloseTo(12, 6);
    expect(spot?.z).toBeCloseTo(10, 6);
  });

  it('steps away along the negative z axis when the body is to the north', () => {
    const spot = stepBackPoint(new Vec3(10, 64, 9.9), RECIPIENT);
    expect(spot?.x).toBeCloseTo(10, 6);
    expect(spot?.z).toBeCloseTo(8, 6);
  });

  it('steps away along the positive z axis when the body is to the south', () => {
    const spot = stepBackPoint(new Vec3(10, 64, 10.1), RECIPIENT);
    expect(spot?.x).toBeCloseTo(10, 6);
    expect(spot?.z).toBeCloseTo(12, 6);
  });

  it('steps along the diagonal and lands the distance away from the recipient', () => {
    const spot = stepBackPoint(new Vec3(9.1, 64, 9.1), RECIPIENT);
    expect(spot).not.toBeNull();
    const back = Math.hypot((spot?.x ?? 0) - 10, (spot?.z ?? 0) - 10);
    expect(back).toBeCloseTo(STEP_BACK_TO, 6);
    expect(spot?.x).toBeLessThan(10);
    expect(spot?.z).toBeLessThan(10);
  });

  it('keeps the body height and the default distance of 2 blocks', () => {
    const spot = stepBackPoint(new Vec3(10.5, 65.5, 10), RECIPIENT, undefined);
    expect(spot?.y).toBe(65.5);
    expect(spot?.distanceTo(new Vec3(RECIPIENT.x, 65.5, RECIPIENT.z))).toBeCloseTo(2, 6);
  });

  it('returns null when the body stands on the recipient', () => {
    expect(stepBackPoint(new Vec3(10, 64, 10), RECIPIENT)).toBeNull();
  });
});
