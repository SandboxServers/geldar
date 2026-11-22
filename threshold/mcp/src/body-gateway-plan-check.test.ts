import { planCheckSubject } from '@geldar/contract';
import type { ChunkStream, RequestTransport } from '@geldar/player-core/src/link/nats-body-link.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NatsBodyGateway, PLAN_CHECK_IDLE_MS } from './body-gateway.ts';
import { BodyUnavailable } from './ports.ts';

const SHARD = 'phase0';
const LIFE = 'ag_jason_01';
const SUBJECT = planCheckSubject(SHARD, LIFE);
const PLAN = { plan: { palette: {}, steps: [] } };
const RESULT = {
  cells: 0,
  material_needs: {},
  unknown_cells: 0,
  estimated_ticks: 0,
  invalid_steps: [],
};
const RESULT_TEXT = JSON.stringify(RESULT);
const CANCEL = '{"cancel":true}';

/** A chunk stream the test feeds: `push` answers a pending `next`, or queues the chunk. */
class FakeStream implements ChunkStream {
  closed = false;
  private readonly queue: string[] = [];
  private waiter: ((text: string | null) => void) | null = null;

  push(text: string): void {
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(text);
    } else {
      this.queue.push(text);
    }
  }

  next(): Promise<string | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  close(): void {
    this.closed = true;
    const resolve = this.waiter;
    this.waiter = null;
    resolve?.(null);
  }
}

/** A transport that streams: each `stream` call opens a fake stream; `request` (the cancel) is recorded. */
class StreamTransport implements RequestTransport {
  readonly streams: FakeStream[] = [];
  readonly calls: { subject: string; body: string; timeoutMs: number }[] = [];

  async request(subject: string, body: string, timeoutMs: number): Promise<string> {
    this.calls.push({ subject, body, timeoutMs });
    return JSON.stringify({ error: 'invalid_input' });
  }

  stream(): ChunkStream {
    const stream = new FakeStream();
    this.streams.push(stream);
    return stream;
  }
}

/** A transport with no streaming: the gateway reads its one reply as the only chunk. */
class RequestOnlyTransport implements RequestTransport {
  async request(): Promise<string> {
    return RESULT_TEXT;
  }
}

function settle<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}

function progress(layers: number, cells: number): string {
  return JSON.stringify({ progress: { layers_done: layers, cells_checked: cells } });
}

describe('NatsBodyGateway plan_check (streamed)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a plan check longer than the idle timeout in total completes while it reports progress', async () => {
    const transport = new StreamTransport();
    const outcome = settle(new NatsBodyGateway({ transport, shard: SHARD }).planCheck(LIFE, PLAN));
    const stream = transport.streams[0];
    // Six chunks 3 s apart: 18 s in total, well past the 5 s window, but never a 5 s gap.
    for (let i = 1; i <= 6; i++) {
      await vi.advanceTimersByTimeAsync(3_000);
      stream?.push(progress(i, i * 1_000));
    }
    stream?.push(RESULT_TEXT);
    expect(await outcome).toEqual({ value: RESULT });
    expect(stream?.closed).toBe(true);
    expect(transport.calls).toEqual([]);
  });

  it('a walk with no chunk for the idle timeout fails as stalled, not as a size refusal, and cancels the walk', async () => {
    const transport = new StreamTransport();
    const outcome = settle(new NatsBodyGateway({ transport, shard: SHARD }).planCheck(LIFE, PLAN));
    await vi.advanceTimersByTimeAsync(PLAN_CHECK_IDLE_MS);
    const result = await outcome;
    if (!('error' in result)) throw new Error('a stalled walk must not resolve');
    expect(result.error).toBeInstanceOf(BodyUnavailable);
    const cause = (result.error as { cause?: unknown }).cause;
    expect((cause as Error).message).toContain('plan check stalled');
    expect(transport.streams[0]?.closed).toBe(true);
    expect(transport.calls).toEqual([
      { subject: SUBJECT, body: CANCEL, timeoutMs: PLAN_CHECK_IDLE_MS },
    ]);
  });

  it('a chunk just inside the idle window resets it: a stall is measured from the last chunk', async () => {
    const transport = new StreamTransport();
    const outcome = settle(new NatsBodyGateway({ transport, shard: SHARD }).planCheck(LIFE, PLAN));
    await vi.advanceTimersByTimeAsync(PLAN_CHECK_IDLE_MS - 1);
    transport.streams[0]?.push(progress(1, 1));
    await vi.advanceTimersByTimeAsync(PLAN_CHECK_IDLE_MS - 1);
    expect(transport.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect('error' in (await outcome)).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  it('a stalled check that a newer check has superseded sends no cancel of its own', async () => {
    const transport = new StreamTransport();
    const gateway = new NatsBodyGateway({ transport, shard: SHARD });
    const older = settle(gateway.planCheck(LIFE, PLAN));
    const newer = settle(gateway.planCheck(LIFE, PLAN));
    await vi.advanceTimersByTimeAsync(PLAN_CHECK_IDLE_MS);
    expect('error' in (await older)).toBe(true);
    expect('error' in (await newer)).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  it('a flag-off not_available reply is a failure, never data', async () => {
    const transport = new StreamTransport();
    const outcome = settle(new NatsBodyGateway({ transport, shard: SHARD }).planCheck(LIFE, PLAN));
    transport.streams[0]?.push(JSON.stringify({ error: 'not_available' }));
    expect('error' in (await outcome)).toBe(true);
    expect(transport.calls).toEqual([]);
  });

  it('a transport without streaming reads its one reply as the answer', async () => {
    const gateway = new NatsBodyGateway({ transport: new RequestOnlyTransport(), shard: SHARD });
    expect(await gateway.planCheck(LIFE, PLAN)).toEqual(RESULT);
  });
});
