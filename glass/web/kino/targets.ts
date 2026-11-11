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
