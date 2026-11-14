import { describe, expect, it } from 'vitest';
import { createFakeEngine } from './fake-engine.ts';
import {
  HELPER_IN_FLIGHT_CAP,
  HELPER_REQUEST_MAX_BYTES,
  type HelperMsg,
  type HelperWire,
  helperSubjects,
  newHelperStats,
  REASON_BUSY,
  REASON_MALFORMED,
  REASON_SUBJECT,
  REASON_TOO_LARGE,
  serveHelper,
} from './listener.ts';
import { createBodyHelper, type Reply } from './service.ts';

const SHARD = 'colo';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A wire that delivers the given messages on their subjects, then ends each subscription. Replies are recorded. */
function wireWith(messages: HelperMsg[]) {
  const replies: { inbox: string; body: unknown }[] = [];
  const wire: HelperWire = {
    subscribe(subject) {
      const mine = messages.filter((m) => m.subject === subject);
      return (async function* () {
        for (const m of mine) yield m;
      })();
    },
    async respond(inbox, data) {
      replies.push({ inbox, body: JSON.parse(decoder.decode(data)) as unknown });
    },
  };
  return { wire, replies };
}

const msg = (subject: string, text: string, reply = 'inbox.1'): HelperMsg => ({
  subject,
  data: encoder.encode(text),
  reply,
});

function helper() {
  const engine = createFakeEngine();
  const audit: string[] = [];
  const handle = createBodyHelper({
    roster: { displayName: async (_o, name) => name },
    engine,
    cap: { ok: true, cap: 40 },
    template: {
      image: 'geldar/body:test',
      wiring: {
        shard: SHARD,
        uid: '1000',
        mcHost: 'velocity',
        mcPort: '25565',
        natsUrl: 'nats://nats:4222',
        natsUser: 'body',
        natsSecretHostPath: '/h/n.txt',
        shardHostPath: '/h/c.yaml',
      },
      limits: { nanoCpus: 1, memory: 1, pidsLimit: 1 },
    },
    audit: (line) => audit.push(line),
  });
  return { engine, audit, handle };
}

const START = `geldar.${SHARD}.helper.body.start`;

describe('helper listener', () => {
  it('subscribes to the four exact subjects and no wildcard', () => {
    expect(helperSubjects(SHARD)).toEqual([
      `geldar.${SHARD}.helper.body.start`,
      `geldar.${SHARD}.helper.body.stop`,
      `geldar.${SHARD}.helper.body.status`,
      `geldar.${SHARD}.helper.body.logtail`,
    ]);
  });

  it('refuses malformed JSON with a stable reason and does not call the handler', async () => {
    const { wire, replies } = wireWith([msg(START, '{not json')]);
    const { engine, handle } = helper();
    await serveHelper({ wire, shard: SHARD, handle, stats: newHelperStats() });
    expect(replies).toEqual([
      { inbox: 'inbox.1', body: { ok: false, code: 'refused', error: REASON_MALFORMED } },
    ]);
    expect(engine.created).toEqual([]);
  });

  it('refuses an extra field, and the container is not created', async () => {
    const { wire, replies } = wireWith([
      msg(START, JSON.stringify({ verb: 'start', name: 'Newcomer1', owner: 'o', image: 'evil' })),
    ]);
    const { engine, handle } = helper();
    await serveHelper({ wire, shard: SHARD, handle, stats: newHelperStats() });
    expect(replies[0]?.body).toEqual({ ok: false, code: 'refused', error: 'unexpected field' });
    expect(engine.created).toEqual([]);
  });

  it('refuses a verb that does not match the subject, so start cannot carry a stop', async () => {
    const { wire, replies } = wireWith([
      msg(START, JSON.stringify({ verb: 'stop', name: 'Newcomer1', owner: 'o' })),
    ]);
    const { handle } = helper();
    await serveHelper({ wire, shard: SHARD, handle, stats: newHelperStats() });
    expect(replies[0]?.body).toEqual({ ok: false, code: 'refused', error: REASON_SUBJECT });
  });

  it('refuses an unknown verb in the body with the handler reason, not a crash', async () => {
    const unknown = `geldar.${SHARD}.helper.body.status`;
    const { wire, replies } = wireWith([
      msg(unknown, JSON.stringify({ verb: 'exec', name: 'Newcomer1', owner: 'o' })),
    ]);
    const { handle } = helper();
    await serveHelper({ wire, shard: SHARD, handle, stats: newHelperStats() });
    expect(replies[0]?.body).toEqual({ ok: false, code: 'refused', error: REASON_SUBJECT });
  });

  it('refuses a request over the size cap before parsing it', async () => {
    const big = JSON.stringify({ verb: 'start', name: 'x'.repeat(HELPER_REQUEST_MAX_BYTES) });
    const { wire, replies } = wireWith([msg(START, big)]);
    const { handle } = helper();
    const stats = newHelperStats();
    await serveHelper({ wire, shard: SHARD, handle, stats });
    expect(replies[0]?.body).toEqual({ ok: false, code: 'refused', error: REASON_TOO_LARGE });
    expect(stats.tooLarge).toBe(1);
  });

  it('drops a request with no reply inbox and answers nothing', async () => {
    const { wire, replies } = wireWith([{ subject: START, data: encoder.encode('{}') }]);
    const { handle } = helper();
    const stats = newHelperStats();
    await serveHelper({ wire, shard: SHARD, handle, stats });
    expect(replies).toEqual([]);
    expect(stats.dropped).toBe(1);
  });

  it('answers busy past the in-flight cap and does not call the handler for the extra request', async () => {
    const calls: unknown[] = [];
    const releases: (() => void)[] = [];
    const slow = (raw: unknown) =>
      new Promise<Reply>((resolve) => {
        calls.push(raw);
        releases.push(() => resolve({ ok: true, state: 'absent' }));
      });
    const many = Array.from({ length: HELPER_IN_FLIGHT_CAP + 1 }, (_, i) =>
      msg(START, JSON.stringify({ verb: 'start', name: `Name${i}`, owner: 'o' }), `inbox.${i}`),
    );
    const { wire, replies } = wireWith(many);
    const stats = newHelperStats();
    const run = serveHelper({ wire, shard: SHARD, handle: slow, stats });
    await new Promise((r) => setTimeout(r, 0));
    expect(stats.busy).toBe(1);
    expect(replies).toEqual([
      {
        inbox: `inbox.${HELPER_IN_FLIGHT_CAP}`,
        body: { ok: false, code: 'refused', error: REASON_BUSY },
      },
    ]);
    expect(calls).toHaveLength(HELPER_IN_FLIGHT_CAP);
    for (const release of releases) release();
    await run;
  });

  it('answers a handler failure with a fixed reply and keeps serving', async () => {
    const { wire, replies } = wireWith([
      msg(START, JSON.stringify({ verb: 'start', name: 'Newcomer1', owner: 'o' })),
    ]);
    const stats = newHelperStats();
    await serveHelper({
      wire,
      shard: SHARD,
      handle: async () => {
        throw new Error('boom');
      },
      stats,
    });
    expect(replies[0]?.body).toEqual({ ok: false, code: 'failed', error: 'helper error' });
    expect(stats.handlerFailed).toBe(1);
  });
});
