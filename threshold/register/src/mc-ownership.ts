/**
 * The Minecraft Java ownership check for sign-up (Xbox Live -> XSTS -> Minecraft services -> entitlements).
 * Every step is server-side and the Microsoft access token is passed in once: it is never stored, logged or
 * put in an error. The chain is community-documented (not an official Mojang spec) and api.minecraftservices.com
 * answers 403 until the Azure app id is approved, which this module reports as check_unavailable (fail closed).
 */
import type { FetchFn } from './providers.ts';

const XBOX_USER_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTHORIZE = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_ENTITLEMENTS = 'https://api.minecraftservices.com/entitlements/mcstore';
const USER_AUTH_RELYING_PARTY = 'http://auth.xboxlive.com';
const XSTS_RELYING_PARTY = 'rp://api.minecraftservices.com/';

/** Entitlement names that prove Minecraft: Java Edition. */
const JAVA_ITEMS: ReadonlySet<string> = new Set(['product_minecraft', 'game_minecraft']);
/** Game Pass entitlements: accepted, with a hint to launch the Minecraft Launcher once. */
const GAME_PASS_ITEMS: ReadonlySet<string> = new Set([
  'product_game_pass_pc',
  'product_game_pass_ultimate',
]);

/** Default per-call timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Xbox XSTS error codes (the XErr field of a 401 reply) and the failure each one maps to. */
const XERR_CODES: ReadonlyMap<number, OwnershipFailureCode> = new Map<number, OwnershipFailureCode>(
  [
    [2148916233, 'no_xbox_account'],
    [2148916227, 'banned'],
    [2148916235, 'country'],
    [2148916236, 'adult_verification'],
    [2148916237, 'adult_verification'],
    [2148916238, 'child_needs_family'],
  ],
);

export type OwnershipFailureCode =
  | 'no_xbox_account'
  | 'banned'
  | 'country'
  | 'adult_verification'
  | 'child_needs_family'
  | 'check_unavailable'
  | 'network'
  | 'timeout'
  | 'malformed'
  | 'unknown';

/** The user-facing text for each failure. No text here ever contains a token or an identifier. */
export const FAILURE_MESSAGES: Readonly<Record<OwnershipFailureCode, string>> = {
  no_xbox_account:
    'This Microsoft account has no Xbox profile, so it cannot be checked. Create one at xbox.com, then try again.',
  banned: 'This Xbox account is banned, so it cannot be used to register.',
  country: 'Xbox Live is not available in your country, so this account cannot be checked.',
  adult_verification:
    'This Xbox account needs adult verification before it can be checked. Complete it at xbox.com, then try again.',
  child_needs_family:
    'This is a child account. It must be added to a Microsoft Family before it can be checked.',
  check_unavailable:
    'The ownership check is not available yet, so new sign-ups are paused. Existing accounts are not affected. Please try again later.',
  network: 'The ownership check could not reach Microsoft or Mojang. Please try again later.',
  timeout: 'The ownership check timed out. Please try again later.',
  malformed: 'The ownership check got an unexpected reply. Please try again later.',
  unknown: 'The ownership check failed. Please try again later.',
};

export const GAMEPASS_HINT =
  'Game Pass counts for this check. Launch the Minecraft Launcher once with this account before you play.';
export const NOT_OWNED_MESSAGE =
  'This Microsoft account does not own Minecraft: Java Edition. Bedrock-only accounts cannot register here.';

/** The strict result: four outcomes, and a failure always carries a code and its user message. */
export type OwnershipResult =
  | { readonly status: 'owns' }
  | { readonly status: 'owns_via_gamepass'; readonly hint: string }
  | { readonly status: 'not_owned'; readonly message: string }
  | { readonly status: 'failed'; readonly code: OwnershipFailureCode; readonly message: string };

/** Internal: a step failed. Carries only the code, so the message can never hold a token. */
class CheckFailure extends Error {
  readonly code: OwnershipFailureCode;

  constructor(code: OwnershipFailureCode) {
    super(FAILURE_MESSAGES[code]);
    this.code = code;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!isRecord(v)) throw new CheckFailure('malformed');
  return v;
}

/** A token or identifier: a non-empty string with no whitespace and no ';' (the XBL3.0 field separator). */
function tokenString(v: unknown): string {
  if (typeof v !== 'string' || !/^[^;\s]+$/.test(v)) throw new CheckFailure('malformed');
  return v;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new CheckFailure('malformed');
  }
}

/** An Xbox error reply: the XErr code maps to its typed failure; anything else is unknown. */
async function xboxFailure(res: Response): Promise<never> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const xerr = isRecord(body) ? body.XErr : undefined;
  const code = typeof xerr === 'number' ? XERR_CODES.get(xerr) : undefined;
  throw new CheckFailure(code ?? 'unknown');
}

/** Mojang answers 403 while the Azure app id is not approved: that is not a verdict on the account. */
function mojangFailure(res: Response): never {
  throw new CheckFailure(res.status === 403 ? 'check_unavailable' : 'unknown');
}

/** One HTTP call with a timeout. A fetch that ignores its signal still ends at the timeout. */
async function call(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CheckFailure('timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchFn(url, { ...init, signal: controller.signal }), timedOut]);
  } catch (err) {
    if (err instanceof CheckFailure) throw err;
    throw new CheckFailure('network');
  } finally {
    clearTimeout(timer);
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Runs the chain. Throws CheckFailure on the first failing step and makes no further call after it. */
async function runChain(
  msAccessToken: string,
  fetchFn: FetchFn,
  timeoutMs: number,
): Promise<OwnershipResult> {
  const userRes = await call(
    fetchFn,
    XBOX_USER_AUTH,
    jsonPost({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: USER_AUTH_RELYING_PARTY,
      TokenType: 'JWT',
    }),
    timeoutMs,
  );
  if (!userRes.ok) await xboxFailure(userRes);
  const xblToken = tokenString(asRecord(await readJson(userRes)).Token);

  const xstsRes = await call(
    fetchFn,
    XSTS_AUTHORIZE,
    jsonPost({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: XSTS_RELYING_PARTY,
      TokenType: 'JWT',
    }),
    timeoutMs,
  );
  if (!xstsRes.ok) await xboxFailure(xstsRes);
  const xsts = asRecord(await readJson(xstsRes));
  const xstsToken = tokenString(xsts.Token);
  const xui = asRecord(xsts.DisplayClaims).xui;
  if (!Array.isArray(xui) || xui.length === 0) throw new CheckFailure('malformed');
  const uhs = tokenString(asRecord(xui[0]).uhs);

  const loginRes = await call(
    fetchFn,
    MC_LOGIN,
    jsonPost({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
    timeoutMs,
  );
  if (!loginRes.ok) mojangFailure(loginRes);
  const mcToken = tokenString(asRecord(await readJson(loginRes)).access_token);

  const entRes = await call(
    fetchFn,
    MC_ENTITLEMENTS,
    { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${mcToken}` } },
    timeoutMs,
  );
  if (!entRes.ok) mojangFailure(entRes);
  const items = asRecord(await readJson(entRes)).items;
  if (!Array.isArray(items)) throw new CheckFailure('malformed');
  const names = items.map((item) => {
    const name = asRecord(item).name;
    if (typeof name !== 'string') throw new CheckFailure('malformed');
    return name;
  });

  if (names.some((n) => JAVA_ITEMS.has(n))) return { status: 'owns' };
  if (names.some((n) => GAME_PASS_ITEMS.has(n)))
    return { status: 'owns_via_gamepass', hint: GAMEPASS_HINT };
  return { status: 'not_owned', message: NOT_OWNED_MESSAGE };
}

/**
 * Checks Minecraft Java ownership for a Microsoft access token (scope XboxLive.signin). Never throws: every
 * failure, including an unexpected one, becomes a failed result, so the caller can only admit on 'owns' or 'owns_via_gamepass'.
 */
export async function checkJavaOwnership(
  msAccessToken: string,
  fetchFn: FetchFn,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<OwnershipResult> {
  try {
    if (msAccessToken === '') throw new CheckFailure('unknown');
    return await runChain(msAccessToken, fetchFn, timeoutMs);
  } catch (err) {
    const code = err instanceof CheckFailure ? err.code : 'unknown';
    return { status: 'failed', code, message: FAILURE_MESSAGES[code] };
  }
}
