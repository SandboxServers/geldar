import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { bodyRoutes } from '../src/api/body.ts';
import { createBodySlot } from '../src/api/body-slot.ts';
import type { ApiRoute } from '../src/api/route.ts';
import { loadConfig, type RegisterConfig } from '../src/config.ts';
import { bodyWiring, type ConnectNats, mountBodyApi } from '../src/nats-body.ts';
import { microsoftProvider } from '../src/providers.ts';
import { createRegisterServer } from '../src/server.ts';

const KEY = `gowner-${'a1'.repeat(32)}`;
const hash = (v: string): Buffer => createHash('sha256').update(v).digest();
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const dec = (d: Uint8Array) => new TextDecoder().decode(d);
const START = '/api/v1/agents/ag-one-01/body/start';
const SHARD = 'phase0';

/** The secret files by path. Any other path is unreadable. */
const SECRETS: Record<string, string> = {
  pepper: 'p'.repeat(40),
  session: 's'.repeat(40),
  ms: 'm'.repeat(20),
  token: 't'.repeat(40),
  natspw: 'n'.repeat(20),
  blank: ' \n',
};
const readSecret = (path: string): string => {
  const value = SECRETS[path];
  if (value === undefined) throw new Error('no such file');
  return value;
};

const BASE_ENV = {
  REGISTER_PEPPER_FILE: 'pepper',
  REGISTER_SESSION_KEY_FILE: 'session',
  REGISTER_MS_CLIENT_SECRET_FILE: 'ms',
  REGISTER_TOKEN_PEPPER_FILE: 'token',
  REGISTER_PUBLIC_URL: 'https://glass.example',
  REGISTER_SHARD: SHARD,
  REGISTER_KILL_SWITCH: 'false',
  REGISTER_PER_MINUTE: '1000',
};
const NATS_ENV = {
  REGISTER_NATS_URL: 'nats://127.0.0.1:1',
  REGISTER_NATS_USER: 'register',
  REGISTER_NATS_PASSWORD_FILE: 'natspw',
  REGISTER_NATS_TIMEOUT_MS: '1000',
};

/** A fake NATS link that records each request and answers with `answer`. */
function fakeConn(
  answer: () => Promise<Uint8Array> | Uint8Array = () => enc({ ok: true, code: 'started' }),
) {
  const sent: { subject: string; timeout: number; payload: Record<string, unknown> }[] = [];
  const conn = {
    async request(subject: string, data: Uint8Array, opts: { timeout: number }) {
      sent.push({
        subject,
        timeout: opts.timeout,
        payload: JSON.parse(dec(data)) as Record<string, unknown>,
      });
      return { data: await answer() };
    },
  };
  return { conn, sent };
}

const servers: { close(cb: () => void): void }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((ok) => s.close(() => ok()))));
});

/** Serves the register with `routes` mounted through the API, the kill switch and limiter on the way. */
async function serve(config: RegisterConfig, routes: readonly ApiRoute[]): Promise<string> {
  const server = createRegisterServer({
    config,
    providers: { microsoft: microsoftProvider(config.microsoft) },
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    log: () => undefined,
    api: {
      routes,
      ownerKeys: {
        hash,
        store: {
          resolve: async (h) =>
            h.equals(hash(KEY)) ? { ownerId: 'alice', scopes: ['read', 'body'] } : null,
          mint: async () => null,
          revoke: async () => null,
          list: async () => null,
        },
      },
      agents: async (_owner, player) =>
        player === 'ag-one-01'
          ? { ownerId: 'alice', playerId: player, displayName: 'Ranger' }
          : null,
    },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const call = (base: string, method: string, path: string, key = KEY) =>
  fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${key}` } }).then(
    async (r) => ({
      status: r.status,
      retryAfter: r.headers.get('retry-after'),
      body: await r.text(),
    }),
  );

describe('body wiring config (C7-04c2)', () => {
  it('leaves NATS off when no NATS variable is set, and loads', () => {
    const config = loadConfig(BASE_ENV, readSecret);
    expect(config.nats).toBeNull();
  });

  it('reads the password from the file and the reply wait from the variable', () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    expect(config.nats).toEqual({
      url: 'nats://127.0.0.1:1',
      user: 'register',
      password: SECRETS.natspw,
      timeoutMs: 1000,
    });
  });

  it('defaults the reply wait to 5000 ms', () => {
    const { REGISTER_NATS_TIMEOUT_MS: _unused, ...rest } = NATS_ENV;
    expect(loadConfig({ ...BASE_ENV, ...rest }, readSecret).nats?.timeoutMs).toBe(5000);
  });

  it('a partial NATS setting leaves NATS off and does not fail the start', () => {
    const { REGISTER_NATS_USER: _user, ...noUser } = NATS_ENV;
    expect(loadConfig({ ...BASE_ENV, ...noUser }, readSecret).nats).toBeNull();
  });

  it('an unreadable password file leaves NATS off and does not fail the start', () => {
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_PASSWORD_FILE: 'missing' };
    expect(loadConfig(env, readSecret).nats).toBeNull();
  });

  it('an empty password file leaves NATS off and says so', () => {
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_PASSWORD_FILE: 'blank' };
    const config = loadConfig(env, readSecret);
    expect(config.nats).toBeNull();
    expect(config.natsPasswordUnreadable).toBe(true);
  });

  it('an unreadable password file is flagged, and an unset NATS is not', () => {
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_PASSWORD_FILE: 'missing' };
    expect(loadConfig(env, readSecret).natsPasswordUnreadable).toBe(true);
    expect(loadConfig(BASE_ENV, readSecret).natsPasswordUnreadable).toBe(false);
  });

  it('logs the unreadable password file by variable name, not as a NATS-off start', () => {
    const lines: string[] = [];
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_PASSWORD_FILE: 'blank' };
    bodyWiring(loadConfig(env, readSecret), (l) => lines.push(l));
    expect(lines).toEqual([
      'body routes unmounted: REGISTER_NATS_PASSWORD_FILE is unreadable or empty',
    ]);
    const off: string[] = [];
    bodyWiring(loadConfig(BASE_ENV, readSecret), (l) => off.push(l));
    expect(off).toEqual(['body routes unmounted: NATS is not configured']);
  });

  it.each([
    ['0', true],
    ['1', false],
    ['60000', false],
    ['60001', true],
  ])('reply wait %s ms: refused when %s', (value, refused) => {
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_TIMEOUT_MS: value };
    if (refused) {
      expect(() => loadConfig(env, readSecret)).toThrow(/REGISTER_NATS_TIMEOUT_MS/);
    } else {
      expect(loadConfig(env, readSecret).nats?.timeoutMs).toBe(Number(value));
    }
  });

  it('refuses a NATS URL that is not nats://', () => {
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_URL: 'http://127.0.0.1:4222' };
    expect(() => loadConfig(env, readSecret)).toThrow(/REGISTER_NATS_URL/);
  });
});

describe('body wiring mount (C7-04c2)', () => {
  const PATHS: [string, string][] = [
    ['POST', START],
    ['POST', '/api/v1/agents/ag-one-01/body/stop'],
    ['POST', '/api/v1/agents/ag-one-01/body/restart'],
    ['GET', '/api/v1/agents/ag-one-01/body/status'],
    ['GET', '/api/v1/agents/ag-one-01/body/log'],
  ];

  it('with the body routes unmounted, every body path is 404 through the router', async () => {
    const config = loadConfig({ ...BASE_ENV }, readSecret);
    const base = await serve(config, bodyWiring(config, () => undefined).routes);
    for (const [method, path] of PATHS) {
      expect((await call(base, method, path)).status).toBe(404);
    }
  });

  it('with NATS configured but unreachable, start and status are 503 body_unavailable', async () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    const base = await serve(config, bodyWiring(config, () => undefined).routes);
    const start = await call(base, 'POST', START);
    expect(start.status).toBe(503);
    expect(start.body).toContain('body_unavailable');
    expect(start.retryAfter).toBe('30');
    const status = await call(base, 'GET', '/api/v1/agents/ag-one-01/body/status');
    expect(status.status).toBe(503);
    expect(status.body).toContain('body_unavailable');
  });

  it('after an unreachable start the slot is free: a second start is 503, not 409', async () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    const base = await serve(config, bodyWiring(config, () => undefined).routes);
    await call(base, 'POST', START);
    const again = await call(base, 'POST', START);
    expect(again.status).toBe(503);
    expect(again.body).not.toContain('conflict');
  });

  it('the mounted router reaches the handler: start is 202 with the display name', async () => {
    const config = loadConfig(BASE_ENV, readSecret);
    const fake = fakeConn();
    const base = await serve(
      config,
      bodyRoutes({ conn: fake.conn, shard: SHARD, timeoutMs: 1000 }),
    );
    const r = await call(base, 'POST', START);
    expect(r.status).toBe(202);
    expect(fake.sent[0]?.subject).toBe(`geldar.${SHARD}.ctl.body.start`);
    expect(fake.sent[0]?.payload).toMatchObject({ playerName: 'Ranger', ownerId: 'alice' });
  });

  it('the config reply wait reaches requestBodyOp', async () => {
    const config = loadConfig(BASE_ENV, readSecret);
    const fake = fakeConn();
    const base = await serve(
      config,
      bodyRoutes({ conn: fake.conn, shard: SHARD, timeoutMs: 1234 }),
    );
    await call(base, 'POST', START);
    expect(fake.sent[0]?.timeout).toBe(1234);
  });

  it('one slot shared by two routers: a start in flight makes the other start 409 conflict', async () => {
    const config = loadConfig(BASE_ENV, readSecret);
    const slot = createBodySlot();
    let release!: () => void;
    const gate = new Promise<void>((ok) => {
      release = ok;
    });
    const held = fakeConn(async () => {
      await gate;
      return enc({ ok: true, code: 'started' });
    });
    const other = fakeConn();
    const baseA = await serve(
      config,
      bodyRoutes({ conn: held.conn, shard: SHARD, timeoutMs: 5000, slot }),
    );
    const baseB = await serve(
      config,
      bodyRoutes({ conn: other.conn, shard: SHARD, timeoutMs: 5000, slot }),
    );
    const first = call(baseA, 'POST', START);
    for (let i = 0; i < 200 && held.sent.length === 0; i++) {
      await new Promise((ok) => setTimeout(ok, 5));
    }
    expect(held.sent.length).toBe(1);
    const second = await call(baseB, 'POST', START);
    expect(second.status).toBe(409);
    expect(second.body).toContain('conflict');
    expect(other.sent.length).toBe(0);
    release();
    expect((await first).status).toBe(202);
  });

  it('the slot bodyWiring returns is the one the mounted routes use: a held owner gets 409', async () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    const wired = bodyWiring(config, () => undefined);
    wired.slot.add('alice');
    const base = await serve(config, wired.routes);
    const start = await call(base, 'POST', START);
    expect(start.status).toBe(409);
    expect(start.body).toContain('conflict');
  });
});

/** A fake connect function: the scripted outcome of each connect ('ok' by default) and the calls it saw. */
function fakeConnect(script: ('ok' | 'refuse')[] = []) {
  const calls: { opts: Parameters<ConnectNats>[0]; onFatal: () => void }[] = [];
  const sent: { subject: string; timeout: number }[] = [];
  const connect = (async (opts: Parameters<ConnectNats>[0], onFatal: () => void) => {
    calls.push({ opts, onFatal });
    if ((script.shift() ?? 'ok') === 'refuse') throw new Error('refused');
    return {
      async request(subject: string, _data: Uint8Array, o: { timeout: number }) {
        sent.push({ subject, timeout: o.timeout });
        return { data: enc({ ok: true, code: 'started' }) };
      },
    };
  }) as unknown as ConnectNats;
  return { connect, calls, sent };
}

describe('body wiring link (C7-04c2)', () => {
  it('connects with the name, URL, user and password from the settings', async () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    const fake = fakeConnect();
    const base = await serve(config, bodyWiring(config, () => undefined, fake.connect).routes);
    await call(base, 'POST', START);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.opts).toEqual({
      name: 'geldar-register',
      servers: 'nats://127.0.0.1:1',
      user: 'register',
      pass: SECRETS.natspw,
    });
  });

  it('a refused connect is a 503, and the next request connects again and succeeds', async () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    const fake = fakeConnect(['refuse', 'ok']);
    const base = await serve(config, bodyWiring(config, () => undefined, fake.connect).routes);
    const first = await call(base, 'POST', START);
    expect(first.status).toBe(503);
    expect(first.body).toContain('body_unavailable');
    const second = await call(base, 'POST', START);
    expect(second.status).toBe(202);
    expect(fake.calls).toHaveLength(2);
  });

  it('a fatal close drops the link: the next request connects again', async () => {
    const config = loadConfig({ ...BASE_ENV, ...NATS_ENV }, readSecret);
    const fake = fakeConnect(['ok', 'ok']);
    const lines: string[] = [];
    const base = await serve(config, bodyWiring(config, (l) => lines.push(l), fake.connect).routes);
    expect((await call(base, 'POST', START)).status).toBe(202);
    fake.calls[0]?.onFatal();
    expect(lines).toContain('body nats link closed');
    expect((await call(base, 'POST', START)).status).toBe(202);
    expect(fake.calls).toHaveLength(2);
  });

  it('the config reply wait reaches the link request through bodyWiring', async () => {
    const env = { ...BASE_ENV, ...NATS_ENV, REGISTER_NATS_TIMEOUT_MS: '1234' };
    const config = loadConfig(env, readSecret);
    const fake = fakeConnect();
    const base = await serve(config, bodyWiring(config, () => undefined, fake.connect).routes);
    await call(base, 'POST', START);
    expect(fake.sent[0]?.timeout).toBe(1234);
  });
});

describe('body mount in main (C7-04c2)', () => {
  it('mountBodyApi keeps the production members and sets the routes to the body routes', () => {
    const body = bodyWiring(loadConfig(BASE_ENV, readSecret), () => undefined);
    const api = mountBodyApi({ marker: 'production' }, body);
    expect(api.marker).toBe('production');
    expect(api.routes).toBe(body.routes);
  });
});
