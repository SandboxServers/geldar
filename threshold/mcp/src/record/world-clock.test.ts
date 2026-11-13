import { describe, expect, it } from 'vitest';
import { WorldClock } from './world-clock.ts';

describe('WorldClock', () => {
  it('has no stamp before any event is seen', () => {
    expect(new WorldClock().latest()).toBeUndefined();
  });

  it('keeps the newest tick, and an older event never moves the clock back', () => {
    const clock = new WorldClock();
    clock.observe({ world_day: 85, world_tick: 2054169 });
    clock.observe({ world_day: 83, world_tick: 2006969 });
    expect(clock.latest()).toEqual({ world_day: 85, world_tick: 2054169 });
  });

  it('moves forward to a newer event, day and tick together', () => {
    const clock = new WorldClock();
    clock.observe({ world_day: 85, world_tick: 2054169 });
    clock.observe({ world_day: 86, world_tick: 2100000 });
    expect(clock.latest()).toEqual({ world_day: 86, world_tick: 2100000 });
  });
});
