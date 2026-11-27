/**
 * The item-2 live harness (decision 0391 item 5, AN-50b "Ops still to run"): pure pieces. A throwaway Body
 * runs with `observations: true` (the existing `AdamBodyEnv` option; no shard config key); another life
 * breaks, gifts, takes and fights in its sight; the harness checks the observation event each row must
 * produce, and that the producer's XP reaches the sink. Test-only: nothing in `src` imports this file.
 */

import { checkScratch } from '../../src/bench/sheet/guard.ts';
import type { GolemConfig } from '../../src/config.ts';
import { leaksIn } from '../../src/perception/provenance/leakage-scan.ts';

/** The four rows and the observation `kind` each must produce for the observer. */
export const ROWS = [
  { row: 'break', kind: 'property_broken' },
  { row: 'gift', kind: 'gift_received' },
  { row: 'take', kind: 'container_taken' },
  { row: 'fight', kind: 'fight_seen' },
] as const;
export type RowName = (typeof ROWS)[number]['row'];

/** Ports of the live stack: NATS, Postgres, the Minecraft ingress and RCON defaults. A throwaway stack uses others. */
const LIVE_PORTS = new Set([4222, 5432, 25565, 25575]);
const LIVE_WORDS = /colo|live|prod/i;
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
/** Adam's life ids on the live shard start with this; the observer must never be one. */
const LIVE_LIFE = /^ag_adam_/;

/** The rows the live file can set up through RCON on a scratch shard (break and take need observer-owned blocks). */
export const SETUP_ROWS: readonly RowName[] = ['gift', 'fight'];

/** Everything the live file reaches, all from `ITEM2_*` variables with no defaults (an unset one is ''). */
export interface Item2Target {
  shard: string;
  project: string;
  natsUrl: string;
  pgUrl: string;
  mcPort: string;
  rconPort: string;
  rconPasswordFile: string;
  /** The observer Body's life id: a scratch life, never one of Adam's. */
  observerLife: string;
}

/** The target as the `ITEM2_*` variables name it; an unset variable is the empty string, which refuses. */
export function item2Target(env: NodeJS.ProcessEnv): Item2Target {
  return {
    shard: env.ITEM2_SHARD ?? '',
    project: env.ITEM2_PROJECT ?? '',
    natsUrl: env.ITEM2_NATS_URL ?? '',
    pgUrl: env.ITEM2_PG_URL ?? '',
    mcPort: env.ITEM2_MC_PORT ?? '',
    rconPort: env.ITEM2_RCON_PORT ?? '',
    rconPasswordFile: env.ITEM2_RCON_PASSWORD_FILE ?? '',
    observerLife: env.ITEM2_OBSERVER_LIFE ?? '',
  };
}

/** The Golem stack config for the target alone: loopback hosts, the target's ports, never the defaults. */
export function item2StackConfig(target: Item2Target): GolemConfig {
  return {
    mcHost: '127.0.0.1',
    mcPort: Number(target.mcPort),
    rconHost: '127.0.0.1',
    rconPort: Number(target.rconPort),
    rconPasswordFile: target.rconPasswordFile,
    natsUrl: target.natsUrl,
  };
}

function portOf(raw: string): number | null {
  const port = Number(raw);
  return /^[0-9]{1,5}$/.test(raw) && port >= 1 && port <= 65535 ? port : null;
}

/** Why a URL is not an acceptable throwaway endpoint: loopback host, an explicit non-live port, no query. */
function urlProblem(what: string, scheme: string, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.replace(new RegExp(`^${scheme}:`), 'http:'));
  } catch {
    return `refused: the ${what} URL does not parse`;
  }
  if (url.search !== '' || url.hash !== '' || raw.includes('?')) {
    return `refused: the ${what} URL has a query string or fragment`;
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    return `refused: the ${what} host '${url.hostname}' is not loopback`;
  }
  const port = portOf(url.port);
  if (port === null || LIVE_PORTS.has(port)) {
    return `refused: the ${what} port '${url.port}' is empty or a live default`;
  }
  return null;
}

/**
 * Why the harness must not run against this target, or null. It runs only with `GELDAR_IT=1` and
 * `GELDAR_ITEM2=1`, on a `scratch-` shard and project with no live word, with loopback NATS and Postgres URLs
 * (explicit non-live port, no query string), explicit non-live Minecraft and RCON ports, a scratch RCON
 * password file (not the stack's own `compose/secrets/rcon.txt`) and an observer life that is not Adam's.
 */
export function item2Refusal(target: Item2Target, env: NodeJS.ProcessEnv): string | null {
  if (env.GELDAR_IT !== '1') return 'refused: GELDAR_IT=1 is not set';
  if (env.GELDAR_ITEM2 !== '1') return 'refused: GELDAR_ITEM2=1 is not set (throwaway shard only)';
  const scratch = checkScratch(target.shard, target.project);
  if (!scratch.ok) return scratch.reason;
  if (LIVE_WORDS.test(target.shard) || LIVE_WORDS.test(target.project)) {
    return `refused: '${target.shard}' / '${target.project}' look like the live shard`;
  }
  const bad =
    urlProblem('NATS', 'nats', target.natsUrl) ??
    urlProblem('Postgres', 'postgres(ql)?', target.pgUrl);
  if (bad !== null) return bad;
  for (const [what, raw] of [
    ['Minecraft', target.mcPort],
    ['RCON', target.rconPort],
  ] as const) {
    const port = portOf(raw);
    if (port === null || LIVE_PORTS.has(port)) {
      return `refused: the ${what} port '${raw}' is empty or a live default`;
    }
  }
  const file = target.rconPasswordFile.replaceAll(String.fromCharCode(92), '/');
  if (file === '' || file.endsWith('compose/secrets/rcon.txt')) {
    return 'refused: the RCON password file is empty or the stack default';
  }
  if (!LIFE_ID.test(target.observerLife) || LIVE_LIFE.test(target.observerLife)) {
    return `refused: observer life '${target.observerLife}' is not a scratch life id`;
  }
  return null;
}

/** After the shard file loads: it must be the target's own shard and observer, not Adam's. */
export function configRefusal(
  config: { shard: string; lifeId: string },
  target: Item2Target,
): string | null {
  if (config.shard !== target.shard) {
    return `refused: the loaded shard file is '${config.shard}', not '${target.shard}'`;
  }
  if (config.lifeId !== target.observerLife) {
    return `refused: the shard file's Body life is '${config.lifeId}', not '${target.observerLife}'`;
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

/** The one block the observer mines for the XP step: `stone` collects as a mining item (eventsink matrix). */
export const MINE_BLOCK = 'stone';

/**
 * Problems with the observer's mining step. The step is `life-cli.ts mine-once` (one scripted plan, one
 * `mine` action); its exit code is 0 only when the plan was accepted and its plan_result arrived.
 */
export function checkMine(exitCode: number): string[] {
  return exitCode === 0
    ? []
    : [`mine-once exited ${exitCode}: the plan was refused or no plan_result arrived`];
}
