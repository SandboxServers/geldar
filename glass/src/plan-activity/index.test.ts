import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_ACTIVITY_MODULE } from '../static-files.ts';
import { PLAN_ACTIVITY_ENABLED, renderPlanActivity } from './index.ts';

/** A host that fails the test on any read or write, so a draw while off shows up as a thrown error. */
function touchedHost(): HTMLElement {
  const fail = (): never => {
    throw new Error('host touched while the plan activity panel is off');
  };
  return new Proxy({}, { get: fail, set: fail }) as HTMLElement;
}

describe('the plan-activity registry stub (BLD-S3c, decision 0429)', () => {
  it('is listed in the registry and its file exists', () => {
    expect(PLAN_ACTIVITY_MODULE).toBe('plan-activity/index');
    expect(existsSync(new URL('./index.ts', import.meta.url))).toBe(true);
  });

  it('is off by default', () => {
    expect(PLAN_ACTIVITY_ENABLED).toBe(false);
  });

  it('renders nothing while off and never touches the host', () => {
    expect(() => renderPlanActivity(touchedHost())).not.toThrow();
    expect(() => renderPlanActivity(touchedHost(), false)).not.toThrow();
  });
});
