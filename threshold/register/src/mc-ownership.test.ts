import { describe, expect, it } from 'vitest';
import {
  checkJavaOwnership,
  FAILURE_MESSAGES,
  GAMEPASS_HINT,
  NOT_OWNED_MESSAGE,
} from './mc-ownership.ts';

const MS_TOKEN = 'MS_SECRET_TOKEN_ABC';
const XBL_TOKEN = 'XBL_TOKEN_1';
const XSTS_TOKEN = 'XSTS_TOKEN_2';
const MC_TOKEN = 'MC_TOKEN_3';
const UHS = 'UHS1';
const SECRETS = [MS_TOKEN, XBL_TOKEN, XSTS_TOKEN, MC_TOKEN, UHS];

type Step = 'user' | 'xsts' | 'login' | 'ent';
type Reply = { status?: number; body?: unknown; text?: string } | 'reject' | 'hang';

const URLS: Record<Step, string> = {
  user: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  login: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  ent: 'https://api.minecraftservices.com/entitlements/mcstore',
};

const HAPPY: Record<Step, Reply> = {
  user: { status: 200, body: { Token: XBL_TOKEN, DisplayClaims: { xui: [{ uhs: UHS }] } } },
  xsts: { status: 200, body: { Token: XSTS_TOKEN, DisplayClaims: { xui: [{ uhs: UHS }] } } },
  login: { status: 200, body: { access_token: MC_TOKEN } },
  ent: { status: 200, body: { items: [{ name: 'product_minecraft', signature: 'sig' }] } },
};

const stepOf = (url: string): Step => {
  const found = (Object.keys(URLS) as Step[]).find((s) => URLS[s] === url);
  if (!found) throw new Error(`unexpected url ${url}`);
  return found;
};

/** A fetch double: each step answers its happy reply unless overridden. Records every call. */
function mockFetch(overrides: Partial<Record<Step, Reply>> = {}) {
  const calls: { step: Step; init: RequestInit }[] = [];
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => {
    const step = stepOf(url);
    calls.push({ step, init: init ?? {} });
    const reply = overrides[step] ?? HAPPY[step];
    if (reply === 'reject') return Promise.reject(new TypeError('socket hang up'));
    if (reply === 'hang') return new Promise<Response>(() => {});
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return Promise.resolve(new Response(text, { status: reply.status ?? 200 }));
  };
  return { fetchFn, calls, steps: () => calls.map((c) => c.step) };
}

const ownsItems = (...names: string[]): Reply => ({
  status: 200,
  body: { items: names.map((name) => ({ name, signature: 'sig' })) },
});

describe('checkJavaOwnership: owns', () => {
  it('owns with product_minecraft and calls the four steps in order', async () => {
    const m = mockFetch();
    const result = await checkJavaOwnership(MS_TOKEN, m.fetchFn);
    expect(result).toEqual({ status: 'owns' });
    expect(m.steps()).toEqual(['user', 'xsts', 'login', 'ent']);
  });

  it('sends the documented request bodies and headers', async () => {
    const m = mockFetch();
    await checkJavaOwnership(MS_TOKEN, m.fetchFn);
    const body = (i: number): unknown => JSON.parse(String(m.calls[i]?.init.body));
    expect(m.calls[0]?.init.method).toBe('POST');
    expect(body(0)).toEqual({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${MS_TOKEN}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    });
    expect(body(1)).toEqual({
      Properties: { SandboxId: 'RETAIL', UserTokens: [XBL_TOKEN] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
    expect(body(2)).toEqual({ identityToken: `XBL3.0 x=${UHS};${XSTS_TOKEN}` });
    expect(m.calls[3]?.init.method).toBe('GET');
    expect(m.calls[3]?.init.headers).toEqual({
      accept: 'application/json',
      authorization: `Bearer ${MC_TOKEN}`,
    });
  });

  it('owns with game_minecraft', async () => {
    const m = mockFetch({ ent: ownsItems('game_minecraft') });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toEqual({ status: 'owns' });
  });

  it('owns when a Java item sits among unrelated items', async () => {
    const m = mockFetch({ ent: ownsItems('product_realms', 'product_minecraft') });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toEqual({ status: 'owns' });
  });

  it('owns wins over Game Pass when both are present', async () => {
    const m = mockFetch({ ent: ownsItems('product_game_pass_pc', 'product_minecraft') });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toEqual({ status: 'owns' });
  });
});

describe('checkJavaOwnership: Game Pass and not owned', () => {
  it.each(['product_game_pass_pc', 'product_game_pass_ultimate'])(
    'owns_via_gamepass for %s with the launch hint',
    async (name) => {
      const m = mockFetch({ ent: ownsItems(name) });
      expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toEqual({
        status: 'owns_via_gamepass',
        hint: GAMEPASS_HINT,
      });
    },
  );

  it('not_owned for an empty items array', async () => {
    const m = mockFetch({ ent: { status: 200, body: { items: [] } } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toEqual({
      status: 'not_owned',
      message: NOT_OWNED_MESSAGE,
    });
  });

  it.each([['product_minecraft_bedrock'], ['game_minecraft_bedrock'], ['product_realms']])(
    'not_owned for %s alone (Bedrock or unrelated items prove no Java)',
    async (name) => {
      const m = mockFetch({ ent: ownsItems(name) });
      expect((await checkJavaOwnership(MS_TOKEN, m.fetchFn)).status).toBe('not_owned');
    },
  );
});

describe('checkJavaOwnership: Xbox XErr codes', () => {
  const codes: [number, string][] = [
    [2148916233, 'no_xbox_account'],
    [2148916227, 'banned'],
    [2148916235, 'country'],
    [2148916236, 'adult_verification'],
    [2148916237, 'adult_verification'],
    [2148916238, 'child_needs_family'],
  ];

  it.each(codes)('maps XErr %i at the user step to %s and stops there', async (xerr, code) => {
    const m = mockFetch({
      user: { status: 401, body: { XErr: xerr, Redirect: 'https://x.invalid' } },
    });
    const result = await checkJavaOwnership(MS_TOKEN, m.fetchFn);
    expect(result).toEqual({
      status: 'failed',
      code,
      message: FAILURE_MESSAGES[code as keyof typeof FAILURE_MESSAGES],
    });
    expect(m.steps()).toEqual(['user']);
  });

  it.each(codes)('maps XErr %i at the XSTS step to %s and stops there', async (xerr, code) => {
    const m = mockFetch({ xsts: { status: 401, body: { XErr: xerr } } });
    const result = await checkJavaOwnership(MS_TOKEN, m.fetchFn);
    expect((result as { code: string }).code).toBe(code);
    expect(m.steps()).toEqual(['user', 'xsts']);
  });

  it('an unknown XErr is unknown (fail closed)', async () => {
    const m = mockFetch({ xsts: { status: 401, body: { XErr: 2148999999 } } });
    expect((await checkJavaOwnership(MS_TOKEN, m.fetchFn)).status).toBe('failed');
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'unknown' });
  });

  it('an XErr sent as a string is not trusted: unknown', async () => {
    const m = mockFetch({ xsts: { status: 401, body: { XErr: '2148916233' } } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'unknown' });
  });

  it('an XSTS error with a non-JSON body is unknown', async () => {
    const m = mockFetch({ xsts: { status: 401, text: '<html>denied</html>' } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'unknown' });
  });
});

describe('checkJavaOwnership: Mojang 403 and other status codes', () => {
  it('403 from login_with_xbox is check_unavailable (app not approved), not a verdict', async () => {
    const m = mockFetch({ login: { status: 403, body: { error: 'Forbidden' } } });
    const result = await checkJavaOwnership(MS_TOKEN, m.fetchFn);
    expect(result).toEqual({
      status: 'failed',
      code: 'check_unavailable',
      message: FAILURE_MESSAGES.check_unavailable,
    });
    expect(m.steps()).toEqual(['user', 'xsts', 'login']);
  });

  it('403 from entitlements is check_unavailable', async () => {
    const m = mockFetch({ ent: { status: 403, body: {} } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({
      code: 'check_unavailable',
    });
  });

  it('500 from login_with_xbox is unknown, not check_unavailable', async () => {
    const m = mockFetch({ login: { status: 500, body: {} } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'unknown' });
  });

  it('500 from entitlements is unknown', async () => {
    const m = mockFetch({ ent: { status: 500, body: {} } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'unknown' });
  });

  it('403 from the Xbox user step without an XErr is unknown', async () => {
    const m = mockFetch({ user: { status: 403, body: {} } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'unknown' });
  });
});

describe('checkJavaOwnership: malformed replies', () => {
  const steps: Step[] = ['user', 'xsts', 'login', 'ent'];

  it.each(steps)('non-JSON 200 at %s is malformed', async (step) => {
    const m = mockFetch({ [step]: { status: 200, text: '{not json' } });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'malformed' });
    expect(m.steps()).toEqual(steps.slice(0, steps.indexOf(step) + 1));
  });

  it.each([
    ['user Token missing', 'user', { DisplayClaims: { xui: [{ uhs: UHS }] } }],
    [
      'user Token with a semicolon',
      'user',
      { Token: 'a;b', DisplayClaims: { xui: [{ uhs: UHS }] } },
    ],
    ['user reply is an array', 'user', [1, 2]],
    ['xsts DisplayClaims missing', 'xsts', { Token: XSTS_TOKEN }],
    ['xsts xui empty', 'xsts', { Token: XSTS_TOKEN, DisplayClaims: { xui: [] } }],
    ['xsts uhs missing', 'xsts', { Token: XSTS_TOKEN, DisplayClaims: { xui: [{}] } }],
    [
      'xsts uhs with whitespace',
      'xsts',
      { Token: XSTS_TOKEN, DisplayClaims: { xui: [{ uhs: 'a b' }] } },
    ],
    ['login access_token missing', 'login', { token_type: 'Bearer' }],
    ['login access_token empty', 'login', { access_token: '' }],
    ['entitlements items not an array', 'ent', { items: 'product_minecraft' }],
    ['entitlements items missing', 'ent', {}],
    ['entitlements item has no name', 'ent', { items: [{ signature: 'x' }] }],
    ['entitlements item name not a string', 'ent', { items: [{ name: 7 }] }],
    ['entitlements item is null', 'ent', { items: [null] }],
  ])('%s is malformed', async (_label, step, body) => {
    const m = mockFetch({ [step]: { status: 200, body } as Reply });
    const result = await checkJavaOwnership(MS_TOKEN, m.fetchFn);
    expect(result).toMatchObject({ status: 'failed', code: 'malformed' });
  });
});

describe('checkJavaOwnership: network, timeouts and the empty token', () => {
  it.each(steps4())('a rejected fetch at %s is network', async (step) => {
    const m = mockFetch({ [step]: 'reject' });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn)).toMatchObject({ code: 'network' });
  });

  it('a hung call ends at the timeout and makes no further call', async () => {
    const m = mockFetch({ xsts: 'hang' });
    const result = await checkJavaOwnership(MS_TOKEN, m.fetchFn, 20);
    expect(result).toEqual({
      status: 'failed',
      code: 'timeout',
      message: FAILURE_MESSAGES.timeout,
    });
    expect(m.steps()).toEqual(['user', 'xsts']);
  });

  it('a fetch that ignores its abort signal still ends at the timeout', async () => {
    const m = mockFetch({ ent: 'hang' });
    expect(await checkJavaOwnership(MS_TOKEN, m.fetchFn, 20)).toMatchObject({ code: 'timeout' });
  });

  it('an empty Microsoft token fails closed as unknown and makes no call', async () => {
    const m = mockFetch();
    expect(await checkJavaOwnership('', m.fetchFn)).toMatchObject({
      status: 'failed',
      code: 'unknown',
    });
    expect(m.calls).toHaveLength(0);
  });

  it('a fetch that throws synchronously is network, not an exception', async () => {
    const throwing = (): Promise<Response> => {
      throw new Error('boom');
    };
    expect(await checkJavaOwnership(MS_TOKEN, throwing)).toMatchObject({ code: 'network' });
  });
});

describe('checkJavaOwnership: secrets never leave the module', () => {
  it('no failure result or message contains a token, even when the reply echoes one', async () => {
    const scenarios: Partial<Record<Step, Reply>>[] = [
      {
        user: {
          status: 401,
          body: { XErr: 2148916233, Token: XBL_TOKEN, RpsTicket: `d=${MS_TOKEN}` },
        },
      },
      {
        xsts: {
          status: 401,
          body: { XErr: 2148999999, Token: XSTS_TOKEN, DisplayClaims: { xui: [{ uhs: UHS }] } },
        },
      },
      { login: { status: 403, body: { access_token: MC_TOKEN } } },
      { ent: { status: 500, text: `${MC_TOKEN} ${UHS}` } },
      { ent: { status: 200, text: `{"items":[{"name":"${MC_TOKEN}"` } },
    ];
    for (const overrides of scenarios) {
      const result = await checkJavaOwnership(MS_TOKEN, mockFetch(overrides).fetchFn);
      const text = JSON.stringify(result);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
  });
});

function steps4(): Step[] {
  return ['user', 'xsts', 'login', 'ent'];
}
