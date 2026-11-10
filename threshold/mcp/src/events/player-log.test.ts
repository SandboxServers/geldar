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

  it('keeps two kinds that one stream message maps to at the same sequence', async () => {
    const log = new RingEventLog();
    await log.append(LIFE, { ...ev(1), kind: 'plan_result', thought_id: 'th_1', said: true });
    await log.append(LIFE, { ...ev(1), kind: 'intent_finished', outcome: 'completed' });
    await log.append(LIFE, { ...ev(1), kind: 'intent_finished', outcome: 'failed' });
    const got = await log.since(LIFE, 0);
    expect(got.events.map((e) => e.kind)).toEqual(['plan_result', 'intent_finished']);
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

  it('keeps plan_results beside the ring, so 1000 of them evict no real event and count as no drop', async () => {
    const log = new RingEventLog({ capacity: 3 });
    await fill(log, 1, 3);
    for (let i = 1; i <= 1000; i++) {
      await log.append(LIFE, {
        ...ev(3 + i),
        kind: 'plan_result',
        thought_id: `th_${i}`,
        said: true,
      });
    }
    const got = await log.since(LIFE, 0);
    expect(got.dropped).toBe(0);
    expect(got.events.filter((e) => e.kind === 'proposal').map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(got.events.some((e) => e.kind === 'plan_result' && e.thought_id === 'th_1000')).toBe(
      true,
    );
  });

  it('returns a plan_result among the ring events in sequence order, after the cursor', async () => {
    const log = new RingEventLog();
    await log.append(LIFE, ev(1));
    await log.append(LIFE, { ...ev(2), kind: 'plan_result', thought_id: 'th_2', said: false });
    await log.append(LIFE, ev(3));
    expect((await log.since(LIFE, 0)).events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect((await log.since(LIFE, 1)).events.map((e) => e.kind)).toEqual([
      'plan_result',
      'proposal',
    ]);
  });

  it('puts an earlier sequence that arrives after a later one in order, and still ignores a repeat', async () => {
    const log = new RingEventLog();
    await log.append(LIFE, ev(4));
    await log.append(LIFE, ev(7));
    await log.append(LIFE, ev(5));
    await log.append(LIFE, ev(5));
    expect((await log.since(LIFE, 0)).events.map((e) => e.seq)).toEqual([4, 5, 7]);
  });

  it('ignores an event older than a full ring holds, without changing the ring or counting it again', async () => {
    const log = new RingEventLog({ capacity: 3 });
    await fill(log, 1, 5);
    const before = await log.since(LIFE, 0);
    expect(before.dropped).toBe(2);
    await log.append(LIFE, ev(1));
    await log.append(LIFE, ev(2));
    const after = await log.since(LIFE, 0);
    expect(after.dropped).toBe(2);
    expect(after.events.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it('keeps each life in its own ring', async () => {
    const log = new RingEventLog();
    await log.append(LIFE, ev(1));
    await log.append('ag_zack_01', ev(2));
    expect((await log.since(LIFE, 0)).events.map((e) => e.seq)).toEqual([1]);
  });
});
