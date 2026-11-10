import type { SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it } from 'vitest';
import { RingEventLog } from './player-log.ts';

const LIFE = 'ag_jason_01';

function ev(seq: number): SimEvent {
  return { seq, tick: seq, atMs: seq, kind: 'proposal', wakeOn: null };
}

async function fill(log: RingEventLog, from: number, to: number): Promise<void> {
  for (let seq = from; seq <= to; seq++) await log.append(LIFE, ev(seq));
}

describe('RingEventLog', () => {
  it('returns the events after the cursor in order and ignores a sequence already held', async () => {
    const log = new RingEventLog();
    await fill(log, 1, 4);
    await log.append(LIFE, ev(4));
    const got = await log.since(LIFE, 2);
    expect(got.events.map((e) => e.seq)).toEqual([3, 4]);
    expect(got.dropped).toBe(0);
  });

  it('counts exactly the events that left the ring when there is no backfill', async () => {
    const log = new RingEventLog({ capacity: 3 });
    await fill(log, 1, 5);
    const got = await log.since(LIFE, 0);
    expect(got.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(got.dropped).toBe(2);
    expect((await log.since(LIFE, 3)).dropped).toBe(0);
  });

  it('serves an old cursor from the stream backfill, and counts what the backfill does not return', async () => {
    const asked: number[][] = [];
    const log = new RingEventLog({
      capacity: 3,
      backfill: async (_life, afterSeq, limit) => {
        asked.push([afterSeq, limit]);
        return [ev(2)].filter((e) => e.seq > afterSeq && e.seq <= 2);
      },
    });
    await fill(log, 1, 5);
    const got = await log.since(LIFE, 0);
    expect(asked).toEqual([[0, 20_000]]);
    expect(got.events.map((e) => e.seq)).toEqual([2, 3, 4, 5]);
    expect(got.dropped).toBe(1);
  });

  it('keeps each life in its own ring', async () => {
    const log = new RingEventLog();
    await log.append(LIFE, ev(1));
    await log.append('ag_zack_01', ev(2));
    expect((await log.since(LIFE, 0)).events.map((e) => e.seq)).toEqual([1]);
  });
});
