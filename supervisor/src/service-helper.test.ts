import { describe, expect, it } from 'vitest';
import { FakeWorld } from './fakes.ts';
import { createHelperRuntime, type HelperRequest } from './helper-client.ts';
import { createSupervisor } from './service.ts';

// The service over the real helper client, with the helper answered by a fake NATS request. These tests pin
// the reply mapping (C7-03c3 step 4): each helper reply reaches the register as one fixed code.

type Answer = string | Error | 'never';
interface Sent {
  subject: string;
  body: { verb: string; name: string; owner: string };
}

const ABSENT = '{"ok":true,"state":"absent"}';
const STARTED = '{"ok":true,"state":"started"}';
const STOPPED = '{"ok":true,"state":"stopped"}';
// The helper's status reply carries the label owner it holds for the Body.
const RUNNING_OWNED = '{"ok":true,"state":"running","owner":"owner-a"}';
const runningFor = (owner: string) => JSON.stringify({ ok: true, state: 'running', owner });

function helperWith(answers: { start?: Answer; stop?: Answer; status?: string }) {
  const sent: Sent[] = [];
  const request: HelperRequest = async (subject, payload) => {
    const body = JSON.parse(new TextDecoder().decode(payload)) as Sent['body'];
    sent.push({ subject, body });
    const answer =
      body.verb === 'status'
        ? (answers.status ?? ABSENT)
        : body.verb === 'stop'
          ? (answers.stop ?? STOPPED)
          : (answers.start ?? STARTED);
    if (answer instanceof Error) throw answer;
    if (answer === 'never') return new Promise<Uint8Array>(() => undefined);
    return new TextEncoder().encode(answer);
  };
  return { request, sent };
}

function setup(answers: Parameters<typeof helperWith>[0], clientTimeoutMs?: number) {
  const world = new FakeWorld();
  world.addPlayer('Ranger', 'owner-a');
  const helper = helperWith(answers);
  const runtime = createHelperRuntime({
    shard: 'main',
    request: helper.request,
    ...(clientTimeoutMs === undefined ? {} : { timeoutMs: clientTimeoutMs }),
  });
  const sup = createSupervisor({ ...world.deps(), runtime });
  return { world, helper, sup };
}

const start = { op: 'start', ownerId: 'owner-a', playerName: 'Ranger' };
const stop = { op: 'stop', ownerId: 'owner-a', playerName: 'Ranger' };
const refusedReply = (error: string) =>
  `{"ok":false,"code":"refused","error":${JSON.stringify(error)}}`;

describe('helper replies map to the register codes (the table in the C7-03c3 worknote)', () => {
  it('capacity (the global cap) is error: no row, audited as error, body_unavailable at the register', async () => {
    const { world, sup } = setup({
      start: '{"ok":false,"code":"capacity","error":"global body cap reached"}',
    });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'error' });
    expect(world.startRows).toHaveLength(0);
    expect(world.auditRows.map((row) => row.outcome)).toEqual(['error']);
  });

  it('refused with "already running" is busy, and keeps no row', async () => {
    const { world, sup } = setup({ start: refusedReply('already running') });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'busy' });
    expect(world.startRows).toHaveLength(0);
  });

  it('refused with the name-taken string is unknown', async () => {
    const { world, sup } = setup({
      start: refusedReply('name taken by a container the helper did not create'),
    });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'unknown' });
    expect(world.startRows).toHaveLength(0);
  });

  it('refused by the roster (any other string) is unknown', async () => {
    const { sup } = setup({ start: refusedReply('not on roster') });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'unknown' });
  });

  it('a helper that does not answer in time is error, and the raw timeout is not passed on', async () => {
    const { world, sup } = setup({ start: 'never' }, 5);
    const reply = await sup.handle(start);
    expect(reply).toEqual({ ok: false, code: 'error' });
    expect(world.startRows).toHaveLength(0);
  });

  it('an unreachable helper (no responders) is error, and the raw error text never reaches the reply', async () => {
    const { sup } = setup({ start: new Error('no responders on geldar.main.helper.body.start') });
    const reply = await sup.handle(start);
    expect(reply).toEqual({ ok: false, code: 'error' });
    expect(JSON.stringify(reply)).not.toContain('no responders');
  });

  it('a helper failure is error, with fixed text only', async () => {
    const { sup } = setup({
      start: '{"ok":false,"code":"failed","error":"docker call failed"}',
    });
    const reply = await sup.handle(start);
    expect(reply).toEqual({ ok: false, code: 'error' });
    expect(JSON.stringify(reply)).not.toContain('docker');
  });

  it('a helper reply that is not JSON is error', async () => {
    const { sup } = setup({ start: 'not json' });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'error' });
  });
});

describe('the login name is checked before any helper call', () => {
  it('a display name outside the login shape is login_name, and the helper is never called', async () => {
    const { world, helper, sup } = setup({});
    world.displayNames.set('ranger', 'ab');
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'login_name' });
    expect(helper.sent).toEqual([]);
    expect(world.startRows).toHaveLength(0);
  });

  it('a missing display name is login_name, and the helper is never called', async () => {
    const { world, helper, sup } = setup({});
    world.loginNameBad = true;
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'login_name' });
    expect(helper.sent).toEqual([]);
  });

  it('a refused restart leaves the running body up: the helper gets no stop', async () => {
    const { world, helper, sup } = setup({ status: RUNNING_OWNED });
    world.loginNameBad = true;
    expect(await sup.handle({ ...start, op: 'restart' })).toEqual({
      ok: false,
      code: 'login_name',
    });
    expect(helper.sent).toEqual([]);
  });
});

const stopsSent = (helper: { sent: Sent[] }) => helper.sent.filter((s) => s.body.verb === 'stop');

describe('a start the helper refused is never compensated by a stop (it stopped nothing of this call)', () => {
  it('(a) refused as already running: the helper gets no stop, and the reply is busy', async () => {
    const { world, helper, sup } = setup({ start: refusedReply('already running') });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'busy' });
    expect(stopsSent(helper)).toEqual([]);
    expect(world.startRows).toHaveLength(0);
  });

  it('(b) refused by the roster (unknown): the helper gets no stop', async () => {
    const { helper, sup } = setup({ start: refusedReply('not on roster') });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'unknown' });
    expect(stopsSent(helper)).toEqual([]);
  });

  it('(c) capacity: the helper gets no stop', async () => {
    const { helper, sup } = setup({
      start: '{"ok":false,"code":"capacity","error":"global body cap reached"}',
    });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'error' });
    expect(stopsSent(helper)).toEqual([]);
  });

  it('(d) a timed-out start is compensated: the helper gets the stop (the start may have landed)', async () => {
    const { helper, sup } = setup({ start: 'never' }, 5);
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'error' });
    expect(stopsSent(helper)).toHaveLength(1);
  });

  it('(d) an unreachable helper is compensated too: the helper gets the stop', async () => {
    const { helper, sup } = setup({ start: new Error('no responders') });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'error' });
    expect(stopsSent(helper)).toHaveLength(1);
  });
});

describe('every helper call carries the owner and the roster name', () => {
  it('status on a stop names the owner on both inspect and stop', async () => {
    const { helper, sup } = setup({ status: RUNNING_OWNED });
    expect(await sup.handle(stop)).toEqual({ ok: true, code: 'stopped' });
    expect(helper.sent.map((s) => [s.body.verb, s.body.owner, s.body.name])).toEqual([
      ['status', 'owner-a', 'ranger'],
      ['stop', 'owner-a', 'ranger'],
    ]);
    expect(helper.sent.every((s) => s.subject === `geldar.main.helper.body.${s.body.verb}`)).toBe(
      true,
    );
  });
});

describe('the label owner the helper holds, and its named refusals, at the register', () => {
  const status = { op: 'status', ownerId: 'owner-a', playerName: 'Ranger' };

  it('a Body the helper holds for another owner: stop is unknown and no stop is sent', async () => {
    const { helper, sup } = setup({ status: runningFor('owner-b') });
    expect(await sup.handle(stop)).toEqual({ ok: false, code: 'unknown' });
    expect(stopsSent(helper)).toEqual([]);
  });

  it('a Body the helper holds for another owner: status is unknown', async () => {
    const { sup } = setup({ status: runningFor('owner-b') });
    expect(await sup.handle(status)).toEqual({ ok: false, code: 'unknown' });
  });

  it("a start refused as another owner's body (a roster move) is busy, and gets no stop", async () => {
    const { helper, sup } = setup({
      start: refusedReply("name in use by another owner's body"),
    });
    expect(await sup.handle(start)).toEqual({ ok: false, code: 'busy' });
    expect(stopsSent(helper)).toEqual([]);
  });

  it('a stop refused as not your body is unknown', async () => {
    const { sup } = setup({ status: RUNNING_OWNED, stop: refusedReply('not your body') });
    expect(await sup.handle(stop)).toEqual({ ok: false, code: 'unknown' });
  });

  it('a start of a name the roster gives to another owner is unknown, not login_name, and no helper call is made', async () => {
    const { helper, sup } = setup({});
    expect(await sup.handle({ ...start, ownerId: 'owner-b' })).toEqual({
      ok: false,
      code: 'unknown',
    });
    expect(helper.sent).toEqual([]);
  });
});
