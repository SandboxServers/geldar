/**
 * What the working copy of `shards/phase0.yaml` changed against the committed copy. `adam-cli select` writes three
 * keys (`mind.run_tier`, the agent's `username` and `tier`); a start may run on that edit and on no other change to
 * the file. Pure: the caller reads both texts.
 */
import { parse } from 'yaml';

export const SHARD_PATH = 'shards/phase0.yaml';

/** The keys `select` writes. Any other changed key refuses the start. */
const SELECT_KEYS = ['mind.run_tier', 'mind.agent.username', 'mind.agent.tier'];

/** One key whose value differs from the committed copy; values are JSON text, `absent` when missing. */
export interface KeyChange {
  key: string;
  from: string;
  to: string;
}

export type ShardEdit =
  | { kind: 'none' }
  | { kind: 'select'; changes: KeyChange[] }
  | { kind: 'refused'; keys: string[]; reason: string };

/** Flattens a parsed document to dotted paths of leaves, each value as JSON text. */
function leaves(node: unknown, prefix: string, out: Map<string, string>): void {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [name, child] of Object.entries(node)) {
      leaves(child, prefix === '' ? name : `${prefix}.${name}`, out);
    }
    return;
  }
  out.set(prefix, JSON.stringify(node) ?? 'undefined');
}

interface MindKeys {
  run_tier?: unknown;
  agent?: { username?: unknown; tier?: unknown };
  lives?: Record<string, unknown>;
}

/** Classifies the working copy against the committed copy: no change, a select-only change, or a refusal. */
export function classifyShardEdit(committedText: string, workingText: string): ShardEdit {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  const working = parse(workingText) as { mind?: MindKeys } | null;
  leaves(parse(committedText), '', before);
  leaves(working, '', after);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: KeyChange[] = [];
  for (const key of keys) {
    const from = before.get(key) ?? 'absent';
    const to = after.get(key) ?? 'absent';
    if (from !== to) changes.push({ key, from, to });
  }
  if (changes.length === 0) {
    // Comments and layout are not keys, but a change to them is still a change the run would not record.
    if (committedText === workingText) return { kind: 'none' };
    return { kind: 'refused', keys: [], reason: 'only comments or layout differ' };
  }
  const other = changes.map((c) => c.key).filter((key) => !SELECT_KEYS.includes(key));
  if (other.length > 0) {
    return { kind: 'refused', keys: other, reason: 'the tier select writes no such key' };
  }
  const mind = working?.mind;
  const tier = mind?.run_tier;
  if (typeof tier !== 'string' || (tier !== 'strong' && tier !== 'fast')) {
    return refusedSelect(changes);
  }
  if (mind?.agent?.tier !== tier) return refusedSelect(changes);
  // The tier's own life, or the smoke life: `select --model smoke` writes it on the fast tier, and nothing else.
  const username = mind?.agent?.username;
  const own = mind?.lives?.[tier] === username;
  const smoke = tier === 'fast' && mind?.lives?.smoke === username;
  if (!own && !smoke) return refusedSelect(changes);
  return { kind: 'select', changes };
}

/** The Mind's life as the text names it: the game username, the agent tier and the run tier (null when absent). */
export interface MindLife {
  username: string | null;
  tier: string | null;
  runTier: string | null;
}

export function mindLifeOf(text: string): MindLife {
  const doc = parse(text) as { mind?: MindKeys } | null;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    username: str(doc?.mind?.agent?.username),
    tier: str(doc?.mind?.agent?.tier),
    runTier: str(doc?.mind?.run_tier),
  };
}

function refusedSelect(changes: KeyChange[]): ShardEdit {
  return {
    kind: 'refused',
    keys: changes.map((c) => c.key),
    reason:
      'the values are not what select writes (username from mind.lives, agent tier = run_tier)',
  };
}
