import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Account } from './account.ts';
import type { RegisterConfig } from './config.ts';
import { type Identity, identityHash } from './identity.ts';
import {
  BASE,
  HOME_PAGE,
  REFUSED_PAGE,
  SECURITY_HEADERS,
  SIGNED_IN_PAGE,
  TERMS_PAGE,
} from './pages.ts';
import { newVerifier, STATE_COOKIE, STATE_TTL_MS, StateStore } from './pkce.ts';
import type { FetchFn, Provider } from './providers.ts';
import type { Store } from './store.ts';

/** The 0090 public refusal shapes (the same bodies the MCP front uses). */
const KILL_BODY = { error: { code: 'unavailable', message: 'Service unavailable' } };
const rateBody = (s: number) => ({
  error: { code: 'rate_limited', message: 'Too many requests' },
  retryAfter: s,
});

export interface RegisterDeps {
  readonly config: RegisterConfig;
  readonly providers: Readonly<{ microsoft: Provider }>;
  readonly fetch: FetchFn;
  readonly now: () => number;
  /** Log lines carry event names and the provider only: never an email, id, handle or token. */
  readonly log: (line: string) => void;
  /** Owner and player creation. Without a store the default shows a plain "signed in" page. */
  readonly store?: Store;
  /** Overrides the store-backed sign-in (tests of the sign-in alone). */
  readonly onSignedIn?: (
    identity: Identity,
    res: ServerResponse,
    consent: boolean,
  ) => Promise<void> | void;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(body);
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...SECURITY_HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const stateCookie = (value: string, maxAge: number): string =>
  `${STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

/** The address a request is judged by: the 0090 header, honoured only from a trusted peer. */
export function clientAddress(req: IncomingMessage, trusted: readonly string[]): string {
  const peer = req.socket.remoteAddress ?? 'unknown';
  if (!trusted.includes(peer)) return peer;
  const raw = req.headers['x-geldar-client-ip'];
  return typeof raw === 'string' && /^[0-9a-fA-F:.]{2,45}$/.test(raw) ? raw : peer;
}

export const LIMITER_MAX_KEYS = 10_000;

/** An IPv6 address is judged by its /64 (one subscriber holds the whole prefix); IPv4 and others are kept as they are. */
export function limiterKey(address: string): string {
  if (!address.includes(':') || address.includes('.')) return address;
  const [head = '', tail] = address.toLowerCase().split('::');
  const front = head === '' ? [] : head.split(':');
  const back = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups =
    tail === undefined
      ? front
      : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  if (groups.length !== 8) return address;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

export class FixedWindow {
  private readonly hits = new Map<string, { start: number; n: number }>();
  private readonly perMinute: number;
  private readonly now: () => number;
  constructor(perMinute: number, now: () => number) {
    this.perMinute = perMinute;
    this.now = now;
  }
  /** Seconds to wait, or 0 when the request may go on. */
  charge(key: string): number {
    const t = this.now();
    key = limiterKey(key);
    let h = this.hits.get(key);
    if (!h || t - h.start >= 60_000) {
      h = { start: t, n: 0 };
      this.hits.delete(key);
      this.hits.set(key, h);
      // Over the cap, drop the oldest keys one by one; a flush would reset every counter, an attacker's own included.
      while (this.hits.size > LIMITER_MAX_KEYS) {
        const oldest = this.hits.keys().next().value;
        if (oldest === undefined) break;
        this.hits.delete(oldest);
      }
    }
    h.n += 1;
    return h.n > this.perMinute ? Math.max(1, Math.ceil((h.start + 60_000 - t) / 1000)) : 0;
  }
}

export function createRegisterServer(deps: RegisterDeps): Server {
  const { config, now, log } = deps;
  const states = new StateStore(now);
  const limiter = new FixedWindow(config.perMinute, now);
  // R41: sign-in and sign-up have their own, tighter window per address (an IPv6 address by its /64).
  const signInLimiter = new FixedWindow(config.signInPerMinute, now);
  const ownerLimiter = new FixedWindow(config.ownerPerMinute, now);
  const account = deps.store
    ? new Account({
        config,
        store: deps.store,
        now,
        log,
        ownerCharge: (id) => ownerLimiter.charge(id),
      })
    : null;
  const onSignedIn = deps.onSignedIn ?? account?.signedIn;

  async function callback(
    provider: Provider,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    const cookie = cookieOf(req, STATE_COOKIE);
    const clear = { 'set-cookie': stateCookie('', 0) };
    // The state is marked used before anything else, so a replay can never reach the provider.
    const consent = states.consented(state);
    const verifier =
      cookie !== null && cookie === state ? states.consume(state, provider.name) : null;
    if (verifier === null || code === '') {
      log(`callback refused provider=${provider.name} reason=state`);
      return send(res, 403, REFUSED_PAGE, clear);
    }
    try {
      const profile = await provider.fetchProfile(
        code,
        `${config.publicUrl}${BASE}/callback`,
        verifier,
        deps.fetch,
      );
      const identity: Identity = {
        provider: provider.name,
        identityHash: identityHash(config.pepper, provider.name, profile.id),
        display: 'microsoft',
      };
      log(`signed in provider=${provider.name}`);
      if (onSignedIn) await onSignedIn(identity, res, consent);
      else send(res, 200, SIGNED_IN_PAGE, clear);
    } catch {
      log(`callback refused provider=${provider.name} reason=provider`);
      send(res, 403, REFUSED_PAGE, clear);
    }
  }

  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://local');
      // Caddy forwards /register/* and /roster/* on the shared Glass host unchanged; the service serves under /register.
      if (url.pathname === BASE || url.pathname.startsWith(`${BASE}/`))
        url.pathname = url.pathname.slice(BASE.length) || '/';
      if (config.killSwitch) return sendJson(res, 503, KILL_BODY);
      const wait = limiter.charge(clientAddress(req, config.trustedPeers));
      if (wait > 0) return sendJson(res, 429, rateBody(wait), { 'retry-after': String(wait) });
      if (account && (await account.handle(req, res, url))) return;
      if (req.method !== 'GET')
        return sendJson(res, 405, {
          error: { code: 'method_not_allowed', message: 'Method not allowed' },
        });
      if (url.pathname === '/') return send(res, 200, HOME_PAGE);
      if (url.pathname === '/terms') return send(res, 200, TERMS_PAGE);
      const m = /^\/(login|callback)$/.exec(url.pathname);
      if (!m) return sendJson(res, 404, { error: { code: 'not_found', message: 'Not found' } });
      const signWait = signInLimiter.charge(clientAddress(req, config.trustedPeers));
      if (signWait > 0)
        return sendJson(res, 429, rateBody(signWait), { 'retry-after': String(signWait) });
      const provider = deps.providers.microsoft;
      if (m[1] === 'callback') return callback(provider, url, req, res);
      const verifier = newVerifier();
      // The consent box travels with the sign-in state, so the callback knows whether it was ticked.
      const consent = url.searchParams.get('consent') === 'yes';
      const state = states.issue(provider.name, verifier, consent);
      res.writeHead(302, {
        location: provider.authorizeUrl(`${config.publicUrl}${BASE}/callback`, state, verifier),
        'set-cookie': stateCookie(state, STATE_TTL_MS / 1000),
        ...SECURITY_HEADERS,
      });
      res.end();
    })().catch(() => {
      if (!res.headersSent)
        sendJson(res, 500, { error: { code: 'internal', message: 'Internal error' } });
      else res.end();
    });
  });
}
