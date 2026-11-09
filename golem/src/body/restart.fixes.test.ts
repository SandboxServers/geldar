import { describe, expect, it } from 'vitest';
import { parseEntry } from './checkpoint.ts';
import { fakeId, LIFE } from './executor.fakes.ts';
import { boot, buckets, entry, startIntent } from './restart.fakes.ts';
import { assertLoopbackNatsUrl } from './restart.ts';

describe('a checkpoint that cannot be read', () => {
  it('says checkpoint_unreadable, not no_checkpoint, and leaves the entry', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry());
    kv.checkpoints.failGets(100);
    const b = await boot(kv);
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'checkpoint_unreadable' });
    expect(kv.checkpoints.gets).toBe(4);
    expect(kv.checkpoints.peek(LIFE)).toBeDefined();
    await b.stop();
  });

  it('resumes when the bucket recovers within the retries', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry());
    kv.checkpoints.failGets(2);
    const b = await boot(kv);
    expect(b.outcome).toEqual({ kind: 'resumed', intentId: fakeId('in', 1) });
    await b.stop();
  });
});

describe('the world tick on restart', () => {
  it('waits for a tick, then judges expiry and resumes', async () => {
    const kv = buckets();
    kv.checkpoints.seed(LIFE, entry());
    const b = await boot(kv, {
      tick: null,
      laterTick: { afterMs: 150, tick: 10 },
      restart: { tickWaitMs: 3000 },
    });
    expect(b.outcome).toEqual({ kind: 'resumed', intentId: fakeId('in', 1) });
    await b.stop();
  });

  it('with no tick expires nothing: it leaves the checkpoint and idles as tick_unknown', async () => {
    const kv = buckets();
    // Expired on any real tick; an unknown tick must not read as tick 0 and resume it.
    kv.checkpoints.seed(LIFE, entry({ expires_tick: 5 }));
    const b = await boot(kv, { tick: null, restart: { tickWaitMs: 150 } });
    expect(b.outcome).toEqual({ kind: 'idle', reason: 'tick_unknown' });
    expect(b.made).toHaveLength(0);
    expect(kv.checkpoints.peek(LIFE)).toBeDefined();
    await b.stop();
  });

  it('caps the ticks left by the intent limit when the world clock went backwards', async () => {
    const kv = buckets();
    // Saved at a clock far ahead of this one: 100000 - 0 would exceed the intent's own 1000.
    kv.checkpoints.seed(LIFE, entry({ expires_tick: 100_000 }));
    const b = await boot(kv, { tick: 0 });
    expect(b.outcome.kind).toBe('resumed');
    await b.body.executor.onTick(1);
    await b.body.checkpoints?.flush();
    expect(parseEntry(kv.checkpoints.peek(LIFE) ?? '')?.expires_tick).toBe(1000);
    await b.stop();
  });
});

describe('stopping a restarted Body', () => {
  it('waits for the record sink to flush before it returns', async () => {
    const kv = buckets();
    let flushed = false;
    const b = await boot(kv);
    const sink = b.body.records as unknown as { flush?: () => Promise<void> };
    sink.flush = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      flushed = true;
    };
    await startIntent(b);
    await b.stop();
    expect(flushed).toBe(true);
  });

  it('does not wait forever for a sink that cannot send', async () => {
    const b = await boot(buckets(), { restart: { flushTimeoutMs: 30 } });
    const sink = b.body.records as unknown as { flush?: () => Promise<void> };
    sink.flush = () => new Promise<void>(() => undefined);
    const started = Date.now();
    await b.stop();
    expect(Date.now() - started).toBeLessThan(2000);
    // The lost flush is logged, not silent.
    expect(b.lines.filter((line) => line.includes('did not flush within 30 ms'))).toHaveLength(1);
  });

  it('logs nothing about the flush when the sink sends in time', async () => {
    const b = await boot(buckets(), { restart: { flushTimeoutMs: 500 } });
    const sink = b.body.records as unknown as { flush?: () => Promise<void> };
    sink.flush = async () => undefined;
    await b.stop();
    expect(b.lines.filter((line) => line.includes('did not flush'))).toEqual([]);
  });

  it('is fine with a sink that has no flush', async () => {
    const b = await boot(buckets());
    await expect(b.stop()).resolves.toBeUndefined();
  });
});

describe('assertLoopbackNatsUrl', () => {
  it('accepts loopback nats URLs and refuses the rest', () => {
    expect(() => assertLoopbackNatsUrl('nats://127.0.0.1:4222')).not.toThrow();
    expect(() => assertLoopbackNatsUrl('nats://localhost:4222')).not.toThrow();
    expect(() => assertLoopbackNatsUrl('nats://10.0.0.5:4222')).toThrow(/127\.0\.0\.1/);
    expect(() => assertLoopbackNatsUrl('http://127.0.0.1:4222')).toThrow(/nats/);
    expect(() => assertLoopbackNatsUrl('not a url')).toThrow(/nats/);
  });
});
