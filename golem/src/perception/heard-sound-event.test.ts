import { validateWorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { type HeardSoundContext, heardSoundEvent } from './heard-sound-event.ts';

const SOUND = { type: 'heard_sound', sound: 'hiss', dir: 'ne', band: 'mid' } as const;

function ctx(over: Partial<HeardSoundContext> = {}): HeardSoundContext {
  return {
    shard: 'phase1',
    lifeId: 'ag_kestrel_01',
    tick: 24_000 + 5,
    at: new Date('2026-01-01T00:00:00.000Z'),
    seq: 1,
    ...over,
  };
}

describe('heardSoundEvent', () => {
  it('builds a heard_sound WorldEvent that passes the contract', () => {
    const event = heardSoundEvent(SOUND, ctx());
    expect(event).not.toBeNull();
    expect(validateWorldEvent(event).ok).toBe(true);
    expect(event).toMatchObject({
      type: 'heard_sound',
      shard: 'phase1',
      agent_id: 'ag_kestrel_01',
      world_tick: 24_005,
      world_day: 1,
      at: '2026-01-01T00:00:00.000Z',
      payload: SOUND,
    });
  });

  it('carries no coordinates in the envelope or the payload', () => {
    const event = heardSoundEvent(SOUND, ctx());
    const text = JSON.stringify(event);
    expect(text).not.toMatch(/"(x|y|z)"/);
  });

  it('gives each heard sound its own source_event_id, and the same one for the same sound', () => {
    const first = heardSoundEvent(SOUND, ctx({ seq: 1 }));
    const second = heardSoundEvent(SOUND, ctx({ seq: 2 }));
    const again = heardSoundEvent(SOUND, ctx({ seq: 1 }));
    expect(first?.source_event_id).not.toBe(second?.source_event_id);
    expect(first?.source_event_id).toBe(again?.source_event_id);
  });

  it('returns null when the envelope fails the contract', () => {
    expect(heardSoundEvent(SOUND, ctx({ tick: -1 }))).toBeNull();
  });
});
