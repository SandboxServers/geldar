import { describe, expect, it } from 'vitest';
import { decodeCursor, EventLog, encodeCursor } from './events.ts';

const base = { tick: 0, atMs: 0, kind: 'damage' as const, wakeOn: null };

describe('EventLog', () => {
  it('assigns seq from 1 and since(1) returns the later events', () => {
    const log = new EventLog();
    expect([log.append(base).seq, log.append(base).seq, log.append(base).seq]).toEqual([1, 2, 3]);
    expect(log.since(1).events.map((e) => e.seq)).toEqual([2, 3]);
    expect(log.lastSeq()).toBe(3);
  });

  it('keeps the last 1000 and reports the dropped count', () => {
    const log = new EventLog();
    for (let i = 0; i < 1200; i++) log.append(base);
    const r = log.since(0);
    expect(r.events).toHaveLength(1000);
    expect(r.dropped).toBe(200);
    expect(log.firstSeq()).toBe(201);
    expect(log.since(500).dropped).toBe(0);
  });

  it('does not consume events', () => {
    const log = new EventLog();
    log.append(base);
    log.append(base);
    expect(log.since(0).events).toHaveLength(2);
    expect(log.since(0).events).toHaveLength(2);
  });
});

describe('cursors', () => {
  it('round-trips and rejects bad formats', () => {
    expect(encodeCursor(12)).toBe('c_12');
    expect(decodeCursor('c_12')).toBe(12);
    expect(decodeCursor('12')).toBeNull();
    expect(decodeCursor('c_')).toBeNull();
    expect(decodeCursor('c_1234567890123')).toBeNull();
  });
});
