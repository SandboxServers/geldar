import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelperRuntime } from './helper-client.ts';
import type { CtlMsg } from './nats.ts';
import {
  type CtlSubscription,
  type RunConnection,
  runSupervisor,
  SHUTDOWN_TIMEOUT_MS,
} from './run.ts';
import type { Supervisor } from './service.ts';

const encoder = new TextEncoder();
const reply = encoder.encode('{"ok":true,"code":"started"}');

interface Harness {
  events: string[];
  logs: string[];
  subscribed: string[];
  requested: string[];
  push(msg: CtlMsg): void;
  /** The subscription ends without a drain, as a lost connection would end it. */
  closeFromServer(): void;
  nc: RunConnection;
  pool: { end(): Promise<void> };
  exit(code: number): void;
}

// A fake connection and pool that record the order of every call. `drainFails` makes the connection drain reject.
function harness(opts: { drainFails?: boolean } = {}): Harness {
  const events: string[] = [];
  const logs: string[] = [];
  const subscribed: string[] = [];
  const requested: string[] = [];
  const queue: CtlMsg[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  const wakeUp = () => {
    const next = wake;
    wake = undefined;
    next?.();
  };
  const sub: CtlSubscription = {
    async drain() {
      events.push('sub.drain');
      ended = true;
      wakeUp();
    },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          for (;;) {
            const msg = queue.shift();
            if (msg) return { value: msg, done: false };
            if (ended) return { value: undefined, done: true };
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
      };
    },
  };
  const nc: RunConnection = {
    subscribe: (subject) => {
      subscribed.push(subject);
      return sub;
    },
    publish: (subject) => {
      events.push(`publish ${subject}`);
    },
    drain: async () => {
      events.push('nc.drain');
      if (opts.drainFails) throw new Error('connection closed');
    },
    request: async (subject) => {
      requested.push(subject);
      return { data: reply };
    },
  };
  return {
    events,
    logs,
    subscribed,
    requested,
    push: (msg) => {
      queue.push(msg);
      wakeUp();
    },
    closeFromServer: () => {
      ended = true;
      wakeUp();
    },
    nc,
    pool: {
      end: async () => {
        events.push('pool.end');
      },
    },
    exit: (code) => {
      events.push(`exit ${code}`);
    },
  };
}

function startMsg(shard: string, inbox: string): CtlMsg {
  return {
    subject: `geldar.${shard}.ctl.body.start`,
    data: encoder.encode('{"op":"start"}'),
    reply: inbox,
  };
}

// A supervisor whose `start` waits on `gate` before it answers, so a test decides when the in-flight answer settles.
function gatedSupervisor(h: Harness, gate: Promise<void>): (runtime: HelperRuntime) => Supervisor {
  return () => ({
    handle: async () => {
      h.events.push('handle');
      await gate;
      return { ok: true, code: 'started' };
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runSupervisor', () => {
  it('serves the shard control wildcard and sends helper start on the shard subject', async () => {
    const h = harness();
    const run = runSupervisor({
      shard: 'colo',
      nc: h.nc,
      pool: h.pool,
      log: (line) => h.logs.push(line),
      exit: h.exit,
      buildSupervisor: (runtime) => ({
        handle: async () => {
          await runtime.start({ ownerId: 'owner-1', playerName: 'Alex' });
          return { ok: true, code: 'started' };
        },
      }),
    });
    h.push(startMsg('colo', 'INBOX.1'));
    await vi.waitFor(() => expect(h.events).toContain('publish INBOX.1'));
    expect(h.subscribed).toEqual(['geldar.colo.ctl.body.>']);
    expect(h.requested).toEqual(['geldar.colo.helper.body.start']);
    await run.stop();
  });

  it('a subscription that ends outside a stop logs the counted line and exits 1', async () => {
    const h = harness();
    const run = runSupervisor({
      shard: 'colo',
      nc: h.nc,
      pool: h.pool,
      log: (line) => h.logs.push(line),
      exit: h.exit,
      buildSupervisor: () => ({ handle: async () => ({ ok: true, code: 'started' }) }),
    });
    h.closeFromServer();
    await run.ended;
    expect(h.events).toEqual(['exit 1']);
    expect(h.logs.at(-1)).toMatch(
      /^supervisor: control subscription ended unexpectedly dropped=0 /,
    );
  });

  it('a normal stop drains the subscription, settles the in-flight answer, then drains and exits 0', async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = runSupervisor({
      shard: 'colo',
      nc: h.nc,
      pool: h.pool,
      log: (line) => h.logs.push(line),
      exit: h.exit,
      buildSupervisor: gatedSupervisor(h, gate),
    });
    h.push(startMsg('colo', 'INBOX.2'));
    await vi.waitFor(() => expect(h.events).toContain('handle'));
    const stopping = run.stop();
    // Release only after a macrotask, so a stop that drained the connection without waiting would already have done so.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.events).not.toContain('nc.drain');
    release();
    await stopping;
    await run.ended;
    expect(h.events).toEqual([
      'handle',
      'sub.drain',
      'publish INBOX.2',
      'nc.drain',
      'pool.end',
      'exit 0',
    ]);
  });

  it('a stop that waits past SHUTDOWN_TIMEOUT_MS logs the fixed line and exits 1 without draining', async () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(8_000);
    vi.useFakeTimers();
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = runSupervisor({
      shard: 'colo',
      nc: h.nc,
      pool: h.pool,
      log: (line) => h.logs.push(line),
      exit: h.exit,
      buildSupervisor: gatedSupervisor(h, gate),
    });
    h.push(startMsg('colo', 'INBOX.3'));
    const stopping = run.stop();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);
    expect(h.events).not.toContain('exit 1');
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(h.logs).toContain('supervisor: shutdown timed out');
    expect(h.events).toContain('exit 1');
    expect(h.events).not.toContain('nc.drain');
    expect(h.events).not.toContain('pool.end');
    release();
  });

  it('a connection drain that fails exits 1 with the fixed line and does not end the pool', async () => {
    const h = harness({ drainFails: true });
    const run = runSupervisor({
      shard: 'colo',
      nc: h.nc,
      pool: h.pool,
      log: (line) => h.logs.push(line),
      exit: h.exit,
      buildSupervisor: () => ({ handle: async () => ({ ok: true, code: 'started' }) }),
    });
    await run.stop();
    expect(h.logs).toContain('supervisor: shutdown failed');
    expect(h.events).toEqual(['sub.drain', 'nc.drain', 'exit 1']);
  });

  it('a second stop is a no-op: one drain and one exit', async () => {
    const h = harness();
    const run = runSupervisor({
      shard: 'colo',
      nc: h.nc,
      pool: h.pool,
      log: (line) => h.logs.push(line),
      exit: h.exit,
      buildSupervisor: () => ({ handle: async () => ({ ok: true, code: 'started' }) }),
    });
    await Promise.all([run.stop(), run.stop()]);
    await run.ended;
    expect(h.events.filter((event) => event === 'nc.drain')).toHaveLength(1);
    expect(h.events.filter((event) => event.startsWith('exit'))).toEqual(['exit 0']);
  });
});
