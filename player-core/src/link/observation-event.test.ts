import { describe, expect, it } from 'vitest';
import { eventOf } from './link.fixtures.ts';
import { MIND_EVENT_TYPES, normaliseEvent } from './mind-event.ts';

const GIFT_ATTRIBUTED = {
  kind: 'gift_received',
  actor: { name: 'Zack', life: 'ag_zack_01' },
  item: 'bread',
  count: 3,
  key: 'gift:100:zack:bread:3:0',
};

describe('observation events in the Mind normaliser', () => {
  it('observation is in MIND_EVENT_TYPES', () => {
    expect(MIND_EVENT_TYPES).toContain('observation');
  });

  it('each observation kind normalises, attributed and unattributed', () => {
    const cases = [
      GIFT_ATTRIBUTED,
      { kind: 'gift_received', item: 'bread', count: 3, key: 'gift:100:none:bread:3:0' },
      { kind: 'property_broken', block: 'chest', key: 'brk:100:1:64:3:none' },
    ];
    for (const payload of cases) {
      const out = normaliseEvent({ ...eventOf('observation'), payload });
      expect(out.status, JSON.stringify(payload)).toBe('event');
      if (out.status === 'event') {
        expect(out.event.type).toBe('observation');
        expect(out.event.payload).toEqual(payload);
      }
    }
  });

  it('an unknown observation kind is invalid in the normaliser (not thrown)', () => {
    const bad = {
      ...eventOf('observation'),
      payload: { kind: 'foo', key: 'gift:100:none:bread:3:0' },
    };
    expect(() => normaliseEvent(bad)).not.toThrow();
    expect(normaliseEvent(bad).status).toBe('invalid');
  });

  it('a known AN-24 kind with a valid payload normalises to an event (the presenter drops it)', () => {
    const fight = {
      ...eventOf('observation'),
      payload: { kind: 'fight_seen', target: 'zombie', key: 'fight:100:zombie:0' },
    };
    expect(normaliseEvent(fight).status).toBe('event');
  });

  it('a gift with a name failing the LifeId or the name pattern is invalid', () => {
    const bad = {
      ...eventOf('observation'),
      payload: { ...GIFT_ATTRIBUTED, actor: { name: 'Z', life: 'ag_zack_01' } },
    };
    expect(normaliseEvent(bad).status).toBe('invalid');
  });
});
