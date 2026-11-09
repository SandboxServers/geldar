import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ModelPin } from '../src/config.ts';

/** A digest that passes the loader's format check. */
export const GOOD_DIGEST = `sha256:${'a'.repeat(64)}`;

export function pin(name = 'qwen3:8b', overrides: Partial<ModelPin> = {}): ModelPin {
  return {
    name,
    digest: GOOD_DIGEST,
    numCtx: 8192,
    keepAlive: '30m',
    maxConcurrent: 1,
    ...overrides,
  };
}

export interface RecordedRequest {
  path: string;
  body: Record<string, unknown>;
  /** True once the client dropped the connection before the answer was sent. */
  aborted: boolean;
}

export type OllamaHandler = (req: RecordedRequest, res: ServerResponse) => void;

/** A fake Ollama on `127.0.0.1:0`. The handler decides each answer; requests are recorded. */
export class FakeOllama {
  readonly requests: RecordedRequest[] = [];
  handler: OllamaHandler = (_req, res) => this.reply(res, {});
  /** Answers the thinker's one-token warm-up calls (num_predict 1), so a test can fail or hang them alone. */
  warmHandler: OllamaHandler = (_req, res) => this.reply(res, { message: { content: '' } });
  private readonly server: Server;
  url = '';

  constructor() {
    this.server = createServer((req, res) => void this.onRequest(req, res));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reply(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const recorded: RecordedRequest = {
      path: req.url ?? '',
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      aborted: false,
    };
    res.on('close', () => {
      if (!res.writableEnded) recorded.aborted = true;
    });
    this.requests.push(recorded);
    const options = recorded.body.options as { num_predict?: number } | undefined;
    if (options?.num_predict === 1) this.warmHandler(recorded, res);
    else this.handler(recorded, res);
  }
}

/** A fake Mind: a `ws` server that records the frames a Thinker sends and lets a test push frames. */
export class FakeMind {
  frames: Record<string, unknown>[] = [];
  connections = 0;
  socket: WebSocket | null = null;
  url = '';
  /** When true (the default) a `hello` is answered with a `welcome` for `qwen3:8b`. */
  autoWelcome = true;
  private readonly server: WebSocketServer;

  constructor() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    this.server.on('connection', (socket) => {
      this.connections += 1;
      this.socket = socket;
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        this.frames.push(frame);
        if (frame.type === 'hello' && this.autoWelcome) this.welcome();
      });
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.once('listening', () => resolve()));
    this.url = `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1/thinker/stream`;
  }

  async stop(): Promise<void> {
    for (const client of this.server.clients) client.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  welcome(models: string[] = ['qwen3:8b']): void {
    this.push({
      type: 'welcome',
      thinker: 'local',
      accepted_models: models,
      server_time: new Date().toISOString(),
    });
  }

  push(frame: unknown): void {
    this.socket?.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'job',
      job_id: 'jb_01HZXY0000000000000000AAAA',
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 50,
      temperature: 0.7,
      stop: null,
      deadline: new Date(Date.now() + 30_000).toISOString(),
      ...overrides,
    };
  }

  /** Waits until a frame of the type (not before `from`) has arrived; returns it. */
  async next(type: string, from = 0, timeoutMs = 3000): Promise<Record<string, unknown>> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const found = this.frames.slice(from).find((f) => f.type === type);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${type} frame within ${timeoutMs} ms; saw ${JSON.stringify(this.frames)}`);
  }
}

/** Polls until the condition holds. */
export async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}
