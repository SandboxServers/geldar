import { parseTime, splitDockerPrefix } from './time.ts';

export type BodyEvent = {
  agent: string;
  at: number | null;
  kind:
    | 'action'
    | 'stall_diag'
    | 'escape_rung'
    | 'body_watchdog'
    | 'eat'
    | 'body_restart'
    | 'short_session';
  /** Action outcome reason (kind action), the stall reason, or the rung name for escape_rung. */
  reason: string;
  worked: boolean;
};

/** Agent of Body lines that carry no agent and come from a file that names none. */
export const UNKNOWN_AGENT = '(unknown)';
const TIME_KEYS = ['ts', 'time', 'at', 't'];
const AGENT_KEYS = ['life_id', 'agent', 'agent_id', 'player'];
const SHORT_SESSION_MS = 60_000;

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

/**
 * Parses one Body/player-host JSON log line (optionally with a docker timestamp prefix). The agent
 * comes from `life_id`/`agent`/`agent_id`/`player`, else from `defaultAgent` (the file's agent),
 * else it is `(unknown)`. The Body never logs action outcomes to the player host: see outcomes.ts.
 * `player_down` lines with `uptime_ms` under a minute are short-session indicators.
 */
export function parseBodyLine(raw: string, defaultAgent: string | null): BodyEvent[] {
  const { at: dockerAt, rest } = splitDockerPrefix(raw.trim());
  const start = rest.indexOf('{');
  if (start < 0) return [];
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rest.slice(start));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    o = parsed as Record<string, unknown>;
  } catch {
    return [];
  }
  const agentRaw = pick(o, AGENT_KEYS);
  let agent = typeof agentRaw === 'string' ? agentRaw : defaultAgent;
  if (agent === null) agent = UNKNOWN_AGENT;
  const at = parseTime(pick(o, TIME_KEYS)) ?? dockerAt;
  const ev = typeof o.event === 'string' ? o.event : '';
  const mk = (kind: BodyEvent['kind'], reason = '', worked = false): BodyEvent => ({
    agent,
    at,
    kind,
    reason,
    worked,
  });
  if (ev === 'stall_diag') {
    const out = [mk('stall_diag', typeof o.reason === 'string' ? o.reason : '')];
    if (o.reason === 'escape_ladder' && typeof o.rung === 'string') {
      out.push(mk('escape_rung', o.rung, o.worked === true));
    }
    return out;
  }
  if (ev === 'body_watchdog')
    return [mk('body_watchdog', typeof o.action === 'string' ? o.action : '')];
  if (ev === 'body_restart')
    return [mk('body_restart', typeof o.reason === 'string' ? o.reason : '')];
  if (ev === 'eat' || ev.startsWith('eat_')) return [mk('eat')];
  if (ev === 'player_down' && typeof o.uptime_ms === 'number' && o.uptime_ms < SHORT_SESSION_MS) {
    return [mk('short_session')];
  }
  return [];
}

export function parseBodyLog(text: string, defaultAgent: string | null): BodyEvent[] {
  return text.split('\n').flatMap((l) => parseBodyLine(l, defaultAgent));
}
