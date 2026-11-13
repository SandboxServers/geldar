import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A stand-in for the Docker Engine on a real socket (or named pipe), for the Docker client's tests.
// It records every call and answers with what the test scripts.

export interface EngineCall {
  method: string;
  path: string;
  body: unknown;
}

export interface ScriptedReply {
  status: number;
  json?: unknown;
}

export interface FakeEngine {
  socketPath: string;
  calls: EngineCall[];
  close(): Promise<void>;
}

export function socketPathFor(tag: string): string {
  const unique = `geldar-c7-03b3-${tag}-${process.pid}-${randomUUID()}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${unique}` : join(tmpdir(), `${unique}.sock`);
}

export async function startFakeEngine(
  tag: string,
  handler: (call: EngineCall) => ScriptedReply | Promise<ScriptedReply>,
): Promise<FakeEngine> {
  const calls: EngineCall[] = [];
  const socketPath = socketPathFor(tag);
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const call: EngineCall = {
        method: req.method ?? '',
        path: req.url ?? '',
        body: raw === '' ? undefined : JSON.parse(raw),
      };
      calls.push(call);
      void Promise.resolve(handler(call)).then((reply) => {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.json === undefined ? '' : JSON.stringify(reply.json));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
