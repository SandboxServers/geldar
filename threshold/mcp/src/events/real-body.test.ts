import { describe, expect, it } from 'vitest';
import {
  feedStream,
  logKinds,
  realMessages,
  resultTypes,
  waitAfter,
} from '../../test/fixtures/real-body-feed.ts';

/*
 * The live run 5 events (test/fixtures/real-body-events.json) through the real path: the stream handler,
 * the mapper, the player log and `wait`. Seq 1 is the old no_plan wake, 2 accepted, 3 running, 4 plan_result,
 * 5 the intent failed (max_world_ticks reached), 6 the wake limit_reached for the same intent.
 */
describe('real Body events through the stream, the mapper, the log and wait', () => {
  it('maps the real events to the player-facing kinds the L4 trace records', async () => {
    const fed = await feedStream(realMessages());
    expect(fed.invalid).toBe(0);
    expect(await logKinds(fed.log)).toEqual([
      '1:intent_finished',
      '4:plan_result',
      '5:intent_finished',
      '6:intent_finished',
    ]);
  });

  it('wakes a wait that starts before the failed intent with precondition_failed and the fixed text', async () => {
    const fed = await feedStream(realMessages());
    const out = await waitAfter(fed, 1);
    expect(out.ok && out.result.wake_reason).toBe('precondition_failed');
    expect(resultTypes(out)).toContain('5:intent_finished');
  });

  it('ends a wait that starts after the failed intent when the limit wake arrives, as intent_run_too_long', async () => {
    const fed = await feedStream(realMessages());
    const out = await waitAfter(fed, 5);
    expect(out.ok && out.result.wake_reason).toBe('intent_run_too_long');
    expect(out.ok && out.result.events.map((e) => e.text)).toEqual([
      'Your intent ran out of time.',
    ]);
  });
});
