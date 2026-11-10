import { describe, expect, it } from 'vitest';
import { createStreamClient, type StreamSource } from './render-stream.ts';

/** A fake EventSource: records its listeners and whether it was closed. */
class FakeSource implements StreamSource {
  static made: FakeSource[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: ((ev: { data: string }) => void)[] = [];
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  addEventListener(_type: string, listener: (ev: { data: string }) => void): void {
    this.listeners.push(listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(data: string): void {
    for (const listener of this.listeners) listener({ data });
  }
}

/** Fake timers: nothing runs until the test fires one. */
function fakeTimers() {
  const pending: { id: number; fn: () => void; ms: number }[] = [];
  let next = 1;
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = next;
        next += 1;
        pending.push({ id, fn, ms });
        return id;
      },
      clearTimeout: (id: unknown) => {
        const at = pending.findIndex((t) => t.id === id);
        if (at >= 0) pending.splice(at, 1);
      },
    },
    pending,
    fire(): void {
      const timer = pending.shift();
      timer?.fn();
    },
  };
}

/** A fake page: holds its pagehide listeners so the test can hide the page. */
function fakePage() {
  const listeners = new Set<() => void>();
  return {
    page: {
      addEventListener: (_type: 'pagehide', listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: 'pagehide', listener: () => void) => listeners.delete(listener),
    },
    listeners,
    hide: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

function setup() {
  FakeSource.made = [];
  const clock = fakeTimers();
  const page = fakePage();
  const thoughts: unknown[] = [];
  const statuses: string[] = [];
  const client = createStreamClient({
    url: '/api/stream',
    open: FakeSource as unknown as new (url: string) => StreamSource,
    timers: clock.timers,
    page: page.page,
    onThought: (data) => thoughts.push(data),
    onStatus: (status) => statuses.push(status),
  });
  const last = () => FakeSource.made[FakeSource.made.length - 1] as FakeSource;
  const openCount = () => FakeSource.made.filter((s) => !s.closed).length;
  return { client, clock, page, thoughts, statuses, last, openCount };
}

describe('createStreamClient', () => {
  it('opens the stream, reports live, and passes each thought frame on as parsed data', () => {
    const s = setup();
    s.client.start();
    expect(s.last().url).toBe('/api/stream');
    s.last().onopen?.();
    expect(s.statuses.at(-1)).toBe('live');
    s.last().emit('{"thought_id":"a","name":"<img onerror=x>"}');
    s.last().emit('not json');
    expect(s.thoughts).toEqual([{ thought_id: 'a', name: '<img onerror=x>' }]);
  });

  it('reconnects after an error with the backoff, and the backoff resets after a good open', () => {
    const s = setup();
    s.client.start();
    s.last().onerror?.();
    expect(s.last().closed).toBe(true);
    expect(s.clock.pending.map((t) => t.ms)).toEqual([500]);
    expect(s.statuses.at(-1)).toBe('reconnecting');
    s.clock.fire();
    s.last().onerror?.();
    expect(s.clock.pending.map((t) => t.ms)).toEqual([1000]);
    s.clock.fire();
    s.last().onopen?.();
    s.last().onerror?.();
    expect(s.clock.pending.map((t) => t.ms)).toEqual([500]);
  });

  it('ignores events from a source it already closed', () => {
    const s = setup();
    s.client.start();
    const old = s.last();
    old.onerror?.();
    s.clock.fire();
    old.emit('{"thought_id":"stale"}');
    old.onerror?.();
    expect(s.thoughts).toEqual([]);
    expect(s.clock.pending.length).toBe(0);
    expect(s.openCount()).toBe(1);
  });

  it('closes on pagehide: the source and the pending timer go, and nothing reopens', () => {
    const s = setup();
    s.client.start();
    s.last().onerror?.();
    expect(s.clock.pending.length).toBe(1);
    s.page.hide();
    expect(s.clock.pending.length).toBe(0);
    expect(s.openCount()).toBe(0);
    expect(s.page.listeners.size).toBe(0);
    expect(s.statuses.at(-1)).toBe('closed');
    s.client.start();
    expect(FakeSource.made.length).toBe(1);
  });

  it('closes an open stream on pagehide and stops thoughts from arriving after it', () => {
    const s = setup();
    s.client.start();
    const source = s.last();
    s.page.hide();
    expect(source.closed).toBe(true);
    source.emit('{"thought_id":"late"}');
    expect(s.thoughts).toEqual([]);
  });

  it('pause closes the stream and clears the retry timer; resume opens a fresh one', () => {
    const s = setup();
    s.client.start();
    s.last().onerror?.();
    s.client.pause();
    expect(s.clock.pending.length).toBe(0);
    expect(s.statuses.at(-1)).toBe('paused');
    expect(s.openCount()).toBe(0);
    s.client.resume();
    expect(FakeSource.made.length).toBe(2);
    expect(s.openCount()).toBe(1);
    expect(s.statuses.at(-1)).toBe('connecting');
  });

  it('pausing twice, or resuming a stream that is not paused, opens nothing extra', () => {
    const s = setup();
    s.client.start();
    s.client.resume();
    s.client.pause();
    s.client.pause();
    s.client.resume();
    expect(FakeSource.made.length).toBe(2);
    expect(s.openCount()).toBe(1);
  });

  it('close is final and idempotent, and start after close does nothing', () => {
    const s = setup();
    s.client.start();
    s.client.close();
    s.client.close();
    s.client.resume();
    s.client.start();
    expect(FakeSource.made.length).toBe(1);
    expect(s.openCount()).toBe(0);
    expect(s.clock.pending.length).toBe(0);
  });

  it('holds at most one source and one timer over many failures', () => {
    const s = setup();
    s.client.start();
    for (let i = 0; i < 50; i += 1) {
      s.last().onerror?.();
      expect(s.clock.pending.length).toBe(1);
      s.clock.fire();
      expect(s.openCount()).toBe(1);
    }
    expect(FakeSource.made.length).toBe(51);
    s.client.close();
    expect(s.openCount()).toBe(0);
    expect(s.clock.pending.length).toBe(0);
  });
});
