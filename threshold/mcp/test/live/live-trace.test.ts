import { describe, expect, it } from 'vitest';
import { describeWaits, traceOf } from './live-trace.ts';

describe('traceOf and describeWaits', () => {
  it('reads the wake reason and the type and text of each event', () => {
    const trace = traceOf(2, {
      wake_reason: 'intent_run_too_long',
      events: [{ type: 'intent_finished', text: 'Your intent ran out of time.', seq: 5 }],
    });
    expect(trace).toEqual({
      step: 2,
      wake_reason: 'intent_run_too_long',
      events: [{ type: 'intent_finished', text: 'Your intent ran out of time.' }],
    });
  });

  it('reads a missing reason as none and skips events without text', () => {
    expect(traceOf(0, { events: [{ type: 'speech_to_me' }, 7, null] })).toEqual({
      step: 0,
      wake_reason: 'none',
      events: [],
    });
  });

  it('prints one line per wait, with the events it saw or none', () => {
    const text = describeWaits([
      { step: 0, wake_reason: 'timeout', events: [] },
      {
        step: 1,
        wake_reason: 'precondition_failed',
        events: [{ type: 'intent_finished', text: 'Your intent failed: precondition_failed.' }],
      },
    ]);
    expect(text).toBe(
      [
        'wait 0: wake_reason timeout; no events',
        'wait 1: wake_reason precondition_failed; intent_finished "Your intent failed: precondition_failed."',
      ].join('\n'),
    );
  });

  it('says so when no wait returned', () => {
    expect(describeWaits([])).toBe('No wait returned.');
  });
});
