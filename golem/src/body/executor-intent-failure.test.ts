import { validateActionOutcomePayload } from '@geldar/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIAG_SINK } from '../actions/stall-diag.ts';
import { emitIntentFailure } from './executor-outcome.ts';
import { MemorySink } from './records.ts';

/** The diag lines a test captured, parsed back from their JSON. */
function diagLines(logs: string[]): Record<string, unknown>[] {
  return logs.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('intent failures: reason and host log (batch 14)', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(DEFAULT_DIAG_SINK, 'log').mockImplementation((line: string) => {
      logs.push(line);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a build failure reaches the outcome with its contract reason, not internal', () => {
    const sink = new MemorySink();
    emitIntentFailure(
      sink,
      9,
      'build',
      'not_possible: Built shelter: 24 placed, 0 already solid, of 25. The north wall could not be placed; first failure: blocked: the server refused.',
    );
    const [outcome] = sink.outcomes;
    expect(outcome).toMatchObject({ intent: true, ok: false, reason: 'not_possible' });
    expect(outcome?.reason).not.toBe('internal');
    expect(validateActionOutcomePayload(outcome).ok).toBe(true);
    expect(diagLines(logs).filter((l) => l.event === 'intent_reason_unknown')).toHaveLength(0);
  });

  it('a build prefix that is not a contract reason reads as not_possible with one diag line', () => {
    const sink = new MemorySink();
    emitIntentFailure(sink, 9, 'build', 'Built shelter: 3 placed, 0 already solid, of 25.');
    expect(sink.outcomes[0]).toMatchObject({ reason: 'not_possible', intent: true });
    const unknown = diagLines(logs).filter((l) => l.event === 'intent_reason_unknown');
    expect(unknown).toEqual([
      { event: 'intent_reason_unknown', program: 'build', prefix: 'Built shelter' },
    ]);
  });

  it('a known reason keeps its code and logs no unknown line', () => {
    const sink = new MemorySink();
    emitIntentFailure(sink, 9, 'travel', 'blocked: not at the target after 4 legs');
    expect(sink.outcomes[0]).toMatchObject({ reason: 'blocked', why: expect.any(String) });
    expect(diagLines(logs).some((l) => l.event === 'intent_reason_unknown')).toBe(false);
  });

  it('logs one intent_failed line with the program, reason and message cut to 300 characters', () => {
    const sink = new MemorySink();
    emitIntentFailure(sink, 9, 'travel', `blocked: ${'x'.repeat(400)}`);
    const failed = diagLines(logs).filter((l) => l.event === 'intent_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ program: 'travel', reason: 'blocked' });
    expect(String(failed[0]?.message)).toHaveLength(300);
  });
});
