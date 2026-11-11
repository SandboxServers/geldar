import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CappedLimiter,
  INIT,
  PEPPER,
  storeWithTokenA,
  TOKEN_A,
} from '../fakes/front-door.fakes.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

/** A door behind a trusted proxy (the test client itself), logging into `lines`, on a clock the test sets. */
async function start(lines: Record<string, string | number>[], clock: { ms: number }) {
  door = createFrontDoor({
    http: {
      bind: '127.0.0.1',
      port: 0,
      allowedHosts: ['localhost', '127.0.0.1'],
      publicHost: null,
      trustedProxies: ['127.0.0.1'],
      clientIpHeader: 'x-geldar-client-ip',
      maxConnections: 256,
      maxConnectionsPerAddress: 32,
      maxBodyBytes: 65536,
    },
    pepper: PEPPER,
    store: storeWithTokenA(),
    limiter: new CappedLimiter(),
    createSession: () =>
      new McpServer({ name: 'header-log', version: '0.0.0' }, { capabilities: { tools: {} } }),
    log: (line) => lines.push(line),
    now: () => clock.ms,
  });
  return door.listen(0);
}

function post(port: number, header?: string) {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN_A}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(header === undefined ? {} : { 'x-geldar-client-ip': header }),
    },
    body: INIT,
  });
}

const warnings = (lines: Record<string, string | number>[], event: string) =>
  lines.filter((line) => line.event === event);

describe('the trusted-proxy header warning', () => {
  it('logs a missing header once a minute and counts the ones held back', async () => {
    const lines: Record<string, string | number>[] = [];
    const clock = { ms: 0 };
    const port = await start(lines, clock);
    for (let i = 0; i < 5; i++) await post(port);
    expect(warnings(lines, 'client_header_missing')).toHaveLength(1);
    clock.ms = 59_999;
    await post(port);
    expect(warnings(lines, 'client_header_missing')).toHaveLength(1);
    clock.ms = 60_000;
    await post(port);
    const logged = warnings(lines, 'client_header_missing');
    expect(logged).toHaveLength(2);
    expect(logged[0]?.suppressed).toBeUndefined();
    expect(logged[1]?.suppressed).toBe(5);
  });

  it('throttles a malformed header on its own, apart from a missing one', async () => {
    const lines: Record<string, string | number>[] = [];
    const port = await start(lines, { ms: 0 });
    await post(port);
    for (let i = 0; i < 3; i++) await post(port, '1.2.3.4, 5.6.7.8');
    expect(warnings(lines, 'client_header_missing')).toHaveLength(1);
    expect(warnings(lines, 'client_header_malformed')).toHaveLength(1);
  });
});
