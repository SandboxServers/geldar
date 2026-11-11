import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientAddress, RateLimiter } from './guard.ts';

/** A clock the test moves by hand; no test sleeps. */
function clock(start = 1_000_000) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

/** One token a second, so a refill is easy to count. */
function limiter(burst: number, maxClients = 1024, t = clock()) {
  return {
    t,
    rl: new RateLimiter({ perMinute: 60, burst, maxClients, now: t.now }),
  };
}

function req(peer: string | undefined, forwarded?: string | string[]): IncomingMessage {
  return {
    socket: { remoteAddress: peer },
    headers: forwarded === undefined ? {} : { 'x-geldar-client-ip': forwarded },
  } as unknown as IncomingMessage;
}

describe('RateLimiter', () => {
  it('allows the last request of the burst and refuses the first one after it', () => {
    const { rl } = limiter(2);
    expect(rl.take('203.0.113.9')).toEqual({ allowed: true });
    expect(rl.take('203.0.113.9')).toEqual({ allowed: true });
    expect(rl.take('203.0.113.9')).toEqual({ allowed: false, retryAfter: 1 });
  });

  it('refills one token per second and answers the next request after the wait', () => {
    const { rl, t } = limiter(1);
    expect(rl.take('a').allowed).toBe(true);
    expect(rl.take('a').allowed).toBe(false);
    t.advance(999);
    expect(rl.take('a').allowed).toBe(false);
    t.advance(1);
    expect(rl.take('a')).toEqual({ allowed: true });
  });

  it('keeps clients apart: one client at its limit does not refuse another', () => {
    const { rl } = limiter(1);
    expect(rl.take('a').allowed).toBe(true);
    expect(rl.take('a').allowed).toBe(false);
    expect(rl.take('b').allowed).toBe(true);
  });

  it('never refills past the burst, however long a client is idle', () => {
    const { rl, t } = limiter(2);
    rl.take('a');
    t.advance(3_600_000);
    expect(rl.take('a').allowed).toBe(true);
    expect(rl.take('a').allowed).toBe(true);
    expect(rl.take('a').allowed).toBe(false);
  });

  it('reports at least one second of retry hint for a fast limit', () => {
    const rl = new RateLimiter({ perMinute: 6000, burst: 1, maxClients: 8, now: clock().now });
    rl.take('a');
    expect(rl.take('a')).toEqual({ allowed: false, retryAfter: 1 });
  });

  it('drops the least recently seen client when the table is full, and keeps the size bound', () => {
    const { rl } = limiter(1, 2);
    expect(rl.take('old').allowed).toBe(true);
    expect(rl.take('old').allowed).toBe(false);
    expect(rl.take('recent').allowed).toBe(true);
    // 'old' is not touched again, so a third client pushes it out.
    expect(rl.take('third').allowed).toBe(true);
    expect(rl.size).toBe(2);
    // 'old' was dropped, so it starts with a full bucket again.
    expect(rl.take('old').allowed).toBe(true);
  });

  it('keeps a client that was used recently when a new one arrives', () => {
    const { rl } = limiter(1, 2);
    rl.take('a');
    rl.take('b');
    rl.take('a');
    rl.take('c');
    // 'b' was the least recent, so 'a' still has its empty bucket and is refused.
    expect(rl.take('a').allowed).toBe(false);
    expect(rl.size).toBe(2);
  });
});

describe('clientAddress', () => {
  const trusted = new Set(['127.0.0.1']);

  it('uses the socket peer when the peer is not trusted, and ignores a forwarded header', () => {
    expect(clientAddress(req('198.51.100.7', '203.0.113.1'), trusted)).toBe('198.51.100.7');
  });

  it('uses the forwarded address when the peer is trusted', () => {
    expect(clientAddress(req('127.0.0.1', '203.0.113.1'), trusted)).toBe('203.0.113.1');
  });

  it('uses the peer when the trusted peer sends no header or a malformed one', () => {
    expect(clientAddress(req('127.0.0.1'), trusted)).toBe('127.0.0.1');
    expect(clientAddress(req('127.0.0.1', 'not an address'), trusted)).toBe('127.0.0.1');
    expect(clientAddress(req('127.0.0.1', ['203.0.113.1', '203.0.113.2']), trusted)).toBe(
      '203.0.113.1',
    );
  });

  it('trusts nothing when the trusted list is empty (the default)', () => {
    expect(clientAddress(req('127.0.0.1', '203.0.113.1'), new Set())).toBe('127.0.0.1');
  });
});
