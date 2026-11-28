import { DEFAULT_THRESHOLDS } from '@geldar/psyche';
import { describe, expect, it, vi } from 'vitest';
import { type ShardServiceStarters, sinkPlan, startShardServices } from './sink-plan.ts';

function starters() {
  const stop = vi.fn(async () => undefined);
  const fake: ShardServiceStarters = {
    startState: vi.fn(() => ({ stop })),
    startOutbox: vi.fn(() => ({ stop })),
  };
  return fake;
}

describe('sinkPlan: the environment read by eventsink main', () => {
  it('unset is the old behaviour: no shard, XP off, default thresholds', () => {
    expect(sinkPlan({})).toEqual({
      shard: undefined,
      xp: { enabled: false, thresholds: DEFAULT_THRESHOLDS },
    });
  });

  it('a blank GELDAR_SHEET_SHARD is unset, not a shard named ""', () => {
    expect(sinkPlan({ GELDAR_SHEET_SHARD: '' }).shard).toBeUndefined();
    expect(sinkPlan({ GELDAR_SHEET_SHARD: '   ' }).shard).toBeUndefined();
  });

  it('three blank variables, as colo.yml passes them through when the host sets nothing, equal unset', () => {
    const blank = { GELDAR_SHEET_SHARD: '', GELDAR_XP: '', GELDAR_PROFICIENCY_THRESHOLDS: '' };
    expect(sinkPlan(blank)).toEqual(sinkPlan({}));
    expect(sinkPlan(blank).shard).toBeUndefined();
    expect(sinkPlan(blank).xp).toEqual({ enabled: false, thresholds: DEFAULT_THRESHOLDS });
    expect(startShardServices(sinkPlan(blank), starters())).toEqual([]);
  });

  it('reads the shard name when it is set', () => {
    expect(sinkPlan({ GELDAR_SHEET_SHARD: 'colo' }).shard).toBe('colo');
  });

  it('XP is on only for GELDAR_XP exactly 1', () => {
    expect(sinkPlan({ GELDAR_XP: '1' }).xp.enabled).toBe(true);
    expect(sinkPlan({ GELDAR_XP: '0' }).xp.enabled).toBe(false);
    expect(sinkPlan({ GELDAR_XP: 'true' }).xp.enabled).toBe(false);
  });

  it('never reads GELDAR_PROFICIENCY_THRESHOLDS while XP is off: a typo cannot stop the sink', () => {
    const env = { GELDAR_PROFICIENCY_THRESHOLDS: '30,10,70' };
    expect(() => sinkPlan(env)).not.toThrow();
    expect(sinkPlan(env).xp).toEqual({ enabled: false, thresholds: DEFAULT_THRESHOLDS });
  });

  it('reads the thresholds when XP is on, and a malformed list fails at startup', () => {
    expect(sinkPlan({ GELDAR_XP: '1', GELDAR_PROFICIENCY_THRESHOLDS: '5,10,20' }).xp).toEqual({
      enabled: true,
      thresholds: [5, 10, 20],
    });
    expect(() => sinkPlan({ GELDAR_XP: '1', GELDAR_PROFICIENCY_THRESHOLDS: '30,10,70' })).toThrow(
      RangeError,
    );
  });

  it('refuses custom thresholds next to the state service: the Body checks levels with the defaults', () => {
    const custom = {
      GELDAR_SHEET_SHARD: 'colo',
      GELDAR_XP: '1',
      GELDAR_PROFICIENCY_THRESHOLDS: '5,10,20',
    };
    expect(() => sinkPlan(custom)).toThrow(RangeError);
    // Custom thresholds with no shard run no state service, so they are allowed.
    expect(() => sinkPlan({ ...custom, GELDAR_SHEET_SHARD: undefined })).not.toThrow();
  });
});

describe('startShardServices: the unset path starts nothing', () => {
  it('starts neither the state service nor the outbox publisher when no shard is set', () => {
    const fake = starters();
    const handles = startShardServices(sinkPlan({ GELDAR_XP: '1' }), fake);
    expect(handles).toEqual([]);
    expect(fake.startState).not.toHaveBeenCalled();
    expect(fake.startOutbox).not.toHaveBeenCalled();
  });

  it('starts the state service and the outbox publisher, in that order, when GELDAR_SHEET_SHARD is set', () => {
    const fake = starters();
    const handles = startShardServices(sinkPlan({ GELDAR_SHEET_SHARD: 'colo' }), fake);
    expect(handles).toHaveLength(2);
    expect(fake.startState).toHaveBeenCalledWith('colo');
    expect(fake.startOutbox).toHaveBeenCalledWith('colo');
    expect(vi.mocked(fake.startState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fake.startOutbox).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not start the outbox when the state service throws, so a bad shard fails before anything runs', () => {
    const fake = starters();
    vi.mocked(fake.startState).mockImplementation(() => {
      throw new RangeError('invalid shard name');
    });
    expect(() => startShardServices(sinkPlan({ GELDAR_SHEET_SHARD: 'Bad Shard' }), fake)).toThrow(
      RangeError,
    );
    expect(fake.startOutbox).not.toHaveBeenCalled();
  });
});

describe('the activation config (AN-12b)', () => {
  it('shard + XP on + default thresholds succeeds and starts both shard services', () => {
    const plan = sinkPlan({ GELDAR_SHEET_SHARD: 'colo', GELDAR_XP: '1' });
    expect(plan).toEqual({ shard: 'colo', xp: { enabled: true, thresholds: DEFAULT_THRESHOLDS } });
    const stop = vi.fn(async () => undefined);
    const starters = { startState: vi.fn(() => ({ stop })), startOutbox: vi.fn(() => ({ stop })) };
    expect(startShardServices(plan, starters)).toHaveLength(2);
    expect(starters.startState).toHaveBeenCalledWith('colo');
    expect(starters.startOutbox).toHaveBeenCalledWith('colo');
  });

  it('shard + XP on + thresholds written as the defaults is allowed', () => {
    expect(() =>
      sinkPlan({
        GELDAR_SHEET_SHARD: 'colo',
        GELDAR_XP: '1',
        GELDAR_PROFICIENCY_THRESHOLDS: '10,30,70',
      }),
    ).not.toThrow();
  });

  it('GELDAR_SHARD alone (the ambient operator variable) is inert: no shard, XP off', () => {
    const plan = sinkPlan({ GELDAR_SHARD: 'colo' });
    expect(plan.shard).toBeUndefined();
    expect(plan.xp.enabled).toBe(false);
  });
});
