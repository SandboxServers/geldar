import { describe, expect, it } from 'vitest';
import { MemorySink } from './records.ts';
import { WakeConditions, WakeTap } from './wake-conditions.ts';

const calm = { health: 20, agentsWithin: () => [] as string[] };

describe('WakeConditions', () => {
  it('fires unexpected_damage when health falls, once per drop', () => {
    const wake = new WakeConditions(['unexpected_damage'], calm);
    expect(wake.watch(calm)).toBeNull();
    expect(wake.watch({ ...calm, health: 17 })?.reason).toBe('unexpected_damage');
    expect(wake.watch({ ...calm, health: 17 })).toBeNull();
    expect(wake.watch({ ...calm, health: 18 })).toBeNull();
  });

  it('ignores damage when unexpected_damage is not listed', () => {
    const wake = new WakeConditions(['goal_completed'], calm);
    expect(wake.watch({ ...calm, health: 1 })).toBeNull();
  });

  it('fires new_agent_within_N for an arrival, not for one already there', () => {
    const near = { health: 20, agentsWithin: (r: number) => (r === 8 ? ['pike'] : []) };
    const wake = new WakeConditions(['new_agent_within_8'], near);
    expect(wake.watch(near)).toBeNull();
    const more = { health: 20, agentsWithin: (r: number) => (r === 8 ? ['pike', 'wren'] : []) };
    const fired = wake.watch(more);
    expect(fired?.reason).toBe('new_agent_within_8');
    expect(fired?.detail).toContain('wren');
    expect(wake.watch(more)).toBeNull();
  });

  it('fires again when an agent leaves and comes back', () => {
    const wake = new WakeConditions(['new_agent_within_5'], calm);
    const here = { health: 20, agentsWithin: () => ['pike'] };
    expect(wake.watch(here)?.reason).toBe('new_agent_within_5');
    expect(wake.watch(calm)).toBeNull();
    expect(wake.watch(here)?.reason).toBe('new_agent_within_5');
  });

  it('wants only what is listed', () => {
    const wake = new WakeConditions(['directly_addressed'], calm);
    expect(wake.wants('directly_addressed')).toBe(true);
    expect(wake.wants('goal_completed')).toBe(false);
  });
});

describe('WakeTap', () => {
  it('forwards records and tells listeners', () => {
    const inner = new MemorySink();
    const tap = new WakeTap(inner);
    const wakes: string[] = [];
    const off = tap.onWake((request) => wakes.push(request.reason));
    tap.wake({ reason: 'reflex_danger', tick: 1, intentId: null });
    off();
    tap.wake({ reason: 'limit_reached', tick: 2, intentId: null });
    expect(inner.wakes.map((w) => w.reason)).toEqual(['reflex_danger', 'limit_reached']);
    expect(wakes).toEqual(['reflex_danger']);
  });
});
