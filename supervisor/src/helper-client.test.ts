import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHelperRuntime,
  HELPER_REFUSAL_TEXT,
  HELPER_TIMEOUT_MS,
  HelperFailure,
  type HelperRequest,
} from './helper-client.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function fakeHelper(reply: unknown) {
  const calls: { subject: string; body: Record<string, unknown> }[] = [];
  const request: HelperRequest = async (subject, payload) => {
    calls.push({ subject, body: JSON.parse(decoder.decode(payload)) as Record<string, unknown> });
    return encoder.encode(typeof reply === 'string' ? reply : JSON.stringify(reply));
  };
  return { calls, request };
}

async function kindOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return 'ok';
  } catch (error) {
    return error instanceof HelperFailure ? error.kind : 'raw';
  }
}

describe('helper client: the verbs and subjects', () => {
  it('start sends the verb, the name and the owner only, on the start subject of the shard', async () => {
    const helper = fakeHelper({ ok: true, state: 'started' });
    const runtime = createHelperRuntime({ shard: 'main', request: helper.request });
    await runtime.start({ ownerId: 'owner-1', playerName: 'Ranger' });
    expect(helper.calls).toEqual([
      {
        subject: 'geldar.main.helper.body.start',
        body: { verb: 'start', name: 'Ranger', owner: 'owner-1' },
      },
    ]);
  });

  it('stop and status use their own subjects with the owner', async () => {
    const helper = fakeHelper({ ok: true, state: 'stopped', owner: 'owner-1' });
    const runtime = createHelperRuntime({ shard: 'main', request: helper.request });
    await runtime.stop('owner-1', 'Ranger');
    await runtime.inspect('owner-1', 'Ranger');
    expect(helper.calls.map((c) => c.subject)).toEqual([
      'geldar.main.helper.body.stop',
      'geldar.main.helper.body.status',
    ]);
    expect(helper.calls[1]?.body).toEqual({ verb: 'status', name: 'Ranger', owner: 'owner-1' });
  });

  it('status maps absent to null and running or stopped to the record', async () => {
    const absent = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: true, state: 'absent' }).request,
    });
    const running = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: true, state: 'running', owner: 'o' }).request,
    });
    const stopped = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: true, state: 'stopped', owner: 'o' }).request,
    });
    expect(await absent.inspect('o', 'Ranger')).toBeNull();
    expect(await running.inspect('o', 'Ranger')).toEqual({
      ownerId: 'o',
      playerName: 'Ranger',
      running: true,
    });
    expect(await stopped.inspect('o', 'Ranger')).toEqual({
      ownerId: 'o',
      playerName: 'Ranger',
      running: false,
    });
  });
});

describe('helper client: reply codes', () => {
  it.each([
    ['refused', 'refused'],
    ['capacity', 'capacity'],
    ['not_running', 'not_running'],
    ['timeout', 'timeout'],
    ['failed', 'failed'],
    ['something_new', 'failed'],
  ])('reply code %s becomes the kind %s', async (code, kind) => {
    const runtime = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: false, code, error: 'raw helper text' }).request,
    });
    expect(await kindOf(runtime.start({ ownerId: 'o', playerName: 'Ranger' }))).toBe(kind);
  });

  it('an unreadable reply and a reply that is not an object are the failed kind', async () => {
    const garbage = createHelperRuntime({
      shard: 'main',
      request: fakeHelper('not json{').request,
    });
    const bare = createHelperRuntime({ shard: 'main', request: fakeHelper('null').request });
    expect(await kindOf(garbage.start({ ownerId: 'o', playerName: 'Ranger' }))).toBe('failed');
    expect(await kindOf(bare.start({ ownerId: 'o', playerName: 'Ranger' }))).toBe('failed');
  });

  it('stop treats a not_running reply as stopped and passes a refusal on', async () => {
    const gone = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: false, code: 'not_running' }).request,
    });
    const refused = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: false, code: 'refused' }).request,
    });
    await expect(gone.stop('o', 'Ranger')).resolves.toBeUndefined();
    expect(await kindOf(refused.stop('o', 'Ranger'))).toBe('refused');
  });
});

describe('helper client: unreachable, late and abandoned requests', () => {
  it('no responders is the unavailable kind, and the raw error text is dropped', async () => {
    const runtime = createHelperRuntime({
      shard: 'main',
      request: async () => {
        throw Object.assign(new Error('no responders available for request'), { code: '503' });
      },
    });
    const error = await runtime.start({ ownerId: 'o', playerName: 'Ranger' }).catch((e) => e);
    expect(error).toBeInstanceOf(HelperFailure);
    expect(error.kind).toBe('unavailable');
    expect(error.message).toBe('body helper unavailable');
  });

  it('a request that never answers times out after the bound, and is not retried', async () => {
    let sent = 0;
    const runtime = createHelperRuntime({
      shard: 'main',
      timeoutMs: 10,
      request: () => {
        sent++;
        return new Promise<Uint8Array>(() => {});
      },
    });
    expect(await kindOf(runtime.start({ ownerId: 'o', playerName: 'Ranger' }))).toBe('timeout');
    // The last allowed attempt: one request was sent, and the timeout is not retried.
    expect(sent).toBe(1);
  });

  it('a reply that arrives after the bound is dropped: the caller already has the timeout', async () => {
    const runtime = createHelperRuntime({
      shard: 'main',
      timeoutMs: 10,
      request: () =>
        new Promise<Uint8Array>((resolve) =>
          setTimeout(() => resolve(encoder.encode('{"ok":true,"state":"started"}')), 40),
        ),
    });
    expect(await kindOf(runtime.start({ ownerId: 'o', playerName: 'Ranger' }))).toBe('timeout');
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  it('a request that rejects after the bound does not produce a second failure', async () => {
    const runtime = createHelperRuntime({
      shard: 'main',
      timeoutMs: 10,
      request: () =>
        new Promise<Uint8Array>((_, reject) => setTimeout(() => reject(new Error('late')), 40)),
    });
    expect(await kindOf(runtime.start({ ownerId: 'o', playerName: 'Ranger' }))).toBe('timeout');
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});

describe('helper client: the default bound and timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the default bound is 20 s: a request that never answers times out at 20 s, not before', async () => {
    vi.useFakeTimers();
    expect(HELPER_TIMEOUT_MS).toBe(20_000);
    const runtime = createHelperRuntime({
      shard: 'main',
      request: () => new Promise<Uint8Array>(() => {}),
    });
    let kind: string | undefined;
    void kindOf(runtime.start({ ownerId: 'o', playerName: 'Ranger' })).then((k) => {
      kind = k;
    });
    await vi.advanceTimersByTimeAsync(19_900);
    expect(kind).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(kind).toBe('timeout');
  });

  it('a fast reply leaves no timer pending', async () => {
    vi.useFakeTimers();
    const runtime = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: true, state: 'stopped', owner: 'o' }).request,
    });
    await runtime.inspect('o', 'Ranger');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('helper client: the helper refusal strings', () => {
  it('the stable strings are exactly the helper strings', () => {
    expect(HELPER_REFUSAL_TEXT).toEqual({
      alreadyRunning: 'already running',
      otherOwnerBody: "name in use by another owner's body",
      notYourBody: 'not your body',
    });
  });

  it.each([
    ['already running', 'already_running'],
    ["name in use by another owner's body", 'other_owner_body'],
    ['not your body', 'not_your_body'],
    ['not on roster', null],
    ['name taken by a container the helper did not create', null],
  ])('refusal text %s gives reason %s', async (text, reason) => {
    const runtime = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: false, code: 'refused', error: text }).request,
    });
    let failure: HelperFailure | undefined;
    try {
      await runtime.start({ ownerId: 'o', playerName: 'Ranger' });
    } catch (error) {
      if (error instanceof HelperFailure) failure = error;
    }
    expect(failure?.kind).toBe('refused');
    expect(failure?.reason).toBe(reason);
    expect(failure?.message).toBe('body helper refused');
  });

  it('status returns the owner the helper holds, not the caller', async () => {
    const runtime = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: true, state: 'running', owner: 'other' }).request,
    });
    expect(await runtime.inspect('o', 'Ranger')).toEqual({
      ownerId: 'other',
      playerName: 'Ranger',
      running: true,
    });
  });

  it('a status reply with no owner is the failed kind', async () => {
    const runtime = createHelperRuntime({
      shard: 'main',
      request: fakeHelper({ ok: true, state: 'stopped' }).request,
    });
    expect(await kindOf(runtime.inspect('o', 'Ranger'))).toBe('failed');
  });
});
