import { describe, expect, it } from 'vitest';
import type { RunningAdamBody } from './adam-body.ts';
import { BodySupervisor } from './main.ts';
import { BodyWatchdog, type WatchSample } from './watchdog.ts';

const POLL = 5_000;

/** A fake clock, a timer the test fires by hand, and a sample the test sets. */
function rig(options: { maxRestarts?: number } = {}) {
  let clock = 0;
  let fire: () => void = () => undefined;
  const logs: Record<string, unknown>[] = [];
  let sample: WatchSample = { tick: 100, position: '1,64,1' };
  const watchdog = new BodyWatchdog({
    now: () => clock,
    every: (f) => {
      fire = f;
      return () => {
        fire = () => undefined;
      };
    },
    sample: () => sample,
    log: (line) => logs.push(line),
    limitMs: 60_000,
    pollMs: POLL,
    ...options,
  });
  const body = { lifeId: 'ag_adam_01', generation: 1 } as RunningAdamBody;
  return {
    watchdog,
    body,
    logs,
    setSample: (s: WatchSample) => {
      sample = s;
    },
    /** Advances the fake clock by `ms`, firing the timer every POLL. */
    advance(ms: number) {
      for (let spent = 0; spent < ms; spent += POLL) {
        clock += POLL;
        fire();
      }
    },
  };
}

describe('the Body watchdog', () => {
  it('does nothing while the tick advances', () => {
    const r = rig();
    const reasons: string[] = [];
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    for (let tick = 101; tick < 140; tick++) {
      r.setSample({ tick, position: '1,64,1' });
      r.advance(POLL);
    }
    expect(reasons).toEqual([]);
    expect(r.logs).toEqual([]);
  });

  it('ends a run whose tick and position stand still past the limit, and logs body_watchdog', () => {
    const r = rig();
    const reasons: string[] = [];
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(55_000);
    expect(reasons).toEqual([]);
    r.advance(5_000);
    expect(reasons).toHaveLength(1);
    expect(r.logs).toEqual([
      expect.objectContaining({
        event: 'body_watchdog',
        state: 'waking',
        action: 'restart',
        stalled_ms: 60_000,
      }),
    ]);
  });

  it('treats a position change alone as progress, and an unknown tick as a stall', () => {
    const r = rig();
    const reasons: string[] = [];
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    for (let i = 0; i < 20; i++) {
      r.setSample({ tick: 100, position: `${i},64,1` });
      r.advance(POLL);
    }
    expect(reasons).toEqual([]);
    r.setSample({ tick: null, position: null });
    r.advance(65_000);
    expect(reasons).toHaveLength(1);
    expect(r.logs[0]).toMatchObject({ state: 'unavailable' });
  });

  it('stops watching when detached', () => {
    const r = rig();
    const reasons: string[] = [];
    const detach = r.watchdog.attach(r.body, (why) => reasons.push(why));
    detach();
    r.advance(300_000);
    expect(reasons).toEqual([]);
  });

  it('backs off exponentially, allows the last attempt at the cap, then says wedged', () => {
    const r = rig();
    const reasons: string[] = [];
    // Each run is a fresh attach on the same watchdog, as the supervisor does.
    // Restart 1 at 60 s of stall.
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(55_000);
    expect(reasons).toHaveLength(0);
    r.advance(POLL);
    expect(reasons).toHaveLength(1);
    // Restart 2 needs 120 s: nothing at 115 s.
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(115_000);
    expect(reasons).toHaveLength(1);
    r.advance(POLL);
    expect(reasons).toHaveLength(2);
    // Restart 3 (the last allowed) needs 240 s.
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(235_000);
    expect(reasons).toHaveLength(2);
    r.advance(POLL);
    expect(reasons).toHaveLength(3);
    // The fourth stall is over the cap: no restart, one typed wedged line.
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(120_000);
    expect(reasons).toHaveLength(3);
    const wedged = r.logs.filter((l) => l.event === 'body_unavailable');
    expect(wedged).toEqual([
      { event: 'body_unavailable', reason: 'wedged', life_id: 'ag_adam_01' },
    ]);
    expect(r.logs.filter((l) => l.action === 'capped')).toHaveLength(1);
  });

  it('restarts again once the window has passed', () => {
    const r = rig({ maxRestarts: 1 });
    const reasons: string[] = [];
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(60_000);
    expect(reasons).toHaveLength(1);
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(300_000);
    expect(reasons).toHaveLength(1);
    r.advance(300_000);
    r.watchdog.attach(r.body, (why) => reasons.push(why));
    r.advance(60_000);
    expect(reasons).toHaveLength(2);
  });
});

describe('the supervisor with a watchdog', () => {
  it('restarts a wedged run through the body_restart path', async () => {
    const logs: Record<string, unknown>[] = [];
    let fire: () => void = () => undefined;
    let clock = 0;
    let n = 0;
    const watchdog = new BodyWatchdog({
      now: () => clock,
      every: (f) => {
        fire = f;
        return () => undefined;
      },
      sample: () => ({ tick: 5, position: '0,0,0' }),
      log: (line) => logs.push(line),
    });
    const supervisor = new BodySupervisor({
      acquire: async () => ({}) as never,
      start: async () => {
        n++;
        let end: (r: string) => void = () => undefined;
        const ended = new Promise<string>((resolve) => {
          end = resolve;
        });
        return {
          lifeId: 'ag_adam_01',
          generation: n,
          outcome: { kind: 'idle', reason: 'no_checkpoint' },
          body: {} as never,
          ended,
          fail: (reason: string) => end(reason),
          stop: async () => undefined,
        } as RunningAdamBody;
      },
      log: (line) => logs.push(line),
      sleep: async () => undefined,
      rng: () => 0.5,
      watchdog,
    });
    const done = supervisor.run();
    while (n < 1) await new Promise((resolve) => setTimeout(resolve, 0));
    clock = 61_000;
    fire();
    while (n < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs.find((l) => l.event === 'body_restart')).toMatchObject({
      reason: 'wedged: no tick or position change',
    });
    await supervisor.stop();
    await done;
  });
});
