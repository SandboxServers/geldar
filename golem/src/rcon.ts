import net from 'node:net';

// Source RCON packet types (Valve protocol, used by Minecraft).
const TYPE_EXEC = 2;
const TYPE_AUTH = 3;
const TYPE_AUTH_RESPONSE = 2;
/** The id a server answers with when authentication fails. */
const AUTH_FAILED_ID = -1;
/** Smallest legal packet: id, type and the two trailing NUL bytes. */
const MIN_PACKET_SIZE = 10;
const MAX_ID = 0x7fffffff;
/** How long the stream must stay quiet after a reply before the reply is complete. */
const QUIET_MS = 100;

interface Packet {
  id: number;
  type: number;
  body: string;
}

interface Waiter {
  resolve: (packet: Packet) => void;
  reject: (error: Error) => void;
}

/**
 * A Source RCON client over node:net, for test and ops control only. Commands run one at a
 * time. Minecraft has no terminator: it closes the connection on an empty type-0 request. A
 * reply longer than one packet arrives as a burst of packets with the command's id, so the
 * client reads on until the stream has been quiet for a short window.
 */
export class RconClient {
  private readonly socket: net.Socket;
  private readonly timeoutMs: number;
  private buffer: Buffer = Buffer.alloc(0);
  private inbox: Packet[] = [];
  private waiters: Waiter[] = [];
  private failure: Error | undefined;
  private lastId = 0;
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(socket: net.Socket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (error: Error) => this.abort(error));
    socket.on('close', () => this.abort(new Error('RCON connection closed')));
  }

  /** Connects and authenticates. Rejects on refusal, timeout or a wrong password. */
  static async connect(opts: {
    host: string;
    port: number;
    password: string;
    timeoutMs?: number;
  }): Promise<RconClient> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const socket = new net.Socket();
    const client = new RconClient(socket, timeoutMs);
    try {
      await within(
        new Promise<void>((resolve, reject) => {
          socket.once('connect', () => resolve());
          socket.once('error', reject);
          socket.connect(opts.port, opts.host);
        }),
        timeoutMs,
        'RCON connect timed out',
        (error) => client.abort(error),
      );
    } catch (error) {
      client.abort(error as Error);
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        throw new Error('shard not up: run ./geldar.ps1 shard up phase0', { cause: error });
      }
      throw error;
    }
    try {
      const id = client.allocId();
      client.write(id, TYPE_AUTH, opts.password);
      // Some servers send an empty response packet first; wait for the auth response itself.
      for (;;) {
        const packet = await within(
          client.next(),
          timeoutMs,
          'RCON authentication timed out',
          (error) => client.abort(error),
        );
        if (packet.id === AUTH_FAILED_ID) {
          throw new Error('RCON authentication failed: the password does not match the shard');
        }
        if (packet.type === TYPE_AUTH_RESPONSE && packet.id === id) break;
      }
    } catch (error) {
      await client.close();
      throw error;
    }
    return client;
  }

  /** Runs one command and resolves with its full reply text. */
  command(cmd: string): Promise<string> {
    if (/[\r\n]/.test(cmd)) {
      return Promise.reject(new Error('rcon command contains a line break'));
    }
    const run = this.chain.then(() => this.exchange(cmd));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Closes the socket. Safe to call twice. */
  async close(): Promise<void> {
    if (this.socket.destroyed) return;
    await new Promise<void>((resolve) => {
      this.socket.once('close', () => resolve());
      this.abort(new Error('RCON client closed'));
    });
  }

  private async exchange(cmd: string): Promise<string> {
    const id = this.allocId();
    this.write(id, TYPE_EXEC, cmd);
    let body = '';
    for (;;) {
      const packet = await within(
        this.next(),
        this.timeoutMs,
        `RCON command timed out: ${cmd}`,
        (error) => this.abort(error),
      );
      if (packet.id === id) {
        body += packet.body;
        break;
      }
    }
    let packet = await this.quietNext(QUIET_MS);
    while (packet !== undefined) {
      if (packet.id === id) body += packet.body;
      packet = await this.quietNext(QUIET_MS);
    }
    return body;
  }

  /** The next packet, or undefined when none arrives within `ms`. Does not fail the client. */
  private quietNext(ms: number): Promise<Packet | undefined> {
    const ready = this.inbox.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise<Packet | undefined>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const waiter: Waiter = {
        resolve: (packet) => {
          clearTimeout(timer);
          resolve(packet);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(undefined);
      }, ms);
      this.waiters.push(waiter);
    });
  }

  private allocId(): number {
    this.lastId = this.lastId >= MAX_ID ? 1 : this.lastId + 1;
    return this.lastId;
  }

  private write(id: number, type: number, body: string): void {
    const payload = Buffer.from(body, 'utf8');
    // size counts id, type, body and the two trailing NUL bytes (the buffer is zeroed).
    const size = MIN_PACKET_SIZE + payload.length;
    const frame = Buffer.alloc(4 + size);
    frame.writeInt32LE(size, 0);
    frame.writeInt32LE(id, 4);
    frame.writeInt32LE(type, 8);
    payload.copy(frame, 12);
    this.socket.write(frame);
  }

  private next(): Promise<Packet> {
    const ready = this.inbox.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise<Packet>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (size < MIN_PACKET_SIZE) {
        this.abort(new Error(`RCON protocol error: packet size ${size}`));
        return;
      }
      if (this.buffer.length < 4 + size) return;
      const packet: Packet = {
        id: this.buffer.readInt32LE(4),
        type: this.buffer.readInt32LE(8),
        body: this.buffer.toString('utf8', 12, 4 + size - 2),
      };
      this.buffer = this.buffer.subarray(4 + size);
      const waiter = this.waiters.shift();
      if (waiter !== undefined) waiter.resolve(packet);
      else this.inbox.push(packet);
    }
  }

  /** Fails the client: pending and future reads reject, and the socket is destroyed. */
  private abort(error: Error): void {
    this.failure ??= error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
    if (!this.socket.destroyed) this.socket.destroy();
  }
}

/**
 * Races work against a timer. On timeout the error goes to `fail` (which fails the client) and
 * the promise rejects with that same error.
 */
async function within<T>(
  work: Promise<T>,
  ms: number,
  message: string,
  fail: (error: Error) => void,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      fail(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
