import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { KinoRelay } from '../../src/kino/relay.ts';
import { ANONYMOUS } from '../../src/kino/scope.ts';
import { decodeFrames, handleKinoUpgrade } from '../../src/kino/ws.ts';

function maskedText(text: string): Buffer {
  const body = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const out = Buffer.from(body);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) ^ (mask[i % 4] as number);
  return Buffer.concat([Buffer.from([0x81, 0x80 | body.length]), mask, out]);
}

describe('frames', () => {
  it('decodes a masked text frame and rejects an unmasked one', () => {
    const got: string[] = [];
    const rest = decodeFrames(
      maskedText('hi'),
      (t) => got.push(t),
      () => {},
    );
    expect(got).toEqual(['hi']);
    expect(rest?.length).toBe(0);
    expect(
      decodeFrames(
        Buffer.from([0x81, 2, 104, 105]),
        () => {},
        () => {},
      ),
    ).toBeNull();
  });
});

async function rig() {
  const relay = new KinoRelay({
    store: {
      access: async () => ANONYMOUS,
      agent: async () => ({ owner: null, publicCamera: true }),
    },
    feed: { subscribe: () => () => {} },
    paneCap: 1,
  });
  const server = createServer();
  server.on('upgrade', (req, socket) => {
    handleKinoUpgrade({ relay, sessionKey: undefined, now: () => Date.now() }, req, socket);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const open = (): Promise<{ s: Socket; data: () => string }> =>
    new Promise((res) => {
      const s = connect(port, '127.0.0.1');
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString('latin1');
      });
      s.on('error', () => {});
      s.write(
        'GET /kino/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
      );
      s.once('data', () => res({ s, data: () => buf }));
    });
  return { relay, server, open };
}
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(f()).toBe(true);
};

describe('socket', () => {
  it('upgrades, takes a slot, and frees it when the client aborts', async () => {
    const { relay, server, open } = await rig();
    const a = await open();
    expect(a.data()).toContain('101 Switching Protocols');
    expect(a.data()).toContain('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    expect(relay.openPanes).toBe(1);
    const b = await open();
    expect(b.data()).toContain('pane_cap_reached');
    a.s.destroy();
    await until(() => relay.openPanes === 0);
    b.s.destroy();
    server.close();
  });
  it('a non-subscribe message closes the socket and frees the slot', async () => {
    const { relay, server, open } = await rig();
    const a = await open();
    a.s.write(maskedText('{"type":"chat"}'));
    await until(() => relay.openPanes === 0);
    a.s.destroy();
    server.close();
  });
  it('an oversize or unmasked frame closes the socket', async () => {
    const { relay, server, open } = await rig();
    const a = await open();
    a.s.write(Buffer.from([0x81, 2, 104, 105]));
    await until(() => relay.openPanes === 0);
    a.s.destroy();
    server.close();
  });
});
