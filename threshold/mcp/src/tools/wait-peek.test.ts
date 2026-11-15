import type { Snapshot } from '@geldar/contract';
import { FakeClock, type SimEvent } from '@geldar/mcp-mock';
import { describe, expect, it, vi } from 'vitest';
import { RingEventLog } from '../events/player-log.ts';
import type { FailureTracker } from '../failures/tracker.ts';
import { BodyUnavailable } from '../ports.ts';
import { createWaitState, peekHonoured, type WaitDeps, wait } from './wait.ts';

// GX-08: a peek (the instinct class's non-advancing wait) against the wait fixture of wait.test.ts.
const LIFE = 'ag_jason_01';
const SESSION = 's1';

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(overrides: Partial<WaitDeps> = {}) {
  const clock = new FakeClock(0);
  const log = new RingEventLog();
  const observe = vi.fn(() => []);
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
    // delta on for every life, so a plain wait records what its session was sent
    waitDelta: { all: true, lives: new Set() },
    failures: { observe } as unknown as FailureTracker,
    pollMs: 1000,
    ...overrides,
  };
  return { clock, log, deps, observe };
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

/** A Body that does not answer at all. */
function downBody(): Pick<WaitDeps['body'], 'snapshot'> {
  return {
    snapshot: vi.fn(async (): Promise<Snapshot> => {
      throw new BodyUnavailable('down');
    }),
  };
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
  it('advances the delivered mark, sets the wake time, records the session, and replaces an open wait', async () => {
    const { clock, log, deps, observe } = setup();
    await log.append(LIFE, speech(1, 0, true, 'hi'));
    const first = wait(deps, { lifeId: LIFE, maxSeconds: 60 });
    await flush();
    const plain = await wait(deps, {
      lifeId: LIFE,
      cursor: 'c_0',
      maxSeconds: 5,
      session: SESSION,
    });
    expect(await first).toEqual({ ok: false, error: 'wait_replaced' });
    expect(plain.ok && plain.result.wake_reason).toBe('directly_addressed');
    expect(deps.state.lastWakeMs.get(LIFE)).toBe(clock.nowMs());
    expect(deps.state.delivered.get(LIFE)).toBe(1);
    expect(deps.state.sent.get(LIFE)?.session).toBe(SESSION);
    expect(observe).toHaveBeenCalled();
  });
});

describe('an instinct peek (GX-08)', () => {
  it('returns the events after the cursor and moves none of the wait state', async () => {
    const { log, deps, observe } = setup();
    await log.append(LIFE, speech(1, 0, true, 'hi'));
    // a plain wait first, so the state a peek must not change is not empty
    await wait(deps, { lifeId: LIFE, cursor: 'c_0', maxSeconds: 5, session: SESSION });
    const sent = deps.state.sent.get(LIFE);
    const wakeMs = deps.state.lastWakeMs.get(LIFE);
    const delivered = deps.state.delivered.get(LIFE);
    expect(sent).toBeDefined();
    expect(wakeMs).toBeDefined();
    expect(delivered).toBe(1);
    observe.mockClear();

    const peek = await wait(deps, {
      lifeId: LIFE,
      cursor: 'c_0',
      maxSeconds: 5,
      session: SESSION,
      peek: true,
    });
    expect(peek.ok).toBe(true);
    if (!peek.ok) return;
    expect(peek.result.wake_reason).toBe('directly_addressed');
    expect(peek.result.events.map((e) => e.seq)).toEqual([1]);
    expect(peek.result.cursor).toBe('c_1');
    expect(deps.state.delivered.get(LIFE)).toBe(delivered);
    expect(deps.state.lastWakeMs.get(LIFE)).toBe(wakeMs);
    expect(deps.state.sent.get(LIFE)).toBe(sent);
    expect(deps.state.open.size).toBe(0);
    expect(observe).not.toHaveBeenCalled();
  });

  it('is not registered as an open wait while it is in flight', async () => {
    const { clock, deps } = setup();
    const peek = wait(deps, { lifeId: LIFE, cursor: 'c_0', maxSeconds: 5, peek: true });
    await flush();
    expect(deps.state.open.size).toBe(0);
    await advance(clock, 5);
    expect((await peek).ok).toBe(true);
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

  it('a Body that is down is still waited on, and the peek does not touch the state', async () => {
    const { clock, deps } = setup({ body: downBody() });
    const down = wait(deps, { lifeId: LIFE, maxSeconds: 5, peek: true });
    await advance(clock, 5);
    expect(await down).toEqual({ ok: false, error: 'body_unavailable' });
    expect(deps.state.lastWakeMs.size).toBe(0);
    expect(deps.state.delivered.size).toBe(0);
  });
});

describe('presence (GX-08): a peek neither touches presence nor asks for the Body', () => {
  it('a peek on a down Body calls neither, and still ends as body_unavailable at its deadline', async () => {
    const touchPresence = vi.fn(async () => undefined);
    const wantBody = vi.fn(async () => undefined);
    const { clock, deps } = setup({ body: downBody(), touchPresence, wantBody });
    const peek = wait(deps, { lifeId: LIFE, maxSeconds: 5, peek: true });
    await advance(clock, 5);
    expect(await peek).toEqual({ ok: false, error: 'body_unavailable' });
    expect(touchPresence).not.toHaveBeenCalled();
    expect(wantBody).not.toHaveBeenCalled();
  });

  it('a plain wait on a down Body calls both, and ends the same way', async () => {
    const touchPresence = vi.fn(async () => undefined);
    const wantBody = vi.fn(async () => undefined);
    const { clock, deps } = setup({ body: downBody(), touchPresence, wantBody });
    const plain = wait(deps, { lifeId: LIFE, maxSeconds: 5 });
    await advance(clock, 5);
    expect(await plain).toEqual({ ok: false, error: 'body_unavailable' });
    expect(touchPresence).toHaveBeenCalledWith(LIFE);
    expect(wantBody).toHaveBeenCalledWith(LIFE);
  });
});
