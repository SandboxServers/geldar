/**
 * The item-2 live harness (decision 0391 item 5, AN-50b "Ops still to run"): pure pieces. A throwaway Body
 * runs with `observations: true` (the existing `AdamBodyEnv` option; no shard config key); another life
 * breaks, gifts, takes and fights in its sight; the harness checks the observation event each row must
 * produce, and that the producer's XP reaches the sink. Test-only: nothing in `src` imports this file.
 */
import { checkScratch } from '../../src/bench/sheet/guard.ts';
import { leaksIn } from '../../src/perception/provenance/leakage-scan.ts';

/** The four rows and the observation `kind` each must produce for the observer. */
export const ROWS = [
  { row: 'break', kind: 'property_broken' },
  { row: 'gift', kind: 'gift_received' },
  { row: 'take', kind: 'container_taken' },
  { row: 'fight', kind: 'fight_seen' },
] as const;
export type RowName = (typeof ROWS)[number]['row'];

/** Ports of the live stack (the NATS and Postgres defaults); a throwaway stack publishes others. */
const LIVE_PORTS = new Set(['4222', '5432']);
const LIVE_WORDS = /colo|live|prod/i;

export interface Item2Target {
  shard: string;
  project: string;
  natsUrl: string;
  pgUrl: string;
}

function hostAndPort(url: string): { host: string; port: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port };
  } catch {
    return null;
  }
}

/**
 * Why the harness must not run against this target, or null. It runs only with `GELDAR_IT=1` and
 * `GELDAR_ITEM2=1` set, on a `scratch-` shard and project, with loopback endpoints on a port that is not
 * the live default. A live word anywhere in the names, or a live port, refuses.
 */
export function item2Refusal(target: Item2Target, env: NodeJS.ProcessEnv): string | null {
  if (env.GELDAR_IT !== '1') return 'refused: GELDAR_IT=1 is not set';
  if (env.GELDAR_ITEM2 !== '1') return 'refused: GELDAR_ITEM2=1 is not set (throwaway shard only)';
  const scratch = checkScratch(target.shard, target.project);
  if (!scratch.ok) return scratch.reason;
  if (LIVE_WORDS.test(target.shard) || LIVE_WORDS.test(target.project)) {
    return `refused: '${target.shard}' / '${target.project}' look like the live shard`;
  }
  for (const [what, url] of [
    ['NATS', target.natsUrl],
    ['Postgres', target.pgUrl],
  ] as const) {
    const parts = hostAndPort(url.replace(/^nats:/, 'http:').replace(/^postgres(ql)?:/, 'http:'));
    if (parts === null) return `refused: the ${what} URL does not parse`;
    if (parts.host !== '127.0.0.1' && parts.host !== 'localhost') {
      return `refused: the ${what} host '${parts.host}' is not loopback`;
    }
    if (parts.port === '' || LIVE_PORTS.has(parts.port)) {
      return `refused: the ${what} port '${parts.port}' is empty or a live default`;
    }
  }
  return null;
}

/** An observation event as the harness collects it. */
export interface SeenObservation {
  agent_id: string;
  type: string;
  payload: { kind?: string; key?: string };
}

/** Problems with the observations one row produced for the observer; empty means the row passed. */
export function checkRow(
  row: RowName,
  seen: SeenObservation[],
  observerLife: string,
  allowedIds: string[],
): string[] {
  const kind = ROWS.find((r) => r.row === row)?.kind;
  const own = seen.filter((e) => e.type === 'observation' && e.payload.kind === kind);
  const problems: string[] = [];
  if (own.length === 0) problems.push(`${row}: no ${kind} observation reached the observer`);
  for (const e of own) {
    if (e.agent_id !== observerLife) problems.push(`${row}: event is for ${e.agent_id}`);
    if (typeof e.payload.key !== 'string' || e.payload.key === '') problems.push(`${row}: no key`);
    for (const leak of leaksIn(JSON.stringify(e), allowedIds))
      problems.push(`${row}: leak ${leak}`);
  }
  // A gift repeats by design (AN-50b finding 1); every other row is one observation.
  if (row !== 'gift' && own.length > 1) problems.push(`${row}: ${own.length} events, expected 1`);
  return problems;
}

/** One domain's XP and evidence keys for a life, as read from the sink's tables. */
export interface XpReading {
  xp: number;
  evidence: string[];
}

/** Problems with the producer-to-sink XP: the producer's award must add one point and one evidence key. */
export function checkXp(before: XpReading, after: XpReading): string[] {
  const added = after.evidence.filter((k) => !before.evidence.includes(k));
  const problems: string[] = [];
  if (after.xp !== before.xp + 1) problems.push(`xp went ${before.xp} to ${after.xp}, expected +1`);
  if (added.length !== 1) problems.push(`${added.length} new evidence keys, expected 1`);
  return problems;
}
