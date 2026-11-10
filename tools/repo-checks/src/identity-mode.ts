import { parse } from 'yaml';

/** True for a shard config file (`shards/*.yaml` or `.yml`). */
export function isShardFile(path: string): boolean {
  return /^shards\/[^/]+\.ya?ml$/.test(path);
}

/**
 * Spec 5.15.8: sovereign players live only on watched shards, so a shard that
 * allows them must declare `identity_mode: watched`. Reads both the spec's
 * scalar form (`sovereign: allowed`) and the block form (`sovereign: { allowed: true }`).
 * A file that does not parse is the YAML check's problem, so it yields nothing here.
 */
export function checkSovereignIdentity(path: string, text: string): string[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return [];
  }
  if (typeof doc !== 'object' || doc === null) return [];
  const shard = doc as Record<string, unknown>;
  const sovereign = shard.sovereign;
  const allowed =
    sovereign === 'allowed' ||
    (typeof sovereign === 'object' &&
      sovereign !== null &&
      (sovereign as Record<string, unknown>).allowed === true);
  if (!allowed || shard.identity_mode === 'watched') return [];
  const found =
    shard.identity_mode === undefined
      ? 'no identity_mode key'
      : `identity_mode: ${String(shard.identity_mode)}`;
  return [
    `${path}: sovereign allowed requires identity_mode: watched (spec 5.15.8), found ${found}`,
  ];
}
