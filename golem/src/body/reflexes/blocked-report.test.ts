import { describe, expect, it } from 'vitest';
import { fakeView } from '../body.fakes.ts';
import { executorHarness, fakeId, planFor, thought } from '../executor.fakes.ts';
import type { BodyView } from '../view.ts';
import {
  createBlockedPathReflex,
  dropBlockedReport,
  hasBlockedReport,
  REPORT_TTL_TICKS,
  reportBlocked,
} from './blocked-path.ts';

/** A fake view whose tick the test moves. */
function movingView(): BodyView & { tick: number } {
  return fakeView() as unknown as BodyView & { tick: number };
}

const GOAL = { x: 14, y: 64, z: 0 };

describe('blocked-path reports', () => {
  it('goes stale after REPORT_TTL_TICKS: the reflex does not fire for it', () => {
    const view = movingView();
    view.tick = 1000;
    reportBlocked(view, { goal: GOAL, range: 1, intentId: 'in_1' });
    const reflex = createBlockedPathReflex();
    view.tick = 1000 + REPORT_TTL_TICKS;
    expect(hasBlockedReport(view)).toBe(true);
    expect(reflex.check(view)).not.toBeNull();
    view.tick = 1000 + REPORT_TTL_TICKS + 1;
    expect(reflex.check(view)).toBeNull();
    expect(hasBlockedReport(view)).toBe(false);
  });

  it('is dropped only for the intent it was made for', () => {
    const view = fakeView();
    reportBlocked(view, { goal: GOAL, range: 1, intentId: 'in_1' });
    dropBlockedReport(view, 'in_2');
    expect(hasBlockedReport(view)).toBe(true);
    dropBlockedReport(view, 'in_1');
    expect(hasBlockedReport(view)).toBe(false);
  });

  it('is dropped when the executor ends the intent that asked for the walk', async () => {
    const h = executorHarness();
    await h.executor.submit(thought({ intent: {} }), planFor(0));
    reportBlocked(h.view, { goal: GOAL, range: 1, intentId: fakeId('in', 1) });
    // A new intent replaces the running one, which ends cancelled.
    await h.executor.submit(thought({ intent: {} }), planFor(0, { n: 2 }));
    expect(hasBlockedReport(h.view)).toBe(false);
  });
});
