import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AddressConnections } from './address-count.ts';
import { createMockHttp, type MockHttp } from './server.ts';

describe('AddressConnections', () => {
  it('refuses the open past the cap and admits again after a release', () => {
    const counts = new AddressConnections(2);
    expect(counts.take('a')).toBe(true);
    expect(counts.take('a')).toBe(true);
    expect(counts.take('a')).toBe(false);
    counts.release('a');
    expect(counts.take('a')).toBe(true);
  });

  it('counts each address on its own', () => {
    const counts = new AddressConnections(1);
    expect(counts.take('a')).toBe(true);
    expect(counts.take('b')).toBe(true);
    expect(counts.take('a')).toBe(false);
  });

  it('keeps one live count when the connections close in open order', () => {
    const counts = new AddressConnections(16);
    for (let i = 0; i < 16; i++) expect(counts.take('a')).toBe(true);
    for (let i = 0; i < 16; i++) counts.release('a');
    expect(counts.size).toBe(0);
    for (let i = 0; i < 16; i++) expect(counts.take('a')).toBe(true);
  });

  it('keeps one live count when the connections close in reverse order', () => {
    const counts = new AddressConnections(16);
    for (let i = 0; i < 16; i++) expect(counts.take('a')).toBe(true);
    for (let i = 0; i < 15; i++) counts.release('a');
    // One left open: a 16th open is still refused only at the cap, so 15 more fit.
    for (let i = 0; i < 15; i++) expect(counts.take('a')).toBe(true);
    expect(counts.take('a')).toBe(false);
    for (let i = 0; i < 16; i++) counts.release('a');
    expect(counts.size).toBe(0);
  });

  it('drops the entry at zero so the map holds only addresses with a connection open', () => {
    const counts = new AddressConnections(4);
    counts.take('a');
    counts.take('b');
    expect(counts.size).toBe(2);
    counts.release('a');
    expect(counts.size).toBe(1);
    counts.release('b');
    expect(counts.size).toBe(0);
  });

  it('ignores a release for an address with nothing open', () => {
    const counts = new AddressConnections(1);
    counts.release('ghost');
    expect(counts.size).toBe(0);
    expect(counts.take('ghost')).toBe(true);
  });
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function open(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

describe('per-address connection cap on the mock server', () => {
  let http: MockHttp | undefined;
  let sockets: Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets = [];
    await http?.close();
    http = undefined;
  });

  async function start(): Promise<number> {
    http = createMockHttp({
      tokens: new Map(),
      createSession: () => {
        throw new Error('no session is opened by these tests');
      },
      limits: { maxConnectionsPerAddress: 16 },
    });
    return http.listen(0, '127.0.0.1');
  }

  it('admits 16, refuses the 17th, and admits 16 again after all 16 close', async () => {
    const port = await start();
    for (let i = 0; i < 16; i++) sockets.push(await open(port));
    const extra = await open(port);
    const refused = new Promise<boolean>((resolve) => {
      extra.once('close', () => resolve(true));
    });
    expect(await refused).toBe(true);

    for (const socket of sockets) socket.destroy();
    sockets = [];
    await pause(100);

    for (let i = 0; i < 16; i++) sockets.push(await open(port));
    await pause(100);
    expect(sockets.filter((socket) => socket.destroyed)).toEqual([]);
  });

  it('admits 16 again after the connections close in reverse order', async () => {
    const port = await start();
    for (let i = 0; i < 16; i++) sockets.push(await open(port));
    for (const socket of [...sockets].reverse()) socket.destroy();
    sockets = [];
    await pause(100);

    for (let i = 0; i < 16; i++) sockets.push(await open(port));
    await pause(100);
    expect(sockets.filter((socket) => socket.destroyed)).toEqual([]);
  });
});
