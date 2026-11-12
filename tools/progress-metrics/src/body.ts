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
  /** Action outcome reason, or the rung name for escape_rung. */
  reason: string;
  worked: boolean;
};

const ACTION_EVENTS = new Set(['action_result', 'action_end', 'action_outcome', 'action']);
const TIME_KEYS = ['ts', 'time', 'at', 't'];
const AGENT_KEYS = ['agent', 'agent_id', 'player', 'name'];
const SHORT_SESSION_MS = 60_000;

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

/**
 * Parses one Body/player-host JSON log line (optionally with a docker timestamp prefix). The agent
 * comes from `agent`/`agent_id`/`player`/`name`, else from `defaultAgent`. Action outcomes are lines
 * with event action_result|action_end|action_outcome|action and a `reason` (or `outcome`).
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
  const agent = typeof agentRaw === 'string' ? agentRaw : defaultAgent;
  if (agent === null) return [];
  const at = parseTime(pick(o, TIME_KEYS)) ?? dockerAt;
  const ev = typeof o.event === 'string' ? o.event : '';
  const mk = (kind: BodyEvent['kind'], reason = '', worked = false): BodyEvent => ({
    agent,
    at,
    kind,
    reason,
    worked,
  });
  if (ACTION_EVENTS.has(ev)) {
    const r = o.reason ?? o.outcome;
    return [mk('action', typeof r === 'string' ? r : o.ok === true ? 'ok' : 'unknown')];
  }
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
