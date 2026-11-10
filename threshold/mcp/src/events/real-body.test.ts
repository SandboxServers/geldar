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
 * the mapper, the player log and `wait`. Seq 1 is the no_plan wake with no intent (a neutral wake), 2 accepted,
 * 3 running, 4 plan_result, 5 the intent failed (max_world_ticks reached), 6 the wake limit_reached for the same intent.
 */
describe('real Body events through the stream, the mapper, the log and wait', () => {
  it('maps the real events to the player-facing kinds the L4 trace records', async () => {
    const fed = await feedStream(realMessages());
    expect(fed.invalid).toBe(0);
    expect(await logKinds(fed.log)).toEqual(['1:wake', '4:plan_result', '5:intent_finished']);
  });

  it('shows the no_plan wake as a neutral wake, not as a failed intent', async () => {
    const fed = await feedStream(realMessages().slice(0, 1));
    const out = await waitAfter(fed, 0);
    expect(resultTypes(out)).toEqual(['1:wake']);
    expect(out.ok && out.result.events.map((e) => e.text)).toEqual([
      'You wake with nothing underway.',
    ]);
  });

  it('wakes a wait that starts before the limit end with intent_run_too_long and the fixed text', async () => {
    const fed = await feedStream(realMessages());
    const out = await waitAfter(fed, 1);
    expect(out.ok && out.result.wake_reason).toBe('intent_run_too_long');
    expect(resultTypes(out)).toContain('5:intent_finished');
    expect(out.ok && out.result.events.map((e) => e.text)).toEqual([
      'Your intent ran out of time.',
    ]);
  });

  it('times out a wait whose cursor has passed the end, since the limit wake is the same end', async () => {
    const fed = await feedStream(realMessages());
    const out = await waitAfter(fed, 5);
    expect(out.ok && out.result.wake_reason).toBe('timeout');
    expect(out.ok && out.result.events).toEqual([]);
  });
});

/** The real intent-failed message (seq 5) with another state and detail; the rest of the envelope is the real one. */
function intentEnd(state: string, detail?: string): unknown {
  const real = realMessages()[4] as { payload: Record<string, unknown> };
  const payload: Record<string, unknown> = { ...real.payload, state };
  if (detail === undefined) delete payload.detail;
  else payload.detail = detail;
  return { ...real, payload };
}

describe('every terminal intent state ends the run once, with its wake reason', () => {
  const cases: [string, string | undefined, string][] = [
    ['completed', undefined, 'goal_completed'],
    ['failed', 'max_world_ticks reached', 'intent_run_too_long'],
    ['failed', 'max_block_operations reached', 'intent_run_too_long'],
    ['failed', 'no oak_log within reach', 'precondition_failed'],
    ['cancelled', 'replaced by a new intent', 'precondition_failed'],
    ['interrupted', 'interrupted: the body restarted', 'precondition_failed'],
  ];

  it.each(cases)(
    '%s (%s) gives one intent_finished and wakes a wait with %s',
    async (state, detail, reason) => {
      const messages = [...realMessages().slice(0, 4), intentEnd(state, detail)];
      const fed = await feedStream(messages);
      expect(await logKinds(fed.log)).toEqual(['1:wake', '4:plan_result', '5:intent_finished']);
      const before = await waitAfter(fed, 4);
      expect(before.ok && before.result.wake_reason).toBe(reason);
      expect(resultTypes(before)).toContain('5:intent_finished');
      const after = await waitAfter(fed, 5);
      expect(after.ok && after.result.wake_reason).toBe('timeout');
    },
  );

  it('ends the run with the limit wake alone when the Body never sent the intent end', async () => {
    const messages = [...realMessages().slice(0, 4), realMessages()[5]];
    const fed = await feedStream(messages);
    expect(await logKinds(fed.log)).toEqual(['1:wake', '4:plan_result', '5:intent_finished']);
    const out = await waitAfter(fed, 4);
    expect(out.ok && out.result.wake_reason).toBe('intent_run_too_long');
  });
});
