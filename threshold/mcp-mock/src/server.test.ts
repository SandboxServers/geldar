import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTokens } from './auth.ts';
import type { MockHttp } from './server.ts';
import { createMockHttp } from './server.ts';

// Player ids are at least two characters (the player.json rule), so "aa" and "bb".
const TOKEN_A = 'token-for-player-a-0123456789';
const TOKEN_B = 'token-for-player-b-0123456789';

let dir: string;
let http: MockHttp;
let base: string;
let signals: Record<string, AbortSignal[]>;
let lines: Record<string, unknown>[];
let clients: Client[];

let hanging: (() => void) | undefined;

function pingServer(signal: AbortSignal): McpServer {
  const mcp = new McpServer(
    { name: 'ping-mock', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'ping', inputSchema: { type: 'object' as const } }],
  }));
  // hang stands in for a long wait: it returns only when the session's signal aborts.
  mcp.server.setRequestHandler(CallToolRequestSchema, async () => {
    hanging?.();
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    return { content: [{ type: 'text' as const, text: 'released' }] };
  });
  return mcp;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-mock-'));
  const file = join(dir, 'tokens.json');
  writeFileSync(file, JSON.stringify({ aa: TOKEN_A, bb: TOKEN_B }));
  signals = {};
  lines = [];
  clients = [];
  http = createMockHttp({
    tokens: loadTokens(file),
    createSession: (playerId, signal) => {
      const list = signals[playerId] ?? [];
      list.push(signal);
      signals[playerId] = list;
      return pingServer(signal);
    },
    log: (line) => lines.push(line),
  });
  base = `http://127.0.0.1:${await http.listen(0)}`;
}, 10_000);

afterEach(async () => {
  for (const client of clients) await client.close().catch(() => undefined);
  await http.close();
  rmSync(dir, { recursive: true, force: true });
}, 10_000);

const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
};

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
}

function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function connect(playerId: string, token: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/p/${playerId}`), {
    requestInit: { headers: bearer(token) },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function sessionIdOf(playerId: string, token: string): Promise<string> {
  const res = await call(`/p/${playerId}`, {
    method: 'POST',
    headers: bearer(token, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }),
    body: JSON.stringify(INIT),
  });
  await res.text();
  const id = res.headers.get('mcp-session-id');
  if (id === null) throw new Error('no session id');
  return id;
}

describe('mock http', () => {
  it('checks the bearer token and lets a valid client through', async () => {
    expect((await call('/p/aa', { method: 'POST' })).status).toBe(401);
    const none = await call('/p/aa', { method: 'POST' });
    expect(none.headers.get('www-authenticate')).toBe('Bearer');
    expect(
      (await call('/p/aa', { method: 'POST', headers: bearer('wrong-token-0123456789') })).status,
    ).toBe(401);
    expect((await call('/p/aa', { method: 'POST', headers: bearer(TOKEN_B) })).status).toBe(403);
    const client = await connect('aa', TOKEN_A);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['ping']);
  }, 30_000);

  it('rejects bad paths and methods', async () => {
    for (const path of ['/x', '/p/aa/', '/p/AA']) {
      expect((await call(path, { headers: bearer(TOKEN_A) })).status).toBe(404);
    }
    expect((await call('/p/aa', { method: 'PUT', headers: bearer(TOKEN_A) })).status).toBe(405);
  }, 30_000);

  it('rejects a foreign Origin', async () => {
    const res = await call('/p/aa', {
      method: 'POST',
      headers: bearer(TOKEN_A, { Origin: 'https://evil.example' }),
    });
    expect(res.status).toBe(403);
  }, 30_000);

  it('answers 413 to a 2 MiB body', async () => {
    const port = new URL(base).port;
    const outcome = await new Promise<string>((resolve) => {
      let status: number | undefined;
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/p/aa',
          method: 'POST',
          headers: bearer(TOKEN_A, {
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
          }),
          timeout: 10_000,
        },
        (res) => {
          status = res.statusCode;
          res.resume();
          res.on('end', () => resolve(`status ${status}`));
          res.on('error', () => resolve(`status ${status}`));
        },
      );
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (status !== undefined) resolve(`status ${status}`);
        else resolve(`error ${error.code}`);
      });
      req.on('timeout', () => req.destroy());
      const chunk = Buffer.alloc(64 * 1024, 'x');
      for (let i = 0; i < 32; i += 1) req.write(chunk);
      req.end();
    });
    expect(outcome).toBe('status 413');
  }, 30_000);

  it('supersedes an older session of the same player', async () => {
    const first = await connect('aa', TOKEN_A);
    const oldId = first.transport?.sessionId;
    expect(oldId).toBeDefined();
    expect(signals.aa?.[0]?.aborted).toBe(false);

    await connect('aa', TOKEN_A);
    expect(http.sessionCount('aa')).toBe(1);
    expect(signals.aa?.[0]?.aborted).toBe(true);
    expect(signals.aa?.[1]?.aborted).toBe(false);
    const res = await call('/p/aa', {
      method: 'POST',
      headers: bearer(TOKEN_A, {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': oldId ?? '',
      }),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('session_superseded');
  }, 30_000);

  it('aborts the old signal before waiting for in-flight handlers', async () => {
    const first = await connect('aa', TOKEN_A);
    const started = new Promise<void>((resolve) => {
      hanging = resolve;
    });
    const pending = first.callTool({ name: 'hang' });
    await started;
    const began = Date.now();
    await connect('aa', TOKEN_A);
    // Without the abort the supersede waits out its 1 s drain limit.
    expect(Date.now() - began).toBeLessThan(700);
    await pending.catch(() => undefined);
  }, 30_000);

  it("leaves another player's session alone", async () => {
    await connect('bb', TOKEN_B);
    await connect('aa', TOKEN_A);
    await connect('aa', TOKEN_A);
    expect(http.sessionCount('bb')).toBe(1);
    expect(signals.bb?.[0]?.aborted).toBe(false);
  }, 30_000);

  it('ends a session on DELETE', async () => {
    const id = await sessionIdOf('aa', TOKEN_A);
    const res = await call('/p/aa', {
      method: 'DELETE',
      headers: bearer(TOKEN_A, { 'mcp-session-id': id }),
    });
    expect(res.status).toBe(200);
    expect(http.sessionCount('aa')).toBe(0);
    expect(signals.aa?.[0]?.aborted).toBe(true);
  }, 30_000);

  it('answers 400 missing_session to a non-initialize POST without a session id', async () => {
    const res = await call('/p/aa', {
      method: 'POST',
      headers: bearer(TOKEN_A, {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      }),
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('missing_session');
  }, 30_000);

  it("answers 404 session_not_found for another player's session id", async () => {
    const id = await sessionIdOf('bb', TOKEN_B);
    const res = await call('/p/aa', {
      method: 'GET',
      headers: bearer(TOKEN_A, { 'mcp-session-id': id }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('session_not_found');
  }, 30_000);

  it('never logs a token', async () => {
    await call('/p/aa', { method: 'POST', headers: bearer('wrong-token-0123456789') });
    await connect('aa', TOKEN_A);
    expect(lines.length).toBeGreaterThan(0);
    const text = JSON.stringify(lines);
    expect(text).not.toContain(TOKEN_A);
    expect(text).not.toContain(TOKEN_B);
    expect(text).not.toContain('wrong-token');
    expect(text.toLowerCase()).not.toContain('bearer');
  }, 30_000);
});
