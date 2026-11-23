import type { MindEvent } from '@geldar/player-core/src/ports/body.ts';
import { describe, expect, it } from 'vitest';
import { planProgressHandler } from './plan-progress.ts';
import type { EventBase, MapContext } from './types.ts';

const payload = {
  plan_id: 'shelter_1',
  total: 540,
  done: 312,
  placed: 300,
  broken: 0,
  skipped_by_code: { changed: 3 },
  phase: 'running',
  next_need: { block: 'dirt', count: 11 },
};
const base: EventBase = { seq: 7, tick: 100, atMs: 5, wakeOn: null };
const ctx = {} as MapContext;

function mindEvent(p: unknown): MindEvent {
  return { type: 'plan_progress', payload: p } as unknown as MindEvent;
}

describe('plan_progress handler', () => {
  it('maps the Body counts to one sim event that never wakes the agent', () => {
    expect(planProgressHandler.map(mindEvent(payload), base, ctx)).toEqual([
      {
        seq: 7,
        tick: 100,
        atMs: 5,
        wakeOn: null,
        kind: 'plan_progress',
        plan: { done: 312, total: 540, phase: 'running', nextNeed: { block: 'dirt', count: 11 } },
      },
    ]);
  });

  it('leaves the next need out when the payload has none', () => {
    const { next_need: _unused, ...bare } = payload;
    const [event] = planProgressHandler.map(mindEvent(bare), base, ctx);
    expect(event?.plan).toEqual({ done: 312, total: 540, phase: 'running' });
    expect(event?.plan).not.toHaveProperty('nextNeed');
  });

  it('gives no event for a payload the contract refuses', () => {
    expect(planProgressHandler.map(mindEvent({ ...payload, extra: 1 }), base, ctx)).toEqual([]);
    expect(planProgressHandler.map(mindEvent(undefined), base, ctx)).toEqual([]);
  });
});
