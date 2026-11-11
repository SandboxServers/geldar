import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { clientKey, RateLimiter } from './guard.ts';
import { createHandler } from './http.ts';

describe('the client key', () => {
  it('leaves an IPv4 address unchanged', () => {
    expect(clientKey('192.0.2.7')).toBe('192.0.2.7');
    expect(clientKey('127.0.0.1')).toBe('127.0.0.1');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(clientKey('::ffff:192.0.2.7')).toBe('192.0.2.7');
    expect(clientKey('::ffff:c000:0207')).toBe('192.0.2.7');
    expect(clientKey('::FFFF:127.0.0.1')).toBe('127.0.0.1');
  });

  it('keys an IPv6 address by its first four groups', () => {
    expect(clientKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
  });

  it('expands :: and ignores case and leading zeros before cutting', () => {
    expect(clientKey('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKey('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('2001:db8:5::')).toBe('2001:db8:5:0::/64');
  });

  it('returns an unparsable value as it is', () => {
    expect(clientKey('')).toBe('');
    expect(clientKey('2001:db8::1::2')).toBe('2001:db8::1::2');
    expect(clientKey('not:an:address')).toBe('not:an:address');
  });
});

describe('the rate limit by client key', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  function status(port: number, forwarded: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/agents',
          headers: { 'x-geldar-client-ip': forwarded },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('charges two addresses in one /64 to the same bucket, and another /64 to its own', async () => {
    const db = { query: async () => ({ rows: [] }) };
    const hub = { attach: () => true } as never;
    const limiter = new RateLimiter({ perMinute: 1, burst: 1, maxClients: 16, now: () => 0 });
    const server = createServer(
      createHandler({
        db,
        hub,
        policy: { limiter, trustedProxies: new Set(['127.0.0.1', '::ffff:127.0.0.1']) },
      }),
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    expect(await status(port, '2001:db8:1:2::1')).toBe(200);
    expect(await status(port, '2001:db8:1:2:aaaa::9')).toBe(429);
    expect(await status(port, '2001:db8:1:3::1')).toBe(200);
  });
});
