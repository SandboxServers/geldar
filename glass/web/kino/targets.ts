// The /kino/targets reply: who is signed in and which agents the server lets this viewer watch.
// The page trusts the list only for the picker; the server checks every subscribe again.

export interface Targets {
  enabled: boolean;
  signedIn: boolean;
  agents: string[];
}

const AGENT = /^[a-z][a-z0-9_]{0,63}$/;

/** Parses the reply; anything malformed becomes "nothing to watch" rather than an error. */
export function parseTargets(v: unknown): Targets {
  const none: Targets = { enabled: true, signedIn: false, agents: [] };
  if (typeof v !== 'object' || v === null) return none;
  const o = v as Record<string, unknown>;
  return {
    enabled: o.enabled !== false,
    signedIn: o.signed_in === true,
    agents: Array.isArray(o.agents)
      ? o.agents.filter((a): a is string => typeof a === 'string' && AGENT.test(a))
      : [],
  };
}

/** What the page shows above the picker. Anonymous viewers still get the public cameras the server lists. */
export function targetsNotice(t: Targets): string | null {
  if (!t.enabled) return 'Kino is switched off.';
  if (!t.signedIn && t.agents.length === 0) return 'Sign in to watch your agents.';
  if (!t.signedIn) return 'Sign in to watch more than the public cameras.';
  if (t.agents.length === 0) return 'No agents you may watch right now.';
  return null;
}

/** What the targets request came to: a parsed list, or a failure the page must show with a Retry. */
export type TargetsOutcome =
  | { ok: true; targets: Targets }
  | { ok: false; message: string; retryAfterSeconds: number | null };

/** The seconds a Retry-After header asks for (whole seconds only, capped at an hour), or null. */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (header === null || header === undefined || !/^\d{1,5}$/.test(header.trim())) return null;
  return Math.min(3600, Number(header.trim()));
}

/** Pure: turns the HTTP status, Retry-After and JSON body (null when unreadable) into an outcome. A non-2xx never passes as "nothing to watch". */
export function targetsOutcome(
  status: number,
  retryAfter: string | null | undefined,
  body: unknown,
): TargetsOutcome {
  if (status >= 200 && status < 300 && typeof body === 'object' && body !== null) {
    return { ok: true, targets: parseTargets(body) };
  }
  const code = status >= 200 && status < 300 ? 'unreadable reply' : `HTTP ${status}`;
  return {
    ok: false,
    message: `Could not load the camera list (${code}). Retry`,
    retryAfterSeconds: parseRetryAfter(retryAfter),
  };
}

/** The outcome when the request itself threw (offline, aborted). */
export function targetsFetchFailed(): TargetsOutcome {
  return {
    ok: false,
    message: 'Could not load the camera list (no connection). Retry',
    retryAfterSeconds: null,
  };
}
