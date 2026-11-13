import { CTL_BODY_OPS } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { FakeWorld } from './fakes.ts';
import { type CtlMsg, type CtlStats, type CtlWire, serveCtl } from './nats.ts';
import { OPS } from './ports.ts';
import type { Supervisor } from './service.ts';
import { createSupervisor } from './service.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const freshStats = (): CtlStats => ({ dropped: 0, invalid: 0, handlerFailed: 0, replyFailed: 0 });

/** A fake wire: the given requests in order, and every reply it was asked to send. */
function fakeWire(msgs: CtlMsg[], respond?: (inbox: string) => Promise<void>) {
  const subjects: string[] = [];
  const replies: { inbox: string; body: string }[] = [];
  const wire: CtlWire = {
    subscribe(subject) {
      subjects.push(subject);
      return (async function* () {
        yield* msgs;
      })();
    },
    async respond(inbox, data) {
      if (respond) await respond(inbox);
      replies.push({ inbox, body: dec(data) });
    },
  };
  return { wire, subjects, replies };
}

function fakeSupervisor(reply: unknown = { ok: true, code: 'started' }) {
  const handle = vi.fn(async (_request: unknown) => reply);
  return { handle, sup: { handle } as unknown as Supervisor };
}

const REQUEST = { op: 'start', ownerId: 'owner-1', playerName: 'Alpha' };

describe('supervisor control transport', () => {
  it('subscribes to the shard wildcard, decodes the request, calls the handler once and replies to the inbox', async () => {
    const f = fakeWire([{ data: enc(JSON.stringify(REQUEST)), reply: '_INBOX.1' }]);
    const h = fakeSupervisor();
    const stats = freshStats();
    await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    expect(f.subjects).toEqual(['geldar.phase0.ctl.body.>']);
    expect(h.handle).toHaveBeenCalledTimes(1);
    expect(h.handle).toHaveBeenCalledWith(REQUEST);
    expect(f.replies).toEqual([{ inbox: '_INBOX.1', body: '{"ok":true,"code":"started"}' }]);
    expect(stats).toEqual(freshStats());
  });

  it('drops a request with no reply inbox without calling the handler', async () => {
    const f = fakeWire([{ data: enc(JSON.stringify(REQUEST)) }]);
    const h = fakeSupervisor();
    const stats = freshStats();
    await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    expect(h.handle).not.toHaveBeenCalled();
    expect(f.replies).toEqual([]);
    expect(stats.dropped).toBe(1);
  });

  it('counts a reply that throws (connection closed) and keeps serving the next request', async () => {
    let first = true;
    const f = fakeWire(
      [
        { data: enc(JSON.stringify(REQUEST)), reply: '_INBOX.1' },
        { data: enc(JSON.stringify(REQUEST)), reply: '_INBOX.2' },
      ],
      async () => {
        if (first) {
          first = false;
          throw new Error('CONNECTION_CLOSED');
        }
      },
    );
    const h = fakeSupervisor();
    const stats = freshStats();
    await expect(
      serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats }),
    ).resolves.toBeUndefined();
    expect(h.handle).toHaveBeenCalledTimes(2);
    expect(stats.replyFailed).toBe(1);
    expect(f.replies).toEqual([{ inbox: '_INBOX.2', body: '{"ok":true,"code":"started"}' }]);
  });

  it('answers a body that is not JSON with invalid, without calling the handler', async () => {
    const f = fakeWire([{ data: enc('{not json'), reply: '_INBOX.3' }]);
    const h = fakeSupervisor();
    const stats = freshStats();
    await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    expect(h.handle).not.toHaveBeenCalled();
    expect(f.replies).toEqual([{ inbox: '_INBOX.3', body: '{"ok":false,"code":"invalid"}' }]);
    expect(stats.invalid).toBe(1);
  });

  it('answers with error and counts it when the handler throws', async () => {
    const f = fakeWire([{ data: enc(JSON.stringify(REQUEST)), reply: '_INBOX.4' }]);
    const h = fakeSupervisor();
    h.handle.mockRejectedValueOnce(new Error('docker down'));
    const stats = freshStats();
    await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    expect(f.replies).toEqual([{ inbox: '_INBOX.4', body: '{"ok":false,"code":"error"}' }]);
    expect(stats.handlerFailed).toBe(1);
  });

  it('keeps the contract op list equal to the supervisor op list', () => {
    expect([...OPS]).toEqual([...CTL_BODY_OPS]);
  });
});

describe('disconnect mid-request, with the real handler', () => {
  it('leaves no pending timer, and a retried start gets started without a second launch', async () => {
    vi.useFakeTimers();
    try {
      const world = new FakeWorld();
      world.addPlayer('Ranger', 'owner-a');
      const sup = createSupervisor(world.deps());
      const line = (inbox: string) => ({
        data: enc(JSON.stringify({ op: 'start', ownerId: 'owner-a', playerName: 'Ranger' })),
        reply: inbox,
      });
      let cut = true;
      const f = fakeWire([line('_INBOX.5'), line('_INBOX.6')], async () => {
        if (cut) {
          cut = false;
          throw new Error('CONNECTION_CLOSED');
        }
      });
      const stats = freshStats();
      await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: sup, stats });
      expect(vi.getTimerCount()).toBe(0);
      expect(stats.replyFailed).toBe(1);
      expect(world.startRows).toHaveLength(1);
      expect(f.replies).toEqual([{ inbox: '_INBOX.6', body: '{"ok":true,"code":"started"}' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
