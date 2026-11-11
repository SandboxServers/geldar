import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseHub } from './sse.ts';

class FakeRes extends EventEmitter {
  destroyed = false;
  writeHead(): this {
    return this;
  }
  write(): boolean {
    return true;
  }
  end(): this {
    this.emit('close');
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

const HEARTBEAT = 15_000;
const MAX_AGE = 60_000;

describe('the maximum stream age', () => {
  let hub: SseHub;
  beforeEach(() => {
    vi.useFakeTimers();
    hub = new SseHub({
      maxClients: 5,
      perClient: 1,
      maxAgeMs: MAX_AGE,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: HEARTBEAT,
      start: async () => ({ at: '2026-11-10 00:00:00+00', id: '' }),
      fetch: async () => [],
    });
  });
  afterEach(() => {
    hub.close();
    vi.useRealTimers();
  });

  it('keeps a stream at maxAgeMs, destroys it one heartbeat later and frees its slot', () => {
    const res = new FakeRes();
    expect(hub.attach(res as unknown as ServerResponse, 'k')).toBe(true);
    vi.advanceTimersByTime(MAX_AGE);
    expect(res.destroyed).toBe(false);
    expect(hub.attach(new FakeRes() as unknown as ServerResponse, 'k')).toBe(false);
    vi.advanceTimersByTime(HEARTBEAT);
    expect(res.destroyed).toBe(true);
    expect(hub.stats().clients).toBe(0);
    expect(hub.attach(new FakeRes() as unknown as ServerResponse, 'k')).toBe(true);
  });
});
