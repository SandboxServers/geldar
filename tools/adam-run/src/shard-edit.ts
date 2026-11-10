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
  if (typeof tier !== 'string' || mind?.lives?.[tier] !== mind?.agent?.username) {
    return refusedSelect(changes);
  }
  if (mind?.agent?.tier !== tier) return refusedSelect(changes);
  return { kind: 'select', changes };
}

function refusedSelect(changes: KeyChange[]): ShardEdit {
  return {
    kind: 'refused',
    keys: changes.map((c) => c.key),
    reason:
      'the values are not what select writes (username from mind.lives, agent tier = run_tier)',
  };
}
