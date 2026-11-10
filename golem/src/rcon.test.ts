import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RconClient } from './rcon.ts';

/** Builds one Source RCON frame: size, id, type, body, two NUL bytes. */
function frame(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, 'utf8');
  const out = Buffer.alloc(4 + 10 + payload.length);
  out.writeInt32LE(10 + payload.length, 0);
  out.writeInt32LE(id, 4);
  out.writeInt32LE(type, 8);
  payload.copy(out, 12);
  return out;
}

interface FakeServer {
  port: number;
  /** Command bodies in the order they arrived. */
  received: string[];
  /** `recv <cmd>` when a command arrives and `send <cmd>` when its reply is written. */
  events: string[];
  close(): Promise<void>;
}

/**
 * An in-process RCON server. `reply` gives the body parts for each command, each sent as its own
 * packet with the command's id, as Minecraft does for a long reply. `delayMs` holds each reply
 * back that long, so a test can see whether the client sent the next command too early.
 */
async function startFake(
  password: string,
  reply: (cmd: string) => string[] = (cmd) => [`echo ${cmd}`],
  delayMs = 0,
): Promise<FakeServer> {
  const received: string[] = [];
  const events: string[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readInt32LE(0)) {
        const size = buf.readInt32LE(0);
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.toString('utf8', 12, 4 + size - 2);
        buf = buf.subarray(4 + size);
        if (type === 3) {
          socket.write(frame(body === password ? id : -1, 2, ''));
        } else if (type === 2) {
          received.push(body);
          events.push(`recv ${body}`);
          const send = () => {
            if (socket.destroyed) return;
            events.push(`send ${body}`);
            for (const part of reply(body)) socket.write(frame(id, 0, part));
          };
          if (delayMs === 0) send();
          else setTimeout(send, delayMs);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    port: address.port,
    received,
    events,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

describe('RconClient', () => {
  let fake: FakeServer | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  it('authenticates and round-trips a command', async () => {
    fake = await startFake('pw', () => ['There are 0 of a max of 20 players online']);
    const client = await RconClient.connect({ host: '127.0.0.1', port: fake.port, password: 'pw' });
    expect(await client.command('list')).toBe('There are 0 of a max of 20 players online');
    expect(fake.received).toEqual(['list']);
    await client.close();
  });

  it('rejects a wrong password', async () => {
    fake = await startFake('right');
    await expect(
      RconClient.connect({ host: '127.0.0.1', port: fake.port, password: 'wrong' }),
    ).rejects.toThrow(/authentication failed/);
  });

  it('joins a reply split over two packets into one string', async () => {
    fake = await startFake('pw', () => ['a'.repeat(4096), 'tail']);
    const client = await RconClient.connect({ host: '127.0.0.1', port: fake.port, password: 'pw' });
    expect(await client.command('big')).toBe(`${'a'.repeat(4096)}tail`);
    await client.close();
  });

  it('rejects a command with a line break without writing it', async () => {
    fake = await startFake('pw');
    const client = await RconClient.connect({ host: '127.0.0.1', port: fake.port, password: 'pw' });
    await expect(client.command('list\nstop')).rejects.toThrow(
      'rcon command contains a line break',
    );
    await expect(client.command('list\rstop')).rejects.toThrow(
      'rcon command contains a line break',
    );
    expect(fake.received).toEqual([]);
    await client.close();
  });

  it('runs one command at a time: the second is sent after the first reply', async () => {
    fake = await startFake('pw', undefined, 30);
    const client = await RconClient.connect({ host: '127.0.0.1', port: fake.port, password: 'pw' });
    await Promise.all([client.command('first'), client.command('second')]);
    expect(fake.events).toEqual(['recv first', 'send first', 'recv second', 'send second']);
    await client.close();
  });

  it('fails the client on a command timeout, logs it, and says so on the next command', async () => {
    fake = await startFake('pw', (cmd) => (cmd === 'silent' ? [] : [`echo ${cmd}`]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = await RconClient.connect({
      host: '127.0.0.1',
      port: fake.port,
      password: 'pw',
      timeoutMs: 50,
    });
    await expect(client.command('silent')).rejects.toThrow('RCON command timed out: silent');
    await expect(client.command('list')).rejects.toThrow(
      'RCON client failed earlier: RCON command timed out: silent',
    );
    expect(warn).toHaveBeenCalledWith('RCON command timed out, client failed: silent');
    warn.mockRestore();
    await client.close();
  });

  it('treats a packet size over the bound as a protocol error, not a wait', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => {
      sockets.push(socket);
      socket.once('data', () => {
        const header = Buffer.alloc(4);
        header.writeInt32LE(1 << 30, 0);
        socket.write(header);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      await expect(
        RconClient.connect({
          host: '127.0.0.1',
          port: address.port,
          password: 'pw',
          timeoutMs: 2000,
        }),
      ).rejects.toThrow(`RCON protocol error: packet size ${1 << 30}`);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  it('names the override file when nothing listens, so a host tool does not fail with a bare refusal', async () => {
    fake = await startFake('pw');
    const port = fake.port;
    await fake.close();
    fake = undefined;
    await expect(
      RconClient.connect({ host: '127.0.0.1', port, password: 'pw', timeoutMs: 2000 }),
    ).rejects.toThrow(
      'shard not up, or RCON is not published to the host (compose/rcon-host.yml): run ./geldar.ps1 shard up phase0 --rcon-host',
    );
  });
});
