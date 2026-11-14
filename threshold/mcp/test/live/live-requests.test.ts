/**
 * The live case cannot run in `check`, so this checks the bodies it sends: each one passes the contract's
 * validator for its tool, and the act intent passes the Mind's output validator (which checks program arguments).
 * A body the schema rejects fails here, not on a live run.
 */
import { createOutputValidator } from '@geldar/player-core/src/validate/index.ts';
import { validateToolInput } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { actCall, lookCall, type ToolCall, WAIT_SECONDS, waitCall } from './live-requests.ts';

const bodies: [string, ToolCall][] = [
  ['look', lookCall()],
  ['act', actCall()],
  ['wait without a cursor', waitCall()],
  ['wait with a cursor', waitCall('c_12')],
];

describe('the live stub-client request bodies', () => {
  it.each(bodies)('%s passes the contract input validator', (_, call) => {
    const result = validateToolInput(call.name, call.arguments);
    expect(result.ok, result.ok ? '' : result.errors.join('; ')).toBe(true);
  });

  it('the act intent passes the Mind output validator, with gather arguments in bounds', () => {
    const intent = (actCall().arguments as { intent: unknown }).intent;
    const judged = createOutputValidator().parseThought(
      JSON.stringify({ reasoning: 'stub client case', intent }),
    );
    expect(judged.ok, judged.ok ? '' : judged.errors.join('; ')).toBe(true);
  });

  it('the act body is refused without intent.limits, so the case cannot drop it again', () => {
    const { limits: _limits, ...withoutLimits } = (actCall().arguments as { intent: object })
      .intent as {
      limits: unknown;
    };
    const body = { reasoning: 'stub client case', intent: withoutLimits };
    expect(validateToolInput('act', body).ok).toBe(false);
  });

  it('the wait bound is inside the contract range of 5 to 240 seconds', () => {
    expect(WAIT_SECONDS).toBeGreaterThanOrEqual(5);
    expect(WAIT_SECONDS).toBeLessThanOrEqual(240);
  });
});
