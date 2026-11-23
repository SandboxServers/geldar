import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_ACTIVITY_MODULE, RENDER_MODULES } from '../static-files.ts';
import { PLAN_ACTIVITY_ENABLED, renderPlanActivity, toPlanActivityRow } from './index.ts';

/** A host that fails the test on any read or write, so a draw while off shows up as a thrown error. */
function touchedHost(): HTMLElement {
  const fail = (): never => {
    throw new Error('host touched while the plan activity panel is off');
  };
  return new Proxy({}, { get: fail, set: fail }) as HTMLElement;
}

/** A plain host that records what is written to it. */
function textHost(): HTMLElement & { textContent: string | null } {
  return { textContent: 'unset' } as HTMLElement & { textContent: string | null };
}

describe('the plan-activity registry (BLD-S3c, BLD-37, decision 0429)', () => {
  it('is served from the render list and its file exists', () => {
    expect(PLAN_ACTIVITY_MODULE).toBe('plan-activity/index');
    expect(RENDER_MODULES).toContain(PLAN_ACTIVITY_MODULE);
    expect(existsSync(new URL('./index.ts', import.meta.url))).toBe(true);
  });

  it('is off by default', () => {
    expect(PLAN_ACTIVITY_ENABLED).toBe(false);
  });

  it('renders nothing while off, even with rows, and never touches the host', () => {
    const rows = [toPlanActivityRow('Ada', planPayload())];
    expect(() => renderPlanActivity(touchedHost())).not.toThrow();
    expect(() => renderPlanActivity(touchedHost(), false)).not.toThrow();
    expect(() => renderPlanActivity(touchedHost(), false, rows)).not.toThrow();
  });

  it('writes one line per row as text when on', () => {
    const host = textHost();
    renderPlanActivity(host, true, [toPlanActivityRow('Ada', planPayload())]);
    expect(host.textContent).toBe(
      'Ada · plan plan-7 · completed · 25/25 done · placed 25 · broken 0 · skipped: none',
    );
  });

  it('clears the host when on with no rows', () => {
    const host = textHost();
    renderPlanActivity(host, true, []);
    expect(host.textContent).toBe('');
  });
});

function planPayload() {
  return {
    plan_id: 'plan-7',
    total: 25,
    done: 25,
    placed: 25,
    broken: 0,
    skipped_by_code: {},
    phase: 'completed',
  };
}
