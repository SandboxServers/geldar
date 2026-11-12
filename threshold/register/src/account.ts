import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashToken, mintToken } from '../../mcp/src/store/token-hash.ts';
import { accountPage, tokenPage } from './account-pages.ts';
import type { RegisterConfig } from './config.ts';
import type { Identity } from './identity.ts';
import { BASE, REFUSED_PAGE, SECURITY_HEADERS } from './pages.ts';
import { STATE_COOKIE } from './pkce.ts';
import { KINO_COOKIE_TTL_MS, kinoCookieHeader, signKinoSession } from './session-cookie.ts';
import type { Store } from './store.ts';

export const SESSION_COOKIE = 'gr_session';
export const SESSION_TTL_MS = 30 * 60 * 1000;
/** The draft terms version an owner accepts at sign-up (C7-08). Bump it when the approved text changes. */
export const TERMS_VERSION = 'draft-1';
const PLAYER_ID = /^ag-[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/;
const MAX_BODY = 4096;

interface Session {
  readonly ownerId: string;
  readonly identityHash: string;
  readonly csrf: string;
  readonly expiresAt: number;
}

export interface AccountDeps {
  readonly config: RegisterConfig;
  readonly store: Store;
  readonly now: () => number;
  readonly log: (line: string) => void;
  /** Per-owner limiter (R41): seconds to wait, or 0. */
  readonly ownerCharge?: (ownerId: string) => number;
}

const cookieOf = (req: IncomingMessage, name: string): string | null => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
};

const sessionCookie = (value: string, maxAge: number): string =>
  `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

function html(res: ServerResponse, status: number, body: string, extra = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(body);
}

const refuse = (res: ServerResponse): void => html(res, 403, REFUSED_PAGE);

async function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded'))
    return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const same = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Sessions, owner and player creation, and the account pages. */
export class Account {
  private readonly sessions = new Map<string, Session>();
  private readonly deps: AccountDeps;
  private lock: Promise<unknown> = Promise.resolve();
  constructor(deps: AccountDeps) {
    this.deps = deps;
  }

  /** Live session count, for the sweep test. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** One sign-up at a time, so the daily cap cannot be passed by two parallel callbacks. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** The callback hook: banned and capped checks, then the owner, then a session and a redirect. */
  readonly signedIn = async (
    identity: Identity,
    res: ServerResponse,
    consent = false,
  ): Promise<void> => {
    const { store, config, now, log } = this.deps;
    const outcome = await this.serial(async () => {
      const found = await store.findOwner(identity.identityHash);
      if (found?.banned) return 'banned' as const;
      if (found) return found.ownerId;
      // Sign-up needs the consent box (C7-08): no owner row without it.
      if (!consent) return 'consent' as const;
      const ownerId = `reg-${identity.identityHash.slice(0, 24)}`;
      await store.createOwner(identity, ownerId, TERMS_VERSION);
      return ownerId;
    });
    const clearState = `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
    if (outcome === 'banned') {
      log(`sign-in refused provider=${identity.provider} reason=banned`);
      return html(res, 403, REFUSED_PAGE, { 'set-cookie': clearState });
    }
    if (outcome === 'consent') {
      log(`sign-up refused provider=${identity.provider} reason=consent`);
      return html(res, 403, REFUSED_PAGE, { 'set-cookie': clearState });
    }
    for (const [key, s] of this.sessions) if (now() >= s.expiresAt) this.sessions.delete(key);
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(id, {
      ownerId: outcome,
      identityHash: identity.identityHash,
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: now() + SESSION_TTL_MS,
    });
    res.writeHead(302, {
      location: `${BASE}/account`,
      'set-cookie': [
        clearState,
        sessionCookie(id, SESSION_TTL_MS / 1000),
        kinoCookieHeader(
          signKinoSession(config.sessionKey, {
            identityHash: identity.identityHash,
            expiresAt: now() + KINO_COOKIE_TTL_MS,
          }),
          KINO_COOKIE_TTL_MS / 1000,
        ),
      ],
      ...SECURITY_HEADERS,
    });
    res.end();
  };

  private sessionOf(req: IncomingMessage): Session | null {
    const id = cookieOf(req, SESSION_COOKIE);
    const s = id === null ? undefined : this.sessions.get(id);
    if (!s) return null;
    if (this.deps.now() >= s.expiresAt) {
      if (id) this.sessions.delete(id);
      return null;
    }
    return s;
  }

  /** Handles an account route; false when the path is not one of them. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const m =
      /^\/(account|players|logout)(?:\/(ag-[a-z0-9-]+)\/(token|retire|public-camera|public-thoughts))?$/.exec(
        url.pathname,
      );
    if (!m) return false;
    const session = this.sessionOf(req);
    if (!session) {
      res.writeHead(302, { location: BASE, ...SECURITY_HEADERS });
      res.end();
      return true;
    }
    if (m[1] === 'account') {
      if (req.method !== 'GET') return this.methodNotAllowed(res);
      return this.show(res, session);
    }
    if (req.method !== 'POST') return this.methodNotAllowed(res);
    const origin = req.headers.origin;
    const fields = await readForm(req);
    if (
      (origin !== undefined && origin !== this.deps.config.publicUrl) ||
      !fields ||
      !same(fields.get('csrf') ?? '', session.csrf)
    ) {
      this.deps.log('post refused reason=csrf');
      refuse(res);
      return true;
    }
    if (m[1] === 'logout') {
      const sid = cookieOf(req, SESSION_COOKIE);
      if (sid) this.sessions.delete(sid);
      res.writeHead(302, {
        location: BASE,
        'set-cookie': [sessionCookie('', 0), kinoCookieHeader('', 0)],
        ...SECURITY_HEADERS,
      });
      res.end();
      return true;
    }
    // A ban after sign-in ends the session at the next write.
    const owner = await this.deps.store.findOwner(session.identityHash);
    if (!owner || owner.banned) {
      this.deps.log('post refused reason=banned');
      refuse(res);
      return true;
    }
    const wait = this.deps.ownerCharge?.(session.ownerId) ?? 0;
    if (wait > 0 && m[3] !== 'retire') {
      this.deps.log('post refused reason=rate');
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': String(wait),
        ...SECURITY_HEADERS,
      });
      res.end(
        JSON.stringify({
          error: { code: 'rate_limited', message: 'Too many requests' },
          retryAfter: wait,
        }),
      );
      return true;
    }
    if (m[1] === 'players' && m[2] === undefined) return this.create(res, session, fields);
    if (m[3] === 'public-camera') return this.camera(res, session, m[2] ?? '', fields);
    if (m[3] === 'public-thoughts') return this.thoughts(res, session, m[2] ?? '', fields);
    if (m[3] === 'token') return this.mint(res, session, m[2] ?? '');
    return this.retire(res, session, m[2] ?? '');
  }

  private methodNotAllowed(res: ServerResponse): true {
    res.writeHead(405, { 'content-type': 'application/json', ...SECURITY_HEADERS });
    res.end(
      JSON.stringify({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }),
    );
    return true;
  }

  private async show(res: ServerResponse, s: Session, notice = ''): Promise<true> {
    const players = await this.deps.store.listPlayers(s.identityHash);
    html(res, 200, accountPage(players, s.csrf, this.deps.config.harnesses, notice));
    return true;
  }

  private async create(res: ServerResponse, s: Session, f: URLSearchParams): Promise<true> {
    const playerId = f.get('player_id') ?? '';
    const name = f.get('name') ?? '';
    const harness = f.get('harness') ?? '';
    if (
      !PLAYER_ID.test(playerId) ||
      playerId.length > 40 ||
      !NAME.test(name) ||
      !this.deps.config.harnesses.includes(harness)
    )
      return this.show(res, s, 'That player could not be created. Check the fields.');
    const value = mintToken();
    const tokenId = `tk_${randomBytes(8).toString('hex')}`;
    const result = await this.serial(() =>
      this.deps.store.createPlayer({
        identityHash: s.identityHash,
        ownerId: s.ownerId,
        playerId,
        lifeId: playerId.replaceAll('-', '_'),
        name,
        harness,
        tokenId,
        tokenHash: hashToken(this.deps.config.tokenPepper, value),
      }),
    );
    if (result === 'cap') return this.show(res, s, 'You have reached your player limit.');
    if (result === 'limit')
      return this.show(res, s, 'You have reached the lifetime limit for creating players.');
    if (result === 'taken') return this.show(res, s, 'That player id is taken.');
    this.deps.log('player created');
    html(res, 200, tokenPage(playerId, value));
    return true;
  }

  private async mint(res: ServerResponse, s: Session, playerId: string): Promise<true> {
    const value = mintToken();
    const ok = await this.deps.store.mintToken({
      identityHash: s.identityHash,
      playerId,
      tokenId: `tk_${randomBytes(8).toString('hex')}`,
      tokenHash: hashToken(this.deps.config.tokenPepper, value),
    });
    if (!ok) return this.show(res, s, 'That player cannot get a token.');
    this.deps.log('token minted');
    html(res, 200, tokenPage(playerId, value));
    return true;
  }

  private async camera(
    res: ServerResponse,
    s: Session,
    playerId: string,
    f: URLSearchParams,
  ): Promise<true> {
    const value = f.get('value');
    if (value !== 'on' && value !== 'off') return this.show(res, s, 'That setting is not valid.');
    const ok = await this.deps.store.setPublicCamera(s.identityHash, playerId, value === 'on');
    this.deps.log(ok ? 'public camera set' : 'public camera refused');
    return this.show(res, s, ok ? 'Public camera updated.' : 'That player cannot be changed.');
  }

  private async thoughts(
    res: ServerResponse,
    s: Session,
    playerId: string,
    f: URLSearchParams,
  ): Promise<true> {
    const value = f.get('value');
    if (value !== 'on' && value !== 'off') return this.show(res, s, 'That setting is not valid.');
    try {
      const ok = await this.deps.store.setThoughtsDelayedPublic(
        s.identityHash,
        playerId,
        value === 'on',
      );
      this.deps.log(ok ? 'delayed public thoughts set' : 'delayed public thoughts refused');
      return this.show(
        res,
        s,
        ok ? 'Delayed public thoughts updated.' : 'That player cannot be changed.',
      );
    } catch {
      // A banned identity or the database rate limit: the same plain refusal, no database text.
      this.deps.log('delayed public thoughts refused');
      return this.show(res, s, 'That player cannot be changed right now.');
    }
  }

  private async retire(res: ServerResponse, s: Session, playerId: string): Promise<true> {
    const ok = await this.deps.store.retirePlayer(s.identityHash, playerId);
    this.deps.log(ok ? 'player retired' : 'retire refused');
    return this.show(res, s, ok ? 'Player retired.' : 'That player cannot be retired.');
  }
}
