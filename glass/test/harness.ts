/**
 * Shared harness for the Glass security tests: a real loopback server over `createHandler`, a fake
 * pool that records every statement, and a raw HTTP client that can send any method and Host.
 * Test-only; nothing in the Glass runtime imports this file.
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHandler } from '../src/http.ts';
import { SseHub } from '../src/sse.ts';

export interface Recorder {
  statements: string[];
  pool: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
}

/** A pool that answers every statement with no rows and records its text. */
export function recordingPool(rows: Record<string, unknown>[] = []): Recorder {
  const statements: string[] = [];
  return {
    statements,
    pool: {
      async query(text: string) {
        statements.push(text);
        return { rows };
      },
    },
  };
}

export interface Running {
  server: Server;
  port: number;
  hub: SseHub;
  recorder: Recorder;
  close(): Promise<void>;
}

/** Starts Glass's handler on 127.0.0.1 with an ephemeral port and a recording pool. */
export async function startGlass(
  rows: Record<string, unknown>[] = [],
  stream: Record<string, unknown>[] = [],
): Promise<Running> {
  const recorder = recordingPool(rows);
  let pending = stream;
  const hub = new SseHub({
    maxClients: 8,
    bufferFrames: 100,
    pollMs: 20,
    heartbeatMs: 15_000,
    start: async () => ({ cursor_at: '2026-11-10T00:00:00.000Z', thought_id: '' }),
    // The stream's rows arrive once, on the first poll after a client attaches.
    fetch: async () => {
      const out = pending;
      pending = [];
      return out;
    },
  });
  const server = createServer(createHandler({ db: recorder.pool as never, hub }));
  server.keepAliveTimeout = 100;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    hub,
    recorder,
    async close() {
      hub.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface Send {
  method: string;
  path: string;
  host?: string;
  headers?: Record<string, string>;
}

/**
 * Sends one request and reads the reply. A `text/event-stream` reply is read only for its headers
 * and then the socket is destroyed, so an open stream does not hang the test.
 */
export function send(port: number, req: Send): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...req.headers };
    if (req.host !== undefined) headers.Host = req.host;
    const out = httpRequest(
      { host: '127.0.0.1', port, method: req.method, path: req.path, headers },
      (res) => {
        const type = String(res.headers['content-type'] ?? '');
        if (type.startsWith('text/event-stream')) {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: '' });
          res.destroy();
          return;
        }
        collect(res).then(
          (body) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
          reject,
        );
      },
    );
    out.on('error', reject);
    out.end();
  });
}

function collect(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}
