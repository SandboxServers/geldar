import { describe, expect, it } from 'vitest';
import { MIND_EVENT_TYPES, normaliseEvent } from './mind-event.ts';

const SOURCE = 'ev_0123456789ABCDEFGHJKMNPQRS';

/** A WorldEvent envelope of type heard_sound with the given payload. */
function envelope(payload: Record<string, unknown>): unknown {
  return {
    source_event_id: SOURCE,
    at: '2026-01-01T00:00:00.000Z',
    shard: 'phase1',
    world_day: 0,
    world_tick: 1200,
    type: 'heard_sound',
    agent_id: 'ag_kestrel_01',
    payload,
  };
}

describe('heard_sound on the Mind side', () => {
  it('is one of the event types the Mind reads', () => {
    expect(MIND_EVENT_TYPES).toContain('heard_sound');
  });

  it('normalises a valid heard_sound event into a Mind event', () => {
    const out = normaliseEvent(
      envelope({ type: 'heard_sound', sound: 'hiss', dir: 'n', band: 'near' }),
    );
    expect(out.status).toBe('event');
    if (out.status !== 'event') return;
    expect(out.event).toMatchObject({ type: 'heard_sound', lifeId: 'ag_kestrel_01', tick: 1200 });
  });

  it('rejects a heard_sound payload that carries coordinates', () => {
    const out = normaliseEvent(
      envelope({ type: 'heard_sound', sound: 'hiss', dir: 'n', band: 'near', x: 1, y: 64, z: 2 }),
    );
    expect(out.status).toBe('invalid');
  });

  it('rejects a heard_sound payload with an unknown sound kind', () => {
    const out = normaliseEvent(
      envelope({ type: 'heard_sound', sound: 'laugh', dir: 'n', band: 'near' }),
    );
    expect(out.status).toBe('invalid');
  });
});
