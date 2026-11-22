import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hashToken, mintToken } from '../../mcp/src/store/token-hash.ts';
import { ACCOUNT_PAGE_HEADERS, controlsOf, controlsRoute } from './account-controls-wiring.ts';
import { deleteAccountPage, runAccountDelete } from './account-delete-page.ts';
import { accountPage, type BodyState } from './account-pages.ts';
import { ACCOUNT_CSS } from './account-style.ts';
import type { AccountDeleteDeps } from './api/account-data-delete.ts';
import type { RegisterConfig } from './config.ts';
import { errorPage } from './errors.ts';
import type { Identity } from './identity.ts';
import { ownershipRefusedPage } from './mc-ownership-pages.ts';
import {
  decideOwnership,
  isRefusal,
  type OwnershipCheck,
  recordOwnership,
  UNRECORDED_REFUSAL,
} from './mc-signup-gate.ts';
import {
  mcpBaseFor,
  ONBOARDING_CSP,
  ONBOARDING_SCRIPT,
  ONBOARDING_SCRIPT_PATH,
  OnboardingHandoff,
  onboardingEmptyPage,
  onboardingPage,
} from './onboarding-pages.ts';
import { BASE, EXPIRED_PAGE, REFUSED_PAGE, SECURITY_HEADERS } from './pages.ts';
import { STATE_COOKIE } from './pkce.ts';
import { KINO_COOKIE_TTL_MS, kinoCookieHeader, signKinoSession } from './session-cookie.ts';
import {
  SESSION_CAP_MS,
  SESSION_IDLE_MS,
  type SessionStore,
  sessionHash,
  slideExpiry,
} from './session-store.ts';
import type { PlayerRow, Store } from './store.ts';
import { tokenExpiresAt } from './tokens-policy.ts';

/** The session cookie name. The __Host- prefix makes the browser refuse a Domain= or non-Secure copy (CF-5). */
export const SESSION_COOKIE = '__Host-gr_session';
/** The idle window (C7-01). Kept under its old name for the tests that step the clock past it. */
export const SESSION_TTL_MS = SESSION_IDLE_MS;
/** The terms version an owner accepts at sign-up (C7-08). Version 1 is the owner-approved text (2026-11-11). Bump it when the approved text changes. */
export const TERMS_VERSION = 'v1';
const PLAYER_ID = /^ag-[a-z0-9]+(-[a-z0-9]+)*$/;
/** A Minecraft login (DISPLAYNAME-SHAPE, decision 0261 item 2c): 3 to 16 letters, digits or underscore. Also in SQL (0061). */
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const MAX_BODY = 4096;
/** The longest one body status call may take before the page shows no line for that agent (C7-06c). */
const BODY_STATE_TIMEOUT_MS = 2000;
const TIMED_OUT = Symbol('body status timed out');

interface Session {
  readonly ownerId: string;
  readonly identityHash: string;
  readonly csrf: string;
  /** The session hash: the key the held token is filed under (one session, one slot). */
  readonly key: string;
}

export interface AccountDeps {
  readonly config: RegisterConfig;
  readonly store: Store;
  /** Where sessions live (C7-01): a row per session, so a restart does not end them. */
  readonly sessions: SessionStore;
  readonly now: () => number;
  readonly log: (line: string) => void;
  /** Per-owner limiter (R41): seconds to wait, or 0. */
  readonly ownerCharge?: (ownerId: string) => number;
  /** The body state of one agent (C7-06c). Unset, undefined or a throw shows no body line for it. */
  readonly bodyState?: (playerId: string) => Promise<BodyState | undefined>;
  /** The account delete (C7-09a): the same shared delete the API route uses. Unset, the page action is a 404. */
  readonly accountDelete?: AccountDeleteDeps | undefined;
  /** True only when the body routes are mounted: the page then shows the start, stop and restart buttons (C7-06d). */
  readonly bodyControls?: boolean;
}

/** The value of the one cookie of this name. Two or more of that name in the header give null: no session. */
const cookieOf = (req: IncomingMessage, name: string): string | null => {
  const values: string[] = [];
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) values.push(v.join('='));
  }
  return values.length === 1 ? (values[0] ?? null) : null;
};

const sessionCookie = (value: string, maxAge: number): string =>
  `${SESSION_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

/** The pre-CF-5 names, cleared on sign-in and logout for one release. Host-only, so no Domain attribute. */
const LEGACY_CLEARS = [
  'gr_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
  'gr_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
];

/** The Set-Cookie values that end a session: the session cookie, the legacy names and the kino cookie (C7-09a). */
export const signOutCookies = (): string[] => [
  sessionCookie('', 0),
  ...LEGACY_CLEARS,
  kinoCookieHeader('', 0),
];

/** The form token is derived from the session id, so the table holds no copy of it. */
const csrfFor = (key: string, id: string): string =>
  createHmac('sha256', key).update(`register-csrf-v1:${id}`).digest('base64url');

function html(res: ServerResponse, status: number, body: string, extra = {}): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(body);
}

const refuse = (res: ServerResponse): void => html(res, 403, errorPage(403));

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
  private readonly deps: AccountDeps;
  private lock: Promise<unknown> = Promise.resolve();
  constructor(deps: AccountDeps) {
    this.deps = deps;
  }

  /** One sign-up at a time, so the daily cap cannot be passed by two parallel callbacks. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** The token held for the onboarding page (C7-05): in memory, one showing, ten minutes. */
  private readonly handoff = new OnboardingHandoff();

  /** The callback hook: banned and capped checks, then the owner, then a session and a redirect. */
  readonly signedIn = async (
    identity: Identity,
    res: ServerResponse,
    consent = false,
    verify?: OwnershipCheck,
  ): Promise<void> => {
    const { store, sessions, config, now, log } = this.deps;
    const outcome = await this.serial(async () => {
      const found = await store.findOwner(identity.identityHash);
      if (found?.banned) return 'banned' as const;
      if (found) return found.ownerId;
      // Sign-up needs the consent box (C7-08): no owner row without it.
      if (!consent) return 'consent' as const;
      // The Minecraft Java gate runs for a NEW sign-up only, before the owner row exists (flag off: skipped).
      if (config.requireMcOwnership) {
        const result = await decideOwnership(verify, identity.provider, log);
        if (isRefusal(result)) return { refused: result };
      }
      const ownerId = `reg-${identity.identityHash.slice(0, 24)}`;
      await store.createOwner(identity, ownerId, TERMS_VERSION);
      if (config.requireMcOwnership && !(await recordOwnership(store, identity.identityHash, log)))
        return { refused: UNRECORDED_REFUSAL };
      return ownerId;
    });
    const clearState = `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
    if (typeof outcome === 'object') {
      log(`sign-up refused provider=${identity.provider} reason=ownership`);
      return html(res, 403, ownershipRefusedPage(outcome.refused), { 'set-cookie': clearState });
    }
    if (outcome === 'banned') {
      log(`sign-in refused provider=${identity.provider} reason=banned`);
      return html(res, 403, REFUSED_PAGE, { 'set-cookie': clearState });
    }
    if (outcome === 'consent') {
      log(`sign-up refused provider=${identity.provider} reason=consent`);
      return html(res, 403, REFUSED_PAGE, { 'set-cookie': clearState });
    }
    const nowMs = now();
    // A database error here throws: no session row and no cookie, so the sign-in fails closed.
    await sessions.sweep(nowMs);
    const id = randomBytes(32).toString('base64url');
    await sessions.create({
      sessionHash: sessionHash(id),
      ownerId: outcome,
      identityHash: identity.identityHash,
      signedInMs: nowMs,
      lastSeenMs: nowMs,
      expiresMs: slideExpiry(nowMs, nowMs),
    });
    res.writeHead(302, {
      location: `${BASE}/account`,
      'set-cookie': [
        clearState,
        ...LEGACY_CLEARS,
        sessionCookie(id, SESSION_CAP_MS / 1000),
        kinoCookieHeader(
          signKinoSession(config.sessionKey, {
            identityHash: identity.identityHash,
            expiresAt: nowMs + KINO_COOKIE_TTL_MS,
          }),
          KINO_COOKIE_TTL_MS / 1000,
        ),
      ],
      ...SECURITY_HEADERS,
    });
    res.end();
  };

  /** The live session behind a cookie id; slides its expiry. Null when it is unknown or ended. Throws on a database error. */
  private async liveSession(id: string): Promise<Session | null> {
    const row = await this.deps.sessions.touch(sessionHash(id), this.deps.now());
    if (!row) return null;
    return {
      ownerId: row.ownerId,
      identityHash: row.identityHash,
      csrf: csrfFor(this.deps.config.sessionKey, id),
      key: sessionHash(id).toString('hex'),
    };
  }

  /** Handles an account route; false when the path is not one of them. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname === ONBOARDING_SCRIPT_PATH) {
      if (req.method !== 'GET') return this.methodNotAllowed(res);
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        ...SECURITY_HEADERS,
      });
      res.end(ONBOARDING_SCRIPT);
      return true;
    }
    if (controlsRoute(url.pathname, req, res, () => this.methodNotAllowed(res))) return true;
    if (url.pathname === '/account.css') {
      if (req.method !== 'GET') return this.methodNotAllowed(res);
      res.writeHead(200, {
        'content-type': 'text/css; charset=utf-8',
        ...SECURITY_HEADERS,
      });
      res.end(ACCOUNT_CSS);
      return true;
    }
    const m =
      // /account/delete is anchored: it takes no player suffix, so /account/delete/ag-x/retire is not the delete (C7-09a).
      /^\/(account\/delete(?=$)|account|players|logout|onboarding)(?:\/(ag-[a-z0-9-]+)\/(token|retire|public-camera|public-thoughts))?$/.exec(
        url.pathname,
      );
    if (!m) return false;
    const id = cookieOf(req, SESSION_COOKIE);
    if (id === null) {
      res.writeHead(302, { location: BASE, ...SECURITY_HEADERS });
      res.end();
      return true;
    }
    let session: Session | null;
    try {
      session = await this.liveSession(id);
    } catch {
      // Fail closed: a lookup error refuses the request. The log names no database text.
      this.deps.log('session lookup failed');
      session = null;
    }
    if (!session) {
      this.deps.log('session expired');
      html(res, 401, EXPIRED_PAGE, { 'set-cookie': sessionCookie('', 0) });
      return true;
    }
    if (m[1] === 'account/delete' && req.method === 'GET') {
      html(res, 200, deleteAccountPage(session.csrf));
      return true;
    }
    if (m[1] === 'account' || m[1] === 'onboarding') {
      if (req.method !== 'GET') return this.methodNotAllowed(res);
      return m[1] === 'account'
        ? this.show(res, session)
        : this.onboarding(res, session.key, req.headers['sec-fetch-site']);
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
      await this.deps.sessions.delete(sessionHash(id));
      res.writeHead(302, {
        location: BASE,
        'set-cookie': signOutCookies(),
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
      html(res, 429, errorPage(429, wait), { 'retry-after': String(wait) });
      return true;
    }
    if (m[1] === 'account/delete') {
      await runAccountDelete(res, this.deps.accountDelete, session, fields, this.deps.log);
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
    const page = accountPage(
      players,
      s.csrf,
      this.deps.config.harnesses,
      notice,
      await this.bodyStatesOf(players),
      controlsOf(players, s.csrf, this.deps.bodyControls),
    );
    html(res, 200, page, ACCOUNT_PAGE_HEADERS);
    return true;
  }

  /**
   * The body state of each non-retired agent (C7-06c), read in parallel. Each call is bounded by BODY_STATE_TIMEOUT_MS.
   * A slow, throwing or missing reply leaves that agent without a status line. The log names no body text.
   */
  private async bodyStatesOf(players: readonly PlayerRow[]): Promise<Map<string, BodyState>> {
    const states = new Map<string, BodyState>();
    const loader = this.deps.bodyState;
    if (!loader) return states;
    const live = players.filter((p) => p.status !== 'retired');
    const replies = await Promise.all(live.map((p) => this.boundedState(loader, p.playerId)));
    live.forEach((p, i) => {
      const state = replies[i];
      if (state !== undefined) states.set(p.playerId, state);
    });
    return states;
  }

  private async boundedState(
    loader: (playerId: string) => Promise<BodyState | undefined>,
    playerId: string,
  ): Promise<BodyState | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), BODY_STATE_TIMEOUT_MS);
    });
    try {
      const state = await Promise.race([loader(playerId), late]);
      if (state === TIMED_OUT) {
        this.deps.log('body status unavailable');
        return undefined;
      }
      return state;
    } catch {
      // No status line for this agent. The log names no body text.
      this.deps.log('body status unavailable');
      return undefined;
    } finally {
      clearTimeout(timer);
    }
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
    if (result === 'name')
      return this.show(res, s, 'The agent name must be 3 to 16 letters, digits or underscore.');
    if (result === 'name_taken') return this.show(res, s, 'That agent name is already taken.');
    this.deps.log('player created');
    return this.handOff(res, s.key, playerId, value);
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
    return this.handOff(res, s.key, playerId, value);
  }

  /** Holds the new token for the onboarding page and redirects there. The token never goes in the redirect. */
  private handOff(res: ServerResponse, key: string, playerId: string, token: string): true {
    const now = this.deps.now();
    this.handoff.put(key, { playerId, token, expiresAt: tokenExpiresAt(new Date(now)) }, now);
    res.writeHead(303, { location: `${BASE}/onboarding`, ...SECURITY_HEADERS });
    res.end();
    return true;
  }

  /** The once-only onboarding page: it takes the held token, so a second load shows none. */
  private onboarding(res: ServerResponse, key: string, site: string | undefined): true {
    // CF-4: a cross-site or same-site navigation renders the empty page and leaves the slot for the owner's
    // own same-origin load. Absent (old clients) and none (typed or bookmarked) take the token as before.
    const ownNavigation = site === undefined || site === 'same-origin' || site === 'none';
    const shown = ownNavigation ? this.handoff.take(key, this.deps.now()) : null;
    const { publicUrl, mcpPublicUrl } = this.deps.config;
    const body = shown
      ? onboardingPage(shown, mcpBaseFor(publicUrl, mcpPublicUrl))
      : onboardingEmptyPage(!ownNavigation);
    html(res, 200, body, { 'content-security-policy': ONBOARDING_CSP });
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
