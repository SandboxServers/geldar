import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { GlassConfig } from './config.ts';
import { createHandler, type GlassHandlerDeps, SECURITY_HEADERS } from './http.ts';
import type { SqlClient } from './query.ts';
import { ROUTES } from './routes.ts';
import { buildGlass } from './server.ts';
import type { SseHub } from './sse.ts';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'];

/** Fails the test if a handler reaches the database: a refused method must never query. */
const noQueries: SqlClient = {
  query: async () => {
    throw new Error('the database must not be queried');
  },
};

/** One fixed row for every query, so each GET route answers 200. */
const oneRow: SqlClient = {
  query: async () => ({
    rows: [
      {
        thought_id: 'abc',
        life_id: 'kestrel',
        cursor_at: '2026-11-10 00:00:00+00',
        model_input: 'hi',
      },
    ],
  }),
};

/** A stream that ends at once: the route is reachable and the test does not hold a socket open. */
const endingHub = {
  attach: (res: ServerResponse): boolean => {
    res.writeHead(200);
    res.end('stream');
    return true;
  },
} as unknown as SseHub;

const CONFIG: GlassConfig = {
  host: '127.0.0.1',
  port: 0,
  pg: { host: '127.0.0.1', port: 5432, user: 'geldar_glass', database: 'geldar', password: 'x' },
  sseMaxClients: 2,
  sseBufferFrames: 10,
  ssePollMs: 1000,
};

const servers: Server[] = [];

/** Starts the handler on a loopback port the OS picks. */
async function start(deps: GlassHandlerDeps): Promise<number> {
  const server = createServer(createHandler(deps));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Any method, any path: node:http sends the method as written, unlike fetch. */
function send(port: number, method: string, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path }, (res: IncomingMessage) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

/** A concrete path for each route: the :id placeholder gets a value, receipts needs its query. */
function samplePath(path: string): string {
  if (path === '/api/receipts') return '/api/receipts?action_id=a1';
  return path.replace(':id', 'abc');
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('the Glass HTTP handler', () => {
  it('refuses any bind address but 127.0.0.1, before a socket exists', () => {
    for (const host of ['0.0.0.0', '::', '::1', '192.168.0.10', 'localhost']) {
      expect(() => buildGlass({ ...CONFIG, host }), host).toThrow();
    }
  });

  it('binds to 127.0.0.1 only, and builds without listening', async () => {
    const parts = buildGlass(CONFIG);
    try {
      expect(parts.server.listening).toBe(false);
      await new Promise<void>((resolve) => parts.server.listen(0, CONFIG.host, resolve));
      expect((parts.server.address() as AddressInfo).address).toBe('127.0.0.1');
    } finally {
      parts.server.closeAllConnections();
      await new Promise<void>((resolve) => parts.server.close(() => resolve()));
      await parts.pool.end();
    }
  });

  it('answers every method except GET with 405, Allow: GET, and no database call, on every route', async () => {
    const port = await start({ db: noQueries, hub: endingHub });
    for (const route of ROUTES) {
      for (const method of WRITE_METHODS) {
        const reply = await send(port, method, samplePath(route.path));
        expect(reply.status, `${method} ${route.path}`).toBe(405);
        expect(reply.headers.allow, `${method} ${route.path}`).toBe('GET');
      }
    }
  });

  it('answers 404 for every unknown path, whatever the method', async () => {
    const port = await start({ db: noQueries, hub: endingHub });
    for (const path of [
      '/',
      '/api',
      '/api/',
      '/api/nope',
      '/api/thoughts/',
      '/api/thoughts/a/b',
      '/api/stream/x',
    ]) {
      expect((await send(port, 'GET', path)).status, path).toBe(404);
      expect((await send(port, 'POST', path)).status, path).toBe(404);
    }
  });

  it('lists the routes, all GET, and serves a GET to each one', async () => {
    const port = await start({ db: oneRow, hub: endingHub });
    expect(ROUTES.map((route) => route.method)).toEqual(['GET', 'GET', 'GET', 'GET', 'GET']);
    for (const route of ROUTES) {
      const reply = await send(port, 'GET', samplePath(route.path));
      expect(reply.status, route.path).toBe(200);
    }
  });

  it('sends the security headers on every response, including 404 and 405', async () => {
    const port = await start({ db: noQueries, hub: endingHub });
    for (const [method, path] of [
      ['GET', '/api/nope'],
      ['POST', '/api/agents'],
      ['GET', '/api/stream'],
    ] as const) {
      const reply = await send(port, method, path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(reply.headers[name.toLowerCase()], `${method} ${path} ${name}`).toBe(value);
      }
    }
  });
});
