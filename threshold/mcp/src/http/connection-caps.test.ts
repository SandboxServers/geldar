import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseMcpConfig, repoRoot } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { RateDecision, RateLimiter } from '../ports.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

const ENV = {
  GELDAR_MCP_DB_PASSWORD_FILE: '/run/secrets/postgres-mcp.txt',
  GELDAR_MCP_PEPPER_FILE: '/run/secrets/mcp-token-pepper.txt',
};
const PEPPER = new TextEncoder().encode('connection-caps-test-pepper-0123456789');

/** A fresh copy of the shipped shard file, so a test can change one key without touching the others. */
function shardDoc(): Record<string, any> {
  const text = readFileSync(join(repoRoot(), 'shards', 'phase0.yaml'), 'utf8');
  return structuredClone(parse(text)) as Record<string, any>;
}

/** The shard file with both connection keys removed, so the parser's defaults apply. */
function defaultsDoc(): Record<string, any> {
  const doc = shardDoc();
  delete doc.sovereign.mcp.max_connections;
  delete doc.sovereign.mcp.max_connections_per_address;
  return doc;
}

describe('connection limits in the shard file', () => {
  it('defaults max_connections to 320 and max_connections_per_address to 80 when absent', () => {
    const config = parseMcpConfig(defaultsDoc(), { env: ENV });
    expect(config.http.maxConnections).toBe(320);
    expect(config.http.maxConnectionsPerAddress).toBe(80);
  });

  it('reads explicit values from the shard file', () => {
    const doc = shardDoc();
    doc.sovereign.mcp.max_connections = 100;
    doc.sovereign.mcp.max_connections_per_address = 8;
    const config = parseMcpConfig(doc, { env: ENV });
    expect(config.http.maxConnections).toBe(100);
    expect(config.http.maxConnectionsPerAddress).toBe(8);
  });

  it.each([0, -1, 1.5, 4097])('rejects max_connections of %s', (value) => {
    const doc = shardDoc();
    doc.sovereign.mcp.max_connections = value;
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
      'sovereign.mcp.max_connections must be an integer from 1 to 4096',
    );
  });

  it.each([0, -1, 1.5, '32'])('rejects max_connections_per_address of %s', (value) => {
    const doc = shardDoc();
    doc.sovereign.mcp.max_connections_per_address = value;
    expect(() => parseMcpConfig(doc, { env: ENV })).toThrow(
      'sovereign.mcp.max_connections_per_address must be an integer from 1 to 4096',
    );
  });
});

/** A limiter that allows every take, so only the connection gate can refuse a socket here. */
class OpenLimiter implements RateLimiter {
  take(): RateDecision {
    return { allowed: true, retryAfterMs: 0 };
  }

  peek(): RateDecision {
    return { allowed: true, retryAfterMs: 0 };
  }
}

let door: FrontDoor | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await door?.close();
  door = undefined;
});

function open(port: number): Promise<Socket> {
  const socket = connect({ host: '127.0.0.1', port });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Resolves true when the server closes the socket within the wait, false when it stays open. */
function closedWithin(socket: Socket, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe('connection limits in the front door', () => {
  it('refuses an 81st connection from one address under the default config', async () => {
    const config = parseMcpConfig(defaultsDoc(), { env: ENV });
    door = createFrontDoor({
      http: { ...config.http, port: 0 },
      pepper: PEPPER,
      store: new FakeTokenStore(),
      limiter: new OpenLimiter(),
      createSession: () =>
        new McpServer({ name: 'conn-cap-test', version: '0.0.0' }, { capabilities: {} }),
      log: () => undefined,
    });
    const port = await door.listen(0);
    const held: Socket[] = [];
    for (let i = 0; i < 80; i++) held.push(await open(port));
    const extra = connect({ host: '127.0.0.1', port });
    sockets.push(extra);
    expect(await closedWithin(extra, 2000)).toBe(true);
    expect(held.every((s) => !s.destroyed)).toBe(true);
  });
});
