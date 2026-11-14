import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BodyUnavailable,
  bodyUnavailableResponse,
  type CtlConnection,
  MalformedReply,
  requestBodyOp,
} from './nats-ctl.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const BODY = { op: 'start', ownerId: 'owner-1', playerName: 'Alpha' };
const OK = { ok: true, code: 'started' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('register body control request', () => {
  it('sends the body to geldar.<shard>.ctl.body.<op> and returns a reply within the timeout', async () => {
    const request = vi.fn(async (_subject: string, _data: Uint8Array, _opts: unknown) => ({
      data: enc(JSON.stringify(OK)),
    }));
    const conn: CtlConnection = { request };
    await expect(
      requestBodyOp(conn, 'start', 'phase0', BODY, { timeoutMs: 1000 }),
    ).resolves.toEqual(OK);
    expect(request.mock.calls[0]?.[0]).toBe('geldar.phase0.ctl.body.start');
    expect(dec(request.mock.calls[0]?.[1] as Uint8Array)).toBe(JSON.stringify(BODY));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a body whose op names another operation throws before anything is sent', async () => {
    const request = vi.fn(async () => ({ data: enc(JSON.stringify(OK)) }));
    const conn: CtlConnection = { request };
    await expect(requestBodyOp(conn, 'stop', 'phase0', BODY, { timeoutMs: 1000 })).rejects.toThrow(
      /does not match the subject op stop/,
    );
    expect(request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a body with no op is sent with the subject op bound into the payload', async () => {
    const request = vi.fn(async (_subject: string, _data: Uint8Array, _opts: unknown) => ({
      data: enc(JSON.stringify(OK)),
    }));
    const conn: CtlConnection = { request };
    const { op: _ignored, ...withoutOp } = BODY;
    await expect(
      requestBodyOp(conn, 'start', 'phase0', withoutOp, { timeoutMs: 1000 }),
    ).resolves.toEqual(OK);
    expect(request.mock.calls[0]?.[0]).toBe('geldar.phase0.ctl.body.start');
    expect(JSON.parse(dec(request.mock.calls[0]?.[1] as Uint8Array))).toEqual(BODY);
  });

  it('a busy reply comes back as its code, so the caller can map it (not as a success)', async () => {
    const conn: CtlConnection = {
      request: async () => ({ data: enc('{"ok":false,"code":"busy"}') }),
    };
    await expect(
      requestBodyOp(conn, 'start', 'phase0', BODY, { timeoutMs: 1000 }),
    ).resolves.toEqual({ ok: false, code: 'busy' });
  });

  it('a timeout throws BodyUnavailable and clears its timer', async () => {
    const conn: CtlConnection = { request: () => new Promise<never>(() => {}) };
    const pending = requestBodyOp(
      conn,
      'status',
      'phase0',
      { ...BODY, op: 'status' },
      { timeoutMs: 1000 },
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(BodyUnavailable);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a disconnect mid-request rejects with BodyUnavailable, leaves no timer, and a second call after reconnect works', async () => {
    let drop: (e: Error) => void = () => {};
    let calls = 0;
    const conn: CtlConnection = {
      request: () => {
        calls++;
        if (calls === 1) return new Promise<never>((_, reject) => (drop = reject));
        return Promise.resolve({ data: enc(JSON.stringify(OK)) });
      },
    };
    const first = requestBodyOp(conn, 'start', 'phase0', BODY, { timeoutMs: 1000 });
    const assertion = expect(first).rejects.toBeInstanceOf(BodyUnavailable);
    drop(new Error('CONNECTION_CLOSED'));
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    await expect(
      requestBodyOp(conn, 'start', 'phase0', BODY, { timeoutMs: 1000 }),
    ).resolves.toEqual(OK);
  });

  it('a no-responders reply throws BodyUnavailable', async () => {
    const conn: CtlConnection = {
      request: () => Promise.reject(Object.assign(new Error('no responders'), { code: '503' })),
    };
    await expect(
      requestBodyOp(conn, 'start', 'phase0', BODY, { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(BodyUnavailable);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a malformed reply throws MalformedReply, not BodyUnavailable', async () => {
    for (const data of [enc('not json'), enc('{"code":"started"}')]) {
      const conn: CtlConnection = { request: async () => ({ data }) };
      const pending = requestBodyOp(conn, 'start', 'phase0', BODY, { timeoutMs: 1000 });
      await expect(pending).rejects.toBeInstanceOf(MalformedReply);
      await expect(pending).rejects.not.toBeInstanceOf(BodyUnavailable);
    }
  });
});

describe('body_unavailable mapping for the route', () => {
  it('maps BodyUnavailable to 503 with the fixed body', () => {
    expect(bodyUnavailableResponse(new BodyUnavailable())).toEqual({
      status: 503,
      body: { error: 'body_unavailable' },
    });
  });

  it('maps no other error to a 503, so a timeout that reads as a generic error is not hidden', () => {
    expect(bodyUnavailableResponse(new MalformedReply())).toBeNull();
    expect(bodyUnavailableResponse(new Error('timeout'))).toBeNull();
  });
});
