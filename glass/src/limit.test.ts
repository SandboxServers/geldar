import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler } from './http.ts';
import type { SseHub } from './sse.ts';

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function get(path: string): Promise<number> {
  const db = { query: async () => ({ rows: [] }) };
  const server = createServer(createHandler({ db, hub: {} as unknown as SseHub }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the thought list limit', () => {
  it.each([
    ['1', 200],
    ['100', 200],
    ['101', 400],
    ['0', 400],
    ['1.5', 400],
    ['abc', 400],
  ])('limit=%s answers %i', async (limit, status) => {
    expect(await get(`/api/thoughts?limit=${limit}`)).toBe(status);
  });
});
