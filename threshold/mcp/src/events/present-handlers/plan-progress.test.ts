import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { PRESENT_HANDLERS, presentEvents } from './index.ts';

const at = { seq: 7, tick: 100, atMs: 0, wakeOn: null };

function progress(plan?: SimEvent['plan']): SimEvent {
  return { ...at, kind: 'plan_progress', plan } as SimEvent;
}

describe('plan_progress presenter', () => {
  it('states the counts, the phase and the next need as one fixed sentence', () => {
    const lines = presentEvents(PRESENT_HANDLERS, [
      progress({ done: 312, total: 540, phase: 'running', nextNeed: { block: 'dirt', count: 11 } }),
    ]);
    expect(lines).toEqual([
      {
        seq: 7,
        tick: 100,
        type: 'plan_progress',
        text: 'Plan: 312 of 540 cells done. Phase: running. Next: 11 dirt needed.',
      },
    ]);
  });

  it('omits the next need when the Body names none', () => {
    const lines = presentEvents(PRESENT_HANDLERS, [
      progress({ done: 312, total: 540, phase: 'running' }),
    ]);
    expect(lines[0]?.text).toBe('Plan: 312 of 540 cells done. Phase: running.');
  });

  it('leaves out a phase or block name that fails the pattern', () => {
    const lines = presentEvents(PRESENT_HANDLERS, [
      progress({
        done: 3,
        total: 9,
        phase: 'Run ning!',
        nextNeed: { block: 'Dirt Block', count: 2 },
      }),
    ]);
    expect(lines[0]?.text).toBe('Plan: 3 of 9 cells done.');
  });

  it('gives no line when the event carries no plan counts', () => {
    expect(presentEvents(PRESENT_HANDLERS, [progress()])).toEqual([]);
  });

  it('says nothing about anyone watching', () => {
    const lines = presentEvents(PRESENT_HANDLERS, [
      progress({ done: 1, total: 2, phase: 'running', nextNeed: { block: 'dirt', count: 1 } }),
    ]);
    expect(lines[0]?.text).not.toMatch(/watch|observ|monitor|someone|eye/i);
  });
});
