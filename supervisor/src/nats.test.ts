import { CTL_BODY_OPS } from '@geldar/contract';
import { describe, expect, it, vi } from 'vitest';
import { FakeWorld } from './fakes.ts';
import { CTL_IN_FLIGHT_CAP, type CtlMsg, type CtlStats, type CtlWire, serveCtl } from './nats.ts';
import { OPS } from './ports.ts';
import type { Supervisor } from './service.ts';
import { createSupervisor } from './service.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const freshStats = (): CtlStats => ({
  dropped: 0,
  invalid: 0,
  busy: 0,
  handlerFailed: 0,
  replyFailed: 0,
  subscribeFailed: 0,
});
const START_SUBJECT = 'geldar.phase0.ctl.body.start';

/** A fake wire: the given requests in order (on the start subject unless one is given), and every reply it was asked to send. */
function fakeWire(
  msgs: (Omit<CtlMsg, 'subject'> & { subject?: string })[],
  respond?: (inbox: string) => Promise<void>,
) {
  const subjects: string[] = [];
  const replies: { inbox: string; body: string }[] = [];
  const wire: CtlWire = {
    subscribe(subject) {
      subjects.push(subject);
      return (async function* () {
        yield* msgs.map((m) => ({ subject: START_SUBJECT, ...m }));
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

/** A handler that holds every call until the test releases it. */
function gatedSupervisor() {
  const gates: ((reply: unknown) => void)[] = [];
  const handle = vi.fn(
    (_request: unknown) => new Promise<unknown>((resolve) => gates.push(resolve)),
  );
  return { handle, gates, sup: { handle } as unknown as Supervisor };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('supervisor control transport: subject binding, in-flight cap, subscription failure', () => {
  it('refuses a request whose op differs from its subject with invalid, without calling the handler', async () => {
    const f = fakeWire([
      {
        subject: 'geldar.phase0.ctl.body.stop',
        data: enc(JSON.stringify(REQUEST)),
        reply: '_INBOX.6',
      },
    ]);
    const h = fakeSupervisor();
    const stats = freshStats();
    await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    expect(h.handle).not.toHaveBeenCalled();
    expect(f.replies).toEqual([{ inbox: '_INBOX.6', body: '{"ok":false,"code":"invalid"}' }]);
    expect(stats.invalid).toBe(1);
  });

  it('handles a request published to the subject of its own op', async () => {
    const stop = { op: 'stop', ownerId: 'owner-1', playerName: 'Alpha' };
    const f = fakeWire([
      {
        subject: 'geldar.phase0.ctl.body.stop',
        data: enc(JSON.stringify(stop)),
        reply: '_INBOX.7',
      },
    ]);
    const h = fakeSupervisor();
    const stats = freshStats();
    await serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    expect(h.handle).toHaveBeenCalledWith(stop);
    expect(stats.invalid).toBe(0);
  });

  it('handles the last request under the in-flight cap, sixteen at once, with no busy reply', async () => {
    const msgs = Array.from({ length: CTL_IN_FLIGHT_CAP }, (_, i) => ({
      data: enc(JSON.stringify(REQUEST)),
      reply: `_INBOX.${i + 1}`,
    }));
    const f = fakeWire(msgs);
    const h = gatedSupervisor();
    const stats = freshStats();
    const run = serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    await settle();
    expect(h.handle).toHaveBeenCalledTimes(CTL_IN_FLIGHT_CAP);
    expect(stats.busy).toBe(0);
    for (const gate of h.gates) gate({ ok: true, code: 'started' });
    await run;
    expect(f.replies).toHaveLength(CTL_IN_FLIGHT_CAP);
    expect(stats.busy).toBe(0);
  });

  it('answers the first request past the in-flight cap busy, and calls the handler no more', async () => {
    const msgs = Array.from({ length: CTL_IN_FLIGHT_CAP + 1 }, (_, i) => ({
      data: enc(JSON.stringify(REQUEST)),
      reply: `_INBOX.${i + 1}`,
    }));
    const f = fakeWire(msgs);
    const h = gatedSupervisor();
    const stats = freshStats();
    const run = serveCtl({ wire: f.wire, shard: 'phase0', supervisor: h.sup, stats });
    await settle();
    expect(h.handle).toHaveBeenCalledTimes(CTL_IN_FLIGHT_CAP);
    expect(f.replies).toEqual([
      { inbox: `_INBOX.${CTL_IN_FLIGHT_CAP + 1}`, body: '{"ok":false,"code":"busy"}' },
    ]);
    expect(stats.busy).toBe(1);
    for (const gate of h.gates) gate({ ok: true, code: 'started' });
    await run;
    expect(h.handle).toHaveBeenCalledTimes(CTL_IN_FLIGHT_CAP);
    expect(stats.busy).toBe(1);
  });

  it('counts a subscription that throws, and ends serveCtl without rejecting', async () => {
    const wire: CtlWire = {
      subscribe() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error('connection gone');
              },
            };
          },
        };
      },
      async respond() {},
    };
    const h = fakeSupervisor();
    const stats = freshStats();
    await expect(
      serveCtl({ wire, shard: 'phase0', supervisor: h.sup, stats }),
    ).resolves.toBeUndefined();
    expect(stats.subscribeFailed).toBe(1);
    expect(h.handle).not.toHaveBeenCalled();
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
