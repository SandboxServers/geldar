import {
  type SovereignCallPayload,
  validateSovereignCallPayload,
  validateWorldEvent,
  type WorldEvent,
} from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  cachedStampOf,
  envelopeIdFor,
  SovereignCallRecorder,
  type SovereignCallRecorderOptions,
  type SovereignCallSink,
  sovereignCallMsgId,
} from './sovereign-call.ts';
import { WorldClock } from './world-clock.ts';

const BASE: SovereignCallPayload = {
  player_id: 'ag-jason-01',
  tool: 'act',
  outcome: 'ok',
  accepted: [0],
  rejected: [],
  credits_charged: 1,
  budget_remaining: 9,
  latency_ms: 12,
  thought_id: 'th_01HZX00000000000000000000A',
  say: 'Hello',
} as SovereignCallPayload;

const AT = Date.parse('2026-11-13T17:20:00.000Z');

class CollectingSink implements SovereignCallSink {
  readonly published: { msgId: string; event: WorldEvent }[] = [];

  async publish(msgId: string, event: WorldEvent): Promise<void> {
    this.published.push({ msgId, event });
  }
}

function clockAt(tick: number): WorldClock {
  const clock = new WorldClock();
  clock.observe({ world_day: 85, world_tick: tick });
  return clock;
}

function recorderFor(
  sink: CollectingSink,
  clock: WorldClock,
  drops: string[] = [],
  extra: Partial<SovereignCallRecorderOptions> = {},
) {
  return new SovereignCallRecorder({
    sink,
    shard: 'colo',
    clock,
    drop: (reason) => drops.push(reason),
    now: () => AT,
    ...extra,
  });
}

describe('sovereign_call record', () => {
  it('derives the Nats-Msg-Id from the thought id', () => {
    expect(sovereignCallMsgId(BASE)).toBe('sovereign_call:th_01HZX00000000000000000000A');
  });

  it('publishes a WorldEvent envelope whose payload validates as a sovereign call', async () => {
    const sink = new CollectingSink();
    await recorderFor(sink, clockAt(2054169)).record(BASE);
    expect(sink.published).toHaveLength(1);
    const [sent] = sink.published;
    expect(sent?.msgId).toBe('sovereign_call:th_01HZX00000000000000000000A');
    const envelope = validateWorldEvent(sent?.event);
    expect(envelope.ok).toBe(true);
    expect(sent?.event).toEqual({
      source_event_id: envelopeIdFor('sovereign_call:th_01HZX00000000000000000000A'),
      at: '2026-11-13T17:20:00.000Z',
      shard: 'colo',
      world_day: 85,
      world_tick: 2054169,
      type: 'sovereign_call',
      payload: BASE,
    });
    expect(validateSovereignCallPayload(sent?.event.payload).ok).toBe(true);
  });

  it('gives the envelope a source_event_id in the contract shape', () => {
    expect(envelopeIdFor('sovereign_call:th_01HZX00000000000000000000A')).toMatch(
      /^ev_[0-9A-HJKMNP-TV-Z]{26}$/,
    );
  });

  it('keeps the same source_event_id when the same call is recorded again', async () => {
    const sink = new CollectingSink();
    const recorder = recorderFor(sink, clockAt(2054169));
    await recorder.record(BASE);
    await recorder.record(BASE);
    const [first, second] = sink.published;
    expect(second?.msgId).toBe(first?.msgId);
    expect(second?.event.source_event_id).toBe(first?.event.source_event_id);
  });

  it('gives two calls with different plans different source_event_ids', () => {
    const other = { ...BASE, thought_id: 'th_01HZX00000000000000000000B' };
    expect(envelopeIdFor(sovereignCallMsgId(BASE))).not.toBe(
      envelopeIdFor(sovereignCallMsgId(other)),
    );
  });

  it('gives a call with no plan a fresh id each time', () => {
    const noPlan = { ...BASE, thought_id: undefined } as unknown as SovereignCallPayload;
    expect(sovereignCallMsgId(noPlan)).not.toBe(sovereignCallMsgId(noPlan));
  });

  it('drops a payload the schema rejects, publishes nothing and does not throw', async () => {
    const sink = new CollectingSink();
    const drops: string[] = [];
    const bad = { ...BASE, tool: 'teleport' } as unknown as SovereignCallPayload;
    await expect(recorderFor(sink, clockAt(1), drops).record(bad)).resolves.toBeUndefined();
    expect(sink.published).toHaveLength(0);
    expect(drops.join(' ')).toMatch(/schema/);
  });

  it('drops a call made before any world clock is seen, and the call still succeeds', async () => {
    const sink = new CollectingSink();
    const drops: string[] = [];
    await expect(recorderFor(sink, new WorldClock(), drops).record(BASE)).resolves.toBeUndefined();
    expect(sink.published).toHaveLength(0);
    expect(drops).toEqual(['sovereign_call has no world clock yet']);
  });

  it('drops an envelope the contract refuses (a shard name it cannot take), without throwing', async () => {
    const sink = new CollectingSink();
    const drops: string[] = [];
    const recorder = new SovereignCallRecorder({
      sink,
      shard: 'X',
      clock: clockAt(1),
      drop: (reason) => drops.push(reason),
    });
    await expect(recorder.record(BASE)).resolves.toBeUndefined();
    expect(sink.published).toHaveLength(0);
    expect(drops.join(' ')).toMatch(/envelope failed the contract/);
  });
});

describe('sovereign_call stamp (GX-01c)', () => {
  it('envelope carries harness and model', async () => {
    const sink = new CollectingSink();
    const stampOf = async () => ({ harness: 'claude', model: 'claude-sonnet-5.5' });
    await recorderFor(sink, clockAt(1), [], { stampOf }).record(BASE);
    const [sent] = sink.published;
    expect(sent?.event.harness).toBe('claude');
    expect(sent?.event.model).toBe('claude-sonnet-5.5');
    expect(validateWorldEvent(sent?.event).ok).toBe(true);
  });

  it('asks the resolver for the calling player', async () => {
    const asked: string[] = [];
    const stampOf = async (playerId: string) => {
      asked.push(playerId);
      return { harness: 'claude' };
    };
    await recorderFor(new CollectingSink(), clockAt(1), [], { stampOf }).record(BASE);
    expect(asked).toEqual(['ag-jason-01']);
  });

  it('a placeholder model is omitted, and the harness is kept', async () => {
    const sink = new CollectingSink();
    const stampOf = async () => ({ harness: 'claude', model: 'self-reported' });
    await recorderFor(sink, clockAt(1), [], { stampOf }).record(BASE);
    const [sent] = sink.published;
    expect(sent?.event.harness).toBe('claude');
    expect(sent?.event).not.toHaveProperty('model');
  });

  it('a resolver that throws publishes a stamp-less envelope and reports a drop', async () => {
    const sink = new CollectingSink();
    const drops: string[] = [];
    const stampOf = async (): Promise<{ harness?: string }> => {
      throw new Error('database is down');
    };
    await expect(
      recorderFor(sink, clockAt(1), drops, { stampOf }).record(BASE),
    ).resolves.toBeUndefined();
    expect(sink.published).toHaveLength(1);
    expect(sink.published[0]?.event).not.toHaveProperty('harness');
    expect(sink.published[0]?.event).not.toHaveProperty('model');
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatch(/stamp/);
    expect(drops.join(' ')).not.toMatch(/database is down/);
  });

  it('a resolver that answers nothing publishes a stamp-less envelope and reports nothing', async () => {
    const sink = new CollectingSink();
    const drops: string[] = [];
    const stampOf = async () => undefined;
    await recorderFor(sink, clockAt(1), drops, { stampOf }).record(BASE);
    expect(sink.published).toHaveLength(1);
    expect(sink.published[0]?.event).not.toHaveProperty('harness');
    expect(drops).toEqual([]);
  });
});

describe('cachedStampOf', () => {
  it('serves a stamp from the cache for 60 seconds, then looks again', async () => {
    let now = 0;
    let calls = 0;
    const cached = cachedStampOf(
      async () => {
        calls += 1;
        return { harness: 'claude' };
      },
      60_000,
      () => now,
    );
    await cached('ag-jason-01');
    now = 59_999;
    await cached('ag-jason-01');
    expect(calls).toBe(1);
    now = 60_000;
    await cached('ag-jason-01');
    expect(calls).toBe(2);
  });

  it('keeps each player stamp apart', async () => {
    const seen: string[] = [];
    const cached = cachedStampOf(
      async (playerId) => {
        seen.push(playerId);
        return { harness: 'claude' };
      },
      60_000,
      () => 0,
    );
    await cached('ag-jason-01');
    await cached('ag-mara-02');
    await cached('ag-jason-01');
    expect(seen).toEqual(['ag-jason-01', 'ag-mara-02']);
  });

  it('does not cache a failed lookup, so the next call looks again', async () => {
    let fail = true;
    let calls = 0;
    const cached = cachedStampOf(
      async () => {
        calls += 1;
        if (fail) throw new Error('down');
        return { harness: 'claude' };
      },
      60_000,
      () => 0,
    );
    await expect(cached('ag-jason-01')).rejects.toThrow('down');
    fail = false;
    await expect(cached('ag-jason-01')).resolves.toEqual({ harness: 'claude' });
    expect(calls).toBe(2);
  });
});
