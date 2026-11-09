import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import type { RunningAdamBody } from './adam-body.ts';
import { BodySupervisor, FatalBodyError, type SupervisorOptions } from './main.ts';

/** A Body whose end the test triggers. */
function fakeBody(generation: number, calls: string[]): RunningAdamBody & { end(r: string): void } {
  let end: (reason: string) => void = () => undefined;
  const ended = new Promise<string>((resolve) => {
    end = resolve;
  });
  return {
    lifeId: 'ag_adam_01',
    generation,
    outcome: { kind: 'idle', reason: 'no_checkpoint' },
    body: {} as RunningAdamBody['body'],
    ended,
    fail: (reason) => end(reason),
    end,
    async stop() {
      calls.push(`stop ${generation}`);
    },
  };
}

interface Rig {
  supervisor: BodySupervisor;
  bodies: ReturnType<typeof fakeBody>[];
  calls: string[];
  logs: Record<string, unknown>[];
  sleeps: number[];
  /** Resolves when the supervisor has started its n-th body. */
  started(n: number): Promise<ReturnType<typeof fakeBody>>;
}

function rig(options: Partial<SupervisorOptions> = {}): Rig {
  const bodies: ReturnType<typeof fakeBody>[] = [];
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  const supervisor = new BodySupervisor({
    acquire: async () => ({}) as Bot,
    start: async () => {
      // The generation counts up as the real restartBody's does.
      const body = fakeBody(bodies.length + 1, calls);
      bodies.push(body);
      calls.push(`start ${body.generation}`);
      return body;
    },
    log: (line) => logs.push(line),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    rng: () => 0.5,
    ...options,
  });
  return {
    supervisor,
    bodies,
    calls,
    logs,
    sleeps,
    started: async (n) => {
      while (bodies.length < n) await new Promise((resolve) => setTimeout(resolve, 0));
      return bodies[n - 1] as ReturnType<typeof fakeBody>;
    },
  };
}

describe('the Body supervisor', () => {
  it('restarts a Body whose bot ended, with the next generation, and logs the restart', async () => {
    const r = rig();
    const done = r.supervisor.run();
    (await r.started(1)).end('bot ended: kicked');
    const second = await r.started(2);
    expect(second.generation).toBe(2);
    const restart = r.logs.find((l) => l.event === 'body_restart');
    expect(restart).toMatchObject({ reason: 'bot ended: kicked', attempt: 1 });
    // The old run is stopped before the new one starts.
    expect(r.calls).toEqual(['start 1', 'stop 1', 'start 2']);
    await r.supervisor.stop();
    await done;
  });

  it('restarts after a crash reported through fail()', async () => {
    const r = rig();
    const done = r.supervisor.run();
    (await r.started(1)).fail('executor crashed');
    await r.started(2);
    expect(r.logs.find((l) => l.event === 'body_restart')?.reason).toBe('executor crashed');
    await r.supervisor.stop();
    await done;
  });

  it('backs off with a growing delay while runs keep failing and resets after a stable run', async () => {
    let clock = 0;
    const r = rig({ now: () => clock, stableMs: 10_000 });
    const done = r.supervisor.run();
    (await r.started(1)).end('x');
    (await r.started(2)).end('x');
    (await r.started(3)).end('x');
    // A run that lasted long enough starts the delays over.
    const fourth = await r.started(4);
    clock = 60_000;
    fourth.end('x');
    await r.started(5);
    expect(r.sleeps.slice(0, 3)).toEqual([1000, 2000, 4000]);
    expect(r.sleeps[3]).toBe(1000);
    await r.supervisor.stop();
    await done;
  });

  it('retries a start that throws, with backoff', async () => {
    let attempts = 0;
    const r = rig({
      acquire: async () => {
        attempts++;
        if (attempts < 3) throw new Error('connection refused');
        return {} as Bot;
      },
    });
    const done = r.supervisor.run();
    await r.started(1);
    expect(r.sleeps).toEqual([1000, 2000]);
    expect(r.logs.filter((l) => l.event === 'body_restart')).toHaveLength(2);
    await r.supervisor.stop();
    await done;
  });

  it('stops the running Body on stop and does not start another', async () => {
    const r = rig();
    const done = r.supervisor.run();
    await r.started(1);
    await r.supervisor.stop();
    await done;
    expect(r.calls).toEqual(['start 1', 'stop 1']);
    expect(r.supervisor.running).toBeNull();
    expect(r.logs.some((l) => l.event === 'body_restart')).toBe(false);
  });

  it('ends without retrying on a fatal connection error', async () => {
    const r = rig({
      acquire: async () => {
        throw new FatalBodyError('banned');
      },
    });
    await r.supervisor.run();
    expect(r.bodies).toHaveLength(0);
    expect(r.logs.some((l) => l.event === 'body_fatal')).toBe(true);
  });
});
