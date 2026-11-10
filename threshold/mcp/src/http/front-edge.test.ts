import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { openStream, postInit, sleep, startDoor, TOKEN_A } from '../fakes/front-door.fakes.ts';
import type { FrontDoor } from './front.ts';

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

/** A raw TCP client; `closed` turns true when the server drops the socket. */
function openSocket(port: number): Promise<{ socket: Socket; closed: () => boolean }> {
  return new Promise((resolve, reject) => {
    let closed = false;
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      closed = true;
    });
    socket.once('connect', () => resolve({ socket, closed: () => closed }));
    socket.once('error', reject);
  });
}

describe('connections from a trusted proxy', () => {
  it('counts a trusted peer only against the total connection cap', async () => {
    const started = await startDoor({
      http: { trustedProxies: ['127.0.0.1'], maxConnections: 4 },
      limits: { maxConnectionsPerAddress: 2 },
    });
    door = started.door;
    const sockets = [];
    for (let i = 0; i < 4; i++) sockets.push(await openSocket(started.port));
    await sleep(50);
    // Four sockets from one proxy are over the per-peer cap of 2 and all stay open.
    expect(sockets.map((s) => s.closed())).toEqual([false, false, false, false]);
    // The fifth is refused by the total cap of 4.
    const fifth = await openSocket(started.port);
    await sleep(50);
    expect(fifth.closed()).toBe(true);
    for (const s of sockets) s.socket.destroy();
  });

  it('caps the connections of a peer that is not trusted', async () => {
    const started = await startDoor({ limits: { maxConnectionsPerAddress: 2 } });
    door = started.door;
    const sockets = [];
    for (let i = 0; i < 3; i++) sockets.push(await openSocket(started.port));
    await sleep(50);
    expect(sockets.map((s) => s.closed())).toEqual([false, false, true]);
    for (const s of sockets) s.socket.destroy();
  });
});

describe('open GET streams per effective address', () => {
  it('refuses a second stream for the same client address while the first is open', async () => {
    const started = await startDoor({
      http: { trustedProxies: ['127.0.0.1'] },
      limits: { maxConnectionsPerAddress: 1 },
    });
    door = started.door;
    const init = await postInit(started.port, TOKEN_A, { cf: '127.0.0.2' });
    expect(init.status).toBe(200);
    expect(init.sessionId).toBeDefined();
    await sleep(20);
    const sessionId = init.sessionId ?? '';

    const first = await openStream(started.port, TOKEN_A, sessionId, '127.0.0.2');
    expect(first.status).toBe(200);
    const second = await openStream(started.port, TOKEN_A, sessionId, '127.0.0.2');
    expect(second.status).toBe(429);

    // Once the first stream closes, its slot is released and another stream from the address opens.
    first.close();
    await sleep(100);
    const third = await openStream(started.port, TOKEN_A, sessionId, '127.0.0.2');
    expect(third.status).toBe(200);
    third.close();
  });
});
