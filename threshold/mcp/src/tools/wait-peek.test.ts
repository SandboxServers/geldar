import type { Snapshot } from '@geldar/contract';
import { FakeClock, type SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it, vi } from 'vitest';
import { RingEventLog } from '../events/player-log.ts';
import { BodyUnavailable } from '../ports.ts';
import { createWaitState, peekHonoured, type WaitDeps, wait } from './wait.ts';

// GX-08: a peek (the instinct class's non-advancing wait) against the wait fixture of wait.test.ts.
const LIFE = 'ag_jason_01';

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(overrides: Partial<WaitDeps> = {}) {
  const clock = new FakeClock(0);
  const log = new RingEventLog();
  const deps: WaitDeps = {
    clock,
    keepAlive: { start: vi.fn(() => () => undefined) },
    log,
    body: { snapshot: vi.fn(async () => snapshot()) },
    budget: { balance: vi.fn(async () => 5) },
    sleeps: { read: vi.fn(async () => ({ lastSleepDay: 1, cursor: 0 })) },
    runs: new Map(),
    config: { minSpacingMs: 0, intentRunTooLongMs: 600_000 },
    state: createWaitState(),
    pollMs: 1000,
    ...overrides,
  };
  return { clock, log, deps };
}

function snapshot(): Snapshot {
  return {
    world_time: { day: 1 },
    self: {},
    heard: [],
    events_since_last_thought: [],
    surroundings: { notable_blocks: [] },
  } as unknown as Snapshot;
}

function speech(seq: number, atMs: number, addressed: boolean, text: string): SimEvent {
  return { seq, tick: seq, atMs, kind: 'speech', addressed, from: 'Adam', text, wakeOn: null };
}

async function advance(clock: FakeClock, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    await flush();
    await clock.advance(1000);
  }
  await flush();
}

describe('peekHonoured (the GX-08 gate)', () => {
  it('is true only for an instinct connection that asks for a peek', () => {
    expect(peekHonoured('instinct', true)).toBe(true);
    // a model connection's peek is an ordinary wait: the gate is false for it (and for no class)
    expect(peekHonoured('model', true)).toBe(false);
    expect(peekHonoured(undefined, true)).toBe(false);
    expect(peekHonoured('instinct', undefined)).toBe(false);
    expect(peekHonoured('instinct', false)).toBe(false);
  });
});

describe('a plain wait (the model class, peek ignored)', () => {
  it('advances the delivered mark, sets the wake time, and replaces an open wait', async () => {
    const { clock, log, deps } = setup();
    await log.append(LIFE, speech(1, 0, true, 'hi'));
    const first = wait(deps, { lifeId: LIFE, maxSeconds: 60 });
    await flush();
    const plain = await wait(deps, { lifeId: LIFE, cursor: 'c_0', maxSeconds: 5 });
    expect(await first).toEqual({ ok: false, error: 'wait_replaced' });
    expect(plain.ok && plain.result.wake_reason).toBe('directly_addressed');
    expect(deps.state.lastWakeMs.get(LIFE)).toBe(clock.nowMs());
    expect(deps.state.delivered.get(LIFE)).toBe(1);
  });
});

describe('an instinct peek (GX-08)', () => {
  it('returns the events after the cursor and moves none of the wait state', async () => {
    const { log, deps } = setup();
    await log.append(LIFE, speech(1, 0, true, 'hi'));
    const peek = await wait(deps, { lifeId: LIFE, cursor: 'c_0', maxSeconds: 5, peek: true });
    expect(peek.ok).toBe(true);
    if (!peek.ok) return;
    expect(peek.result.wake_reason).toBe('directly_addressed');
    expect(peek.result.events.map((e) => e.seq)).toEqual([1]);
    expect(peek.result.cursor).toBe('c_1');
    expect(deps.state.delivered.size).toBe(0);
    expect(deps.state.lastWakeMs.size).toBe(0);
    expect(deps.state.open.size).toBe(0);
    expect(deps.state.sent.size).toBe(0);
  });

  it('after the cursor only: a cursor at the head returns no event from before it', async () => {
    const { clock, log, deps } = setup();
    await log.append(LIFE, speech(1, 0, true, 'hi'));
    const past = wait(deps, { lifeId: LIFE, cursor: 'c_1', maxSeconds: 5, peek: true });
    await advance(clock, 5);
    const settled = await past;
    expect(settled.ok && settled.result.events).toEqual([]);
    expect(deps.state.delivered.size).toBe(0);
  });

  it('does not replace an open model wait, and the model wait still runs to its own end', async () => {
    const { clock, deps } = setup();
    const model = wait(deps, { lifeId: LIFE, maxSeconds: 60 });
    await flush();
    const peek = wait(deps, { lifeId: LIFE, maxSeconds: 5, peek: true });
    await advance(clock, 5);
    const ended = await peek;
    expect(ended.ok && ended.result.wake_reason).toBe('timeout');
    let settled = false;
    void model.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    await advance(clock, 60);
    expect((await model).ok).toBe(true);
  });

  it('a superseded session still ends a peek, with session_superseded', async () => {
    const { clock, deps } = setup();
    const controller = new AbortController();
    const p = wait(deps, { lifeId: LIFE, maxSeconds: 60, signal: controller.signal, peek: true });
    await flush();
    controller.abort();
    await advance(clock, 1);
    await expect(p).resolves.toEqual({ ok: false, error: 'session_superseded' });
  });

  it('a Body that is down ends a peek as body_unavailable, with no state moved', async () => {
    // the first call is the readiness probe; the Body drops before the snapshot it returns (as wait.test.ts)
    const body = {
      snapshot: vi
        .fn()
        .mockResolvedValueOnce(snapshot())
        .mockRejectedValueOnce(new BodyUnavailable('down')),
    };
    const { deps, log } = setup({ body });
    await log.append(LIFE, speech(1, 0, true, 'hi'));
    const down = await wait(deps, { lifeId: LIFE, cursor: 'c_0', maxSeconds: 5, peek: true });
    expect(down).toEqual({ ok: false, error: 'body_unavailable' });
    expect(deps.state.lastWakeMs.size).toBe(0);
    expect(deps.state.delivered.size).toBe(0);
  });
});
