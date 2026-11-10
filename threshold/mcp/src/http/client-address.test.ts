import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientAddress, trustedProxies } from './auth.ts';

/** A request as the address reader sees it: a socket peer and the headers, nothing else. */
function request(peer: string, headers: Record<string, string>): IncomingMessage {
  return { socket: { remoteAddress: peer }, headers } as unknown as IncomingMessage;
}

const PROXY = '10.0.0.5';
const trusted = trustedProxies([PROXY, '10.1.0.0/16']);

describe('clientAddress', () => {
  it('ignores a forwarded header sent by a peer that is not trusted', () => {
    for (const header of [
      'cf-connecting-ip',
      'x-geldar-client-ip',
      'x-forwarded-for',
      'x-real-ip',
    ]) {
      const req = request('203.0.113.7', { [header]: '198.51.100.1' });
      expect(clientAddress(req, trusted, header).address).toBe('203.0.113.7');
    }
  });

  it('ignores a forwarded header from an untrusted peer even when no proxy list is set', () => {
    const req = request('203.0.113.7', { 'x-geldar-client-ip': '198.51.100.1' });
    expect(clientAddress(req, trustedProxies([]), 'x-geldar-client-ip')).toEqual({
      address: '203.0.113.7',
    });
  });

  it('uses the configured single-value header from a trusted peer', () => {
    const req = request(PROXY, { 'x-geldar-client-ip': '198.51.100.9' });
    expect(clientAddress(req, trusted, 'x-geldar-client-ip')).toEqual({ address: '198.51.100.9' });
  });

  it('does not read the default header when another header is configured', () => {
    const req = request(PROXY, {
      'cf-connecting-ip': '198.51.100.9',
      'x-geldar-client-ip': '198.51.100.8',
    });
    expect(clientAddress(req, trusted, 'x-geldar-client-ip').address).toBe('198.51.100.8');
  });

  it('falls back to the peer and warns when a trusted peer sends no header', () => {
    const req = request(PROXY, {});
    expect(clientAddress(req, trusted, 'x-geldar-client-ip')).toEqual({
      address: PROXY,
      warning: 'header_missing',
    });
  });

  it('falls back to the peer and warns when the header is not an IP literal', () => {
    for (const value of ['not-an-address', '198.51.100.1:8080', '']) {
      const req = request(PROXY, { 'x-geldar-client-ip': value });
      expect(clientAddress(req, trusted, 'x-geldar-client-ip')).toEqual({
        address: PROXY,
        warning: 'header_malformed',
      });
    }
  });

  it('walks X-Forwarded-For from the right past trusted hops to the first untrusted one', () => {
    const req = request(PROXY, { 'x-forwarded-for': '192.0.2.1, 198.51.100.4, 10.1.2.3' });
    expect(clientAddress(req, trusted, 'x-forwarded-for')).toEqual({ address: '198.51.100.4' });
  });

  it('does not let a spoofed leftmost X-Forwarded-For entry name the client', () => {
    const req = request(PROXY, { 'x-forwarded-for': '192.0.2.66, 198.51.100.4' });
    expect(clientAddress(req, trusted, 'x-forwarded-for').address).toBe('198.51.100.4');
  });

  it('takes the leftmost hop when every hop is a trusted proxy', () => {
    const req = request(PROXY, { 'x-forwarded-for': '10.1.2.3, 10.1.9.9' });
    expect(clientAddress(req, trusted, 'x-forwarded-for').address).toBe('10.1.2.3');
  });

  it('falls back to the peer and warns when an X-Forwarded-For hop is malformed', () => {
    const req = request(PROXY, { 'x-forwarded-for': '198.51.100.4, junk' });
    expect(clientAddress(req, trusted, 'x-forwarded-for')).toEqual({
      address: PROXY,
      warning: 'header_malformed',
    });
  });

  it('warns when a trusted peer sends no X-Forwarded-For at all', () => {
    expect(clientAddress(request(PROXY, {}), trusted, 'x-forwarded-for').warning).toBe(
      'header_missing',
    );
  });
});
