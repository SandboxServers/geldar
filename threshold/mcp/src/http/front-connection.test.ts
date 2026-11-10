import { request } from 'node:http';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, type FrontRig, INIT, startFrontRig, TOKEN_A } from './front.fixture.ts';

let rig: FrontRig;

beforeEach(async () => {
  rig = await startFrontRig();
});

afterEach(async () => {
  await rig.close();
});

describe('connection limits', () => {
  it('cuts a POST whose body stalls past the request timeout', async () => {
    await rig.restart({ limits: { requestTimeoutMs: 300 } });
    const req = request({
      host: '127.0.0.1',
      port: rig.port,
      path: '/p/aa',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_A}`,
        'Content-Type': 'application/json',
        'Content-Length': '100',
      },
    });
    req.on('error', () => undefined);
    req.write('{');
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('still open'), 3000);
      req.on('close', () => {
        clearTimeout(timer);
        resolve('closed');
      });
      req.on('response', (res) => res.resume());
    });
    expect(outcome).toBe('closed');
  });

  it('delivers a response held longer than the request timeout', async () => {
    await rig.restart({ limits: { requestTimeoutMs: 200 } });
    const id = await rig.openSession();
    const reply = await rig.send('/p/aa', {
      body: call('slow', 3),
      headers: { 'mcp-session-id': id },
    });
    expect(reply.status).toBe(200);
    expect(reply.text).toContain('ok');
  });

  it('lets one address hold no more than its default cap of 80 connections', async () => {
    const held = Array.from({ length: 80 }, () => connect({ host: '127.0.0.1', port: rig.port }));
    await Promise.all(held.map((s) => new Promise((resolve) => s.once('connect', resolve))));
    const extra = connect({ host: '127.0.0.1', port: rig.port });
    const closed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      extra.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    for (const s of [...held, extra]) s.destroy();
    expect(closed).toBe(true);
  });

  it('closes the socket after a refused bearer', async () => {
    const reply = await rig.send('/p/aa', {
      body: INIT,
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(reply.status).toBe(401);
    expect(reply.headers.connection).toBe('close');
  });
});

describe('revocation', () => {
  it('ends the open requests with session_revoked within a second', async () => {
    const sid = await rig.openSession();
    const open = rig.send('/p/aa', { body: call('wait', 5), headers: { 'mcp-session-id': sid } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    rig.store.revoke('tok-a');
    const reply = await Promise.race([
      open,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still open')), 1000)),
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
    // The reply may be an open event stream (200) or a plain 401; the body names the reason.
    expect(reply.text).toContain('session_revoked');
  });

  it('refuses the old session after revocation', async () => {
    const sid = await rig.openSession();
    rig.store.revoke('tok-a');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reply = await rig.send('/p/aa', {
      body: call('ping', 4),
      headers: { 'mcp-session-id': sid },
    });
    expect(reply.status).toBe(401);
  });
});
