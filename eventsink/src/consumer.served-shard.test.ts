import { describe, expect, it, type Mock, vi } from 'vitest';
import { type BatchDeps, handleBatch, type SinkMessage } from './consumer.ts';
import { eventOf } from './projection.fakes.ts';
import { validateMessage } from './validate.ts';
import type { EventWriter } from './writer.ts';

/** A message whose body is `event` as JSON, on `subject`; ack and nak are spies. */
function messageOf(
  subject: string,
  event: object,
): SinkMessage & { ack: Mock<() => void>; nak: Mock<(delayMs: number) => void> } {
  return {
    subject,
    data: new TextEncoder().encode(JSON.stringify(event)),
    deliveryCount: 1,
    ack: vi.fn((): void => undefined),
    nak: vi.fn((_delayMs: number): void => undefined),
  };
}

/** An event with the shard field set to `shard`. */
function eventFor(shard: string, n = 1): Record<string, unknown> {
  return { ...eventOf('roll', {}, n), shard };
}

/** Deps with a writer spy and a DLQ spy; `failDlq` makes the DLQ publish throw. */
function depsFor(servedShard: string | undefined, failDlq = false) {
  const insertBatch = vi.fn(
    async (_events: unknown[], _traceIds: unknown[]): Promise<void> => undefined,
  );
  const publish = vi.fn(async (_subject: string, _body: string): Promise<void> => {
    if (failDlq) throw new Error('stream unavailable');
  });
  const deps: BatchDeps = {
    writer: { insertBatch } as unknown as EventWriter,
    publishDlq: publish,
    log: () => undefined,
    servedShard,
  };
  return { deps, insertBatch, publish };
}

describe('validateMessage with a served shard (decision 0382)', () => {
  const body = (shard: string) => new TextEncoder().encode(JSON.stringify(eventFor(shard)));

  it('accepts an event of the served shard', () => {
    expect(validateMessage('geldar.nf.roll', body('nf'), 'nf').ok).toBe(true);
  });

  it('refuses an event of another shard with reason shard_mismatch', () => {
    const verdict = validateMessage('geldar.colo.roll', body('colo'), 'nf');
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/^shard_mismatch: event shard colo is not served by this sink/);
  });

  it('accepts any shard when no shard is served (the colo behaviour)', () => {
    expect(validateMessage('geldar.colo.roll', body('colo')).ok).toBe(true);
    expect(validateMessage('geldar.nf.roll', body('nf'), undefined).ok).toBe(true);
  });
});

describe('handleBatch with a served shard', () => {
  it('stores a matching event and dead-letters a mismatching one, never storing it', async () => {
    const { deps, insertBatch, publish } = depsFor('nf');
    const good = messageOf('geldar.nf.roll', eventFor('nf', 1));
    const bad = messageOf('geldar.colo.roll', eventFor('colo', 2));
    await handleBatch([good, bad], deps);

    // The matching event is written once and acked after the write.
    expect(insertBatch).toHaveBeenCalledTimes(1);
    const written = insertBatch.mock.calls[0]?.[0] as unknown as { shard: string }[];
    expect(written.map((e) => e.shard)).toEqual(['nf']);
    expect(good.ack).toHaveBeenCalledTimes(1);

    // The mismatching event goes to the served shard's DLQ with the reason, then is acked.
    expect(publish).toHaveBeenCalledTimes(1);
    const call = publish.mock.calls[0];
    expect(call?.[0]).toBe('geldar.nf.dlq');
    const parsed = JSON.parse(String(call?.[1])) as { reason: string; subject: string };
    expect(parsed.reason).toMatch(/^shard_mismatch/);
    expect(parsed.subject).toBe('geldar.colo.roll');
    expect(bad.ack).toHaveBeenCalledTimes(1);
    expect(bad.nak).not.toHaveBeenCalled();
  });

  it('does not write a mismatching event even when it is the only one in the batch', async () => {
    const { deps, insertBatch, publish } = depsFor('nf');
    const bad = messageOf('geldar.colo.roll', eventFor('colo', 3));
    await handleBatch([bad], deps);
    expect(insertBatch).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(bad.ack).toHaveBeenCalledTimes(1);
  });

  it('naks a mismatching event when its dead letter cannot be published, and never acks it', async () => {
    const { deps, insertBatch } = depsFor('nf', true);
    const bad = messageOf('geldar.colo.roll', eventFor('colo', 4));
    await handleBatch([bad], deps);
    expect(insertBatch).not.toHaveBeenCalled();
    expect(bad.ack).not.toHaveBeenCalled();
    expect(bad.nak).toHaveBeenCalledTimes(1);
  });

  it('accepts a mismatching shard as before when no shard is served', async () => {
    const { deps, insertBatch, publish } = depsFor(undefined);
    const colo = messageOf('geldar.colo.roll', eventFor('colo', 5));
    await handleBatch([colo], deps);
    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(colo.ack).toHaveBeenCalledTimes(1);
  });
});
