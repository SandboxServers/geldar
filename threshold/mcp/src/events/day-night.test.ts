import { describe, expect, it } from 'vitest';
import { dayNightMsgId, forecastPhases, phaseAt } from './day-night.ts';

describe('day-night', () => {
  it('derives one Nats-Msg-Id per shard, day and phase', () => {
    expect(dayNightMsgId('phase0', 3, 'dusk')).toBe(dayNightMsgId('phase0', 3, 'dusk'));
    expect(dayNightMsgId('phase0', 3, 'dusk')).not.toBe(dayNightMsgId('phase0', 3, 'dawn'));
    expect(dayNightMsgId('phase0', 3, 'dusk')).not.toBe(dayNightMsgId('phase0', 4, 'dusk'));
  });

  it('names the phase at a tick and wraps every day', () => {
    expect(phaseAt(0)).toBe('dawn');
    expect(phaseAt(1000)).toBe('day');
    expect(phaseAt(12500)).toBe('dusk');
    expect(phaseAt(13000)).toBe('night');
    expect(phaseAt(24000 + 12500)).toBe('dusk');
  });

  it('predicts the next dusk and dawn from the last tick and the tick rate', () => {
    const forecast = forecastPhases(0, 20, 0, 4);
    expect(forecast.map((f) => [f.phase, f.atMs])).toEqual([
      ['day', 50_000],
      ['dusk', 600_000],
      ['night', 650_000],
      ['dawn', 1_200_000],
    ]);
  });

  it('refuses a tick rate that is not positive', () => {
    expect(() => forecastPhases(0, 0, 0)).toThrow(RangeError);
  });
});
