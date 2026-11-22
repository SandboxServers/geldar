import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { Account } from './account.ts';
import type { RegisterConfig } from './config.ts';
import {
  checkJavaOwnership,
  FAILURE_MESSAGES,
  NOT_OWNED_MESSAGE,
  type OwnershipFailureCode,
} from './mc-ownership.ts';
import type { OwnershipCheck } from './mc-signup-gate.ts';
import { microsoftProvider } from './providers.ts';
import type { SessionStore } from './session-store.ts';
import type { Store } from './store.ts';

const identity = {
  provider: 'microsoft' as const,
  identityHash: 'a'.repeat(64),
  display: 'microsoft',
};

function fakeRes() {
  const r = {
    status: 0,
    headers: {} as Record<string, unknown>,
    body: '',
    writeHead(status: number, headers?: Record<string, unknown>) {
      r.status = status;
      r.headers = headers ?? {};
      return r;
    },
    end(body?: string) {
      r.body = body ?? '';
    },
  };
  return r;
}

function fakeStore(
  owner: { ownerId: string; banned: boolean } | null = null,
  record: () => Promise<boolean> = async () => true,
) {
  return {
    findOwner: vi.fn(async () => owner),
    createOwner: vi.fn(async () => undefined),
    recordMcOwnership: vi.fn(record),
    eraseAccount: vi.fn(async () => true),
  };
}

function harness(requireMcOwnership: boolean, store: ReturnType<typeof fakeStore>) {
  const lines: string[] = [];
  const sessions = { sweep: vi.fn(async () => 0), create: vi.fn(async () => undefined) };
  const config = { sessionKey: 'k'.repeat(40), requireMcOwnership } as unknown as RegisterConfig;
  const account = new Account({
    config,
    store: store as unknown as Store,
    sessions: sessions as unknown as SessionStore,
    now: () => 1_000,
    log: (l) => lines.push(l),
  });
  return { account, lines, sessions };
}

async function signUp(
  account: Account,
  verify: OwnershipCheck | undefined,
  consent = true,
): Promise<ReturnType<typeof fakeRes>> {
  const res = fakeRes();
  await account.signedIn(identity, res as unknown as ServerResponse, consent, verify);
  return res;
}

const owns: OwnershipCheck = async () => ({ status: 'owns' });

describe('flag off', () => {
  it('signs a new player up without calling the check or recording an answer', async () => {
    const store = fakeStore();
    const { account } = harness(false, store);
    const verify = vi.fn(owns);
    const res = await signUp(account, verify);
    expect(res.status).toBe(302);
    expect(verify).not.toHaveBeenCalled();
    expect(store.createOwner).toHaveBeenCalledOnce();
    expect(store.recordMcOwnership).not.toHaveBeenCalled();
  });

  it('keeps the old scope and adds XboxLive.signin only when the gate is on', () => {
    const creds = { clientId: 'cid', clientSecret: 'sec' };
    const scopeOf = (on: boolean) =>
      new URL(
        microsoftProvider(creds, { requireMcOwnership: on }).authorizeUrl('https://h/cb', 's', 'v'),
      ).searchParams.get('scope');
    expect(scopeOf(false)).toBe('openid');
    expect(scopeOf(true)).toBe('openid XboxLive.signin');
    expect(scopeOf(false)).toBe('openid');
  });
});

describe('flag on, new sign-up', () => {
  it('admits an owner of Java and records the answer once', async () => {
    const store = fakeStore();
    const { account, lines } = harness(true, store);
    const res = await signUp(account, owns);
    expect(res.status).toBe(302);
    expect(store.createOwner).toHaveBeenCalledOnce();
    expect(store.recordMcOwnership).toHaveBeenCalledWith('a'.repeat(64), true);
    expect(lines).toContain('sign-up ownership outcome=owns provider=microsoft');
  });

  it('admits a Game Pass account', async () => {
    const store = fakeStore();
    const { account, lines } = harness(true, store);
    const res = await signUp(account, async () => ({
      status: 'owns_via_gamepass',
      hint: 'launch once',
    }));
    expect(res.status).toBe(302);
    expect(lines).toContain('sign-up ownership outcome=owns_via_gamepass provider=microsoft');
  });

  it('refuses a Bedrock-only account with a page and creates nothing', async () => {
    const store = fakeStore();
    const { account, lines, sessions } = harness(true, store);
    const res = await signUp(account, async () => ({
      status: 'not_owned',
      message: NOT_OWNED_MESSAGE,
    }));
    expect(res.status).toBe(403);
    expect(res.body).toContain(NOT_OWNED_MESSAGE);
    expect(store.createOwner).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
    expect(lines).toContain('sign-up ownership outcome=not_owned provider=microsoft');
  });

  it.each([
    'no_xbox_account',
    'banned',
    'country',
    'adult_verification',
    'child_needs_family',
    'network',
    'timeout',
    'malformed',
    'unknown',
  ] as OwnershipFailureCode[])('refuses the failure %s with its message', async (code) => {
    const store = fakeStore();
    const { account, lines } = harness(true, store);
    const res = await signUp(account, async () => ({
      status: 'failed',
      code,
      message: FAILURE_MESSAGES[code],
    }));
    expect(res.status).toBe(403);
    expect(res.body).toContain(FAILURE_MESSAGES[code]);
    expect(store.createOwner).not.toHaveBeenCalled();
    expect(lines).toContain(`sign-up ownership outcome=failed code=${code} provider=microsoft`);
  });

  it('shows the not-available page on a Mojang 403 and never admits', async () => {
    const store = fakeStore();
    const { account } = harness(true, store);
    const res = await signUp(account, async () => ({
      status: 'failed',
      code: 'check_unavailable',
      message: FAILURE_MESSAGES.check_unavailable,
    }));
    expect(res.status).toBe(403);
    expect(res.body).toContain('Ownership check not available yet');
    expect(res.body).toContain(FAILURE_MESSAGES.check_unavailable);
    expect(store.createOwner).not.toHaveBeenCalled();
  });

  it('fails closed when the check throws', async () => {
    const store = fakeStore();
    const { account } = harness(true, store);
    const res = await signUp(account, async () => {
      throw new Error('boom');
    });
    expect(res.status).toBe(403);
    expect(store.createOwner).not.toHaveBeenCalled();
  });

  it('fails closed when there is no check to run', async () => {
    const store = fakeStore();
    const { account } = harness(true, store);
    const res = await signUp(account, undefined);
    expect(res.status).toBe(403);
    expect(store.createOwner).not.toHaveBeenCalled();
  });

  it('undoes the sign-up and refuses when the record is refused', async () => {
    const store = fakeStore(null, async () => false);
    const { account, lines, sessions } = harness(true, store);
    const res = await signUp(account, owns);
    expect(res.status).toBe(403);
    expect(store.createOwner).toHaveBeenCalledOnce();
    expect(store.eraseAccount).toHaveBeenCalledWith('a'.repeat(64));
    expect(sessions.create).not.toHaveBeenCalled();
    expect(lines).toContain('sign-up ownership record not stored; undoing the sign-up');
  });

  it('undoes the sign-up and refuses when the record throws', async () => {
    const store = fakeStore(null, async () => {
      throw new Error('db down');
    });
    const { account, lines } = harness(true, store);
    const res = await signUp(account, owns);
    expect(res.status).toBe(403);
    expect(store.eraseAccount).toHaveBeenCalledOnce();
    expect(lines).toContain('sign-up ownership record threw');
  });

  it('refuses without consent before the check runs', async () => {
    const store = fakeStore();
    const { account } = harness(true, store);
    const verify = vi.fn(owns);
    const res = await signUp(account, verify, false);
    expect(res.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('flag on, existing owner', () => {
  it('does not block an existing owner and never runs the check', async () => {
    const store = fakeStore({ ownerId: 'reg-old', banned: false });
    const { account } = harness(true, store);
    const verify = vi.fn(async (): Promise<never> => {
      throw new Error('must not run');
    });
    const res = await signUp(account, verify);
    expect(res.status).toBe(302);
    expect(verify).not.toHaveBeenCalled();
    expect(store.createOwner).not.toHaveBeenCalled();
  });

  it('exempts an admin, who always holds an owner row', async () => {
    const store = fakeStore({ ownerId: 'reg-admin', banned: false });
    const { account } = harness(true, store);
    const verify = vi.fn(async (): Promise<never> => {
      throw new Error('must not run');
    });
    const res = await signUp(account, verify);
    expect(res.status).toBe(302);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('no token in any log line or page', () => {
  it('keeps the access token out of the logs and the refusal page', async () => {
    const token = 'TOKEN-SENTINEL-0123456789';
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ XErr: 2148916233 }), { status: 401 }),
    );
    const store = fakeStore();
    const { account, lines } = harness(true, store);
    const res = await signUp(account, () => checkJavaOwnership(token, fetchFn));
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
    expect(res.body).toContain(FAILURE_MESSAGES.no_xbox_account);
    expect(lines.join('\n')).not.toContain(token);
    expect(res.body).not.toContain(token);
    expect(JSON.stringify(res.headers)).not.toContain(token);
  });
});
