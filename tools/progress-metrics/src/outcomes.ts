import { type BodyEvent, UNKNOWN_AGENT } from './body.ts';
import { parseTime, splitDockerPrefix } from './time.ts';

/** More than this many events from one Prometheus counter line are not expanded (a guard, not a limit). */
const MAX_COUNTER_EXPANSION = 100_000;

/**
 * Action outcomes. The Body publishes one `action_outcome` WorldEvent per finished action on NATS
 * (`geldar.<shard>.action_outcome`, JSON: `at`, `agent_id` = life id, `payload.{verb,ok,reason}`), and counts
 * them in `geldar_action_outcomes_total{status,reason}`. Two inputs are read, per line:
 *  - JSON lines of those events (a docker/nats prefix before the `{` is skipped; other lines are ignored);
 *  - a Prometheus text scrape of the counter. A counter has no agent and no time: its events go to
 *    `(unknown)` (or the `agent`/`life_id` label if a scraper adds one) in the first window.
 * Failed actions carry their `reason`; a success is `ok`.
 */
export function parseOutcomes(text: string, defaultAgent: string | null): BodyEvent[] {
  const out: BodyEvent[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('geldar_action_outcomes_total')) {
      out.push(...counterLine(line, defaultAgent));
      continue;
    }
    const { at: dockerAt, rest } = splitDockerPrefix(line);
    const start = rest.indexOf('{');
    if (start < 0) continue;
    let o: unknown;
    try {
      o = JSON.parse(rest.slice(start));
    } catch {
      continue;
    }
    if (typeof o !== 'object' || o === null) continue;
    const e = o as Record<string, unknown>;
    const p = e.payload;
    if (e.type !== 'action_outcome' || typeof p !== 'object' || p === null) continue;
    const pl = p as Record<string, unknown>;
    const agent = typeof e.agent_id === 'string' ? e.agent_id : (defaultAgent ?? UNKNOWN_AGENT);
    const reason = pl.ok === true ? 'ok' : typeof pl.reason === 'string' ? pl.reason : 'unknown';
    out.push({
      agent,
      at: parseTime(e.at) ?? dockerAt,
      kind: 'action',
      reason,
      worked: pl.ok === true,
    });
  }
  return out;
}

const COUNTER = /^geldar_action_outcomes_total(?:\{([^}]*)\})?\s+(\d+(?:\.\d+)?)/;

function counterLine(line: string, defaultAgent: string | null): BodyEvent[] {
  const m = COUNTER.exec(line);
  if (!m) return [];
  const labels = new Map<string, string>();
  for (const l of (m[1] ?? '').matchAll(/(\w+)="([^"]*)"/g))
    labels.set(l[1] as string, l[2] as string);
  const ok = labels.get('status') === 'completed';
  const reason = ok ? 'ok' : (labels.get('reason') ?? 'none');
  const agent = labels.get('life_id') ?? labels.get('agent') ?? defaultAgent ?? UNKNOWN_AGENT;
  const n = Math.min(MAX_COUNTER_EXPANSION, Math.round(Number(m[2])));
  return Array.from({ length: n }, () => ({
    agent,
    at: null,
    kind: 'action' as const,
    reason,
    worked: ok,
  }));
}
